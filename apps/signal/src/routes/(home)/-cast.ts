import {Array, MutableHashMap, MutableList, Number, Option, Order, Record, Schema, String, Tuple} from 'effect'

import * as THREE from 'three'
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {clone} from 'three/addons/utils/SkeletonUtils.js'

import type {Renderer} from './-renderer.ts'

import {CREATURES, HOME_SIGHT, ORE_ITEM, TEAMS} from '#services/game/lib/utils.ts'
import type {Act, BuildingView, Frame, ItemId, UnitView} from '#services/game/schema.ts'
import {ORES} from '#services/world/lib/utils.ts'

// The clip each state plays, in order of preference: units idle, move and work; loaders fly and carry; hostiles idle, move and attack; creatures graze, walk, take off and flee.
const CLIPS = {
	alarm: ['flee', 'move', 'fly', 'idle'],
	attack: ['attack', 'idle'],
	die: ['idle', 'fly'],
	idle: ['idle', 'fly'],
	move: ['move', 'fly', 'idle'],
	work: ['work', 'carry', 'attack', 'idle']
} satisfies Record<Act, string[]>
const FLIERS = ['loader', 'rotor']
// A portrait's side in pixels, drawn at up to half that.
const PORTRAIT = 96
// Creatures that stay level on any slope, and fish, which school at the water's surface.
const UPRIGHT = ['fireflies', 'beetles', 'moths', 'jellies', 'fish', 'bird', 'heron']
const MODELS = [
	'burrower',
	'cart',
	'crawler',
	'digger',
	'dozer',
	'drifter',
	'glitch',
	'golem',
	'loader',
	'lurker',
	'rotor',
	'ruinsentry',
	'scrapdog',
	'sentry',
	'skiff',
	'skimmer',
	'strider',
	'worker',
	...Record.keys(CREATURES)
]

// Model files by name, as Vite serves them.
const URLS = import.meta.glob<string>('./-models/*.glb', {eager: true, import: 'default', query: '?url'})
const TRACER = new THREE.MeshBasicMaterial({color: '#ffd98a', toneMapped: false})
const BOX = new THREE.BoxGeometry(0.4, 0.3, 0.5)
const BOX_SKIN = new THREE.MeshStandardMaterial({color: '#e9e2d5'})

// The paint buildings are made of: walls, roofs, metal, the dark of belts and machinery, timber, and the pale ghost of a site not yet built.
const PAINT = {
	alloy: new THREE.MeshStandardMaterial({color: '#253440', metalness: 0.6, roughness: 0.4}),
	circuit: new THREE.MeshBasicMaterial({color: '#a4eced', toneMapped: false}),
	dark: new THREE.MeshStandardMaterial({color: '#4f4b47', roughness: 0.7}),
	ghost: new THREE.MeshStandardMaterial({
		color: '#ffffff',
		depthWrite: false,
		opacity: 0.35,
		roughness: 1,
		transparent: true
	}),
	metal: new THREE.MeshStandardMaterial({color: '#b8b4ae', metalness: 0.2, roughness: 0.5}),
	road: new THREE.MeshStandardMaterial({color: '#d9cdb4', roughness: 0.95}),
	roof: new THREE.MeshStandardMaterial({color: '#8d8681', roughness: 0.6}),
	timber: new THREE.MeshStandardMaterial({color: '#a07a52', roughness: 0.85}),
	wall: new THREE.MeshStandardMaterial({color: '#ece6da', roughness: 0.8})
}
// What a building is made of, in tiles from its footprint's north-west corner: boxes and cylinders of a paint, `x`, `z` their middle, `y` their foot.
type Part = {
	h: number
	paint: 'alloy' | 'circuit' | 'dark' | 'ghost' | 'metal' | 'road' | 'roof' | 'team' | 'timber' | 'wall'
	round?: boolean
	w: number
	d: number
	x: number
	y: number
	z: number
}

type Actor = {
	actions: MutableHashMap.MutableHashMap<string, THREE.AnimationAction>
	cargo: Option.Option<THREE.Object3D>
	clip: string
	dressed: boolean
	fallen: number
	ground: Option.Option<THREE.Object3D>
	id: number
	kind: string
	mixer: Option.Option<THREE.AnimationMixer>
	object: THREE.Object3D
	seen: number
	target: UnitView
	tint: Option.Option<THREE.MeshStandardMaterial>
	turret: Option.Option<THREE.Object3D>
	x: number
	yaw: number
	z: number
}

function shortestTurn(from: number, to: number) {
	return ((((to - from) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI
}

function meshesOf(root: THREE.Object3D) {
	const found = MutableList.make<THREE.Mesh>()
	root.traverse(child => {
		if (child instanceof THREE.Mesh) MutableList.append(found, child)
	})
	return MutableList.toArray(found)
}

function shaded(root: THREE.Object3D) {
	for (const mesh of meshesOf(root)) {
		mesh.castShadow = true
		mesh.receiveShadow = true
	}
	return root
}

// The colour an item shows in a cargo bed or on a belt: an ore its field's, the rest by what they are made of.
function itemColour(item: ItemId) {
	const ore = Option.getOrUndefined(Array.findFirst(Record.toEntries(ORE_ITEM), entry => entry[1] === item))
	if (ore !== undefined) return ORES[ore[0]].colour
	if (item === 'wood') return '#a07a52'
	if (item === 'water') return '#6fc3c8'
	if (String.startsWith('copper')(item) || item === 'wire') return '#d08a52'
	if (String.startsWith('iron')(item) || String.startsWith('steel')(item)) return '#9fa3a8'
	return '#d9d2c4'
}

// A unit's cargo takes its item's colour: the model's `cargo` material, cloned so each unit tints its own.
function tintOf(cargo: Option.Option<THREE.Object3D>) {
	const node = Option.getOrUndefined(cargo)
	if (node === undefined) return Option.none<THREE.MeshStandardMaterial>()
	const meshes = Array.filter(
		meshesOf(node),
		mesh => mesh.material instanceof THREE.MeshStandardMaterial && mesh.material.name === 'cargo'
	)
	const first = Option.getOrUndefined(Array.head(meshes))
	const own = new THREE.MeshStandardMaterial()
	if (first !== undefined && first.material instanceof THREE.MeshStandardMaterial) own.copy(first.material)
	for (const mesh of meshes) mesh.material = own
	return Option.liftPredicate(own, () => Array.isArrayNonEmpty(meshes))
}

function nodesOf(root: THREE.Object3D) {
	const found = MutableList.make<THREE.Object3D>()
	root.traverse(child => MutableList.append(found, child))
	return MutableList.toArray(found)
}

// A soft round light, for the halos glowing creatures carry.
function haloTexture() {
	const size = 64
	const data = new Uint8Array(size * size * 4)
	for (const index of Array.range(0, size * size - 1)) {
		const alpha =
			Number.clamp(
				1 - Math.hypot((index % size) - size / 2 + 0.5, Math.floor(index / size) - size / 2 + 0.5) / (size / 2),
				{maximum: 1, minimum: 0}
			) ** 2
		data.set([255, 255, 255, Number.round(alpha * 255, 0)], index * 4)
	}
	const texture = new THREE.DataTexture(data, size, size)
	texture.needsUpdate = true
	return texture
}

const HALO = haloTexture()

// The baked `glow_N` nodes become additive halos of their colour and size, from the extras the bake left on them.
function halos(root: THREE.Object3D) {
	for (const node of nodesOf(root)) {
		Option.match(
			Schema.decodeUnknownOption(Schema.Struct({color: Schema.String, opacity: Schema.Finite, size: Schema.Finite}))(
				node.userData['glow']
			),
			{
				onNone: () => undefined,
				onSome: glow => {
					const sprite = new THREE.Sprite(
						new THREE.SpriteMaterial({
							blending: THREE.AdditiveBlending,
							color: glow.color,
							depthWrite: false,
							map: HALO,
							opacity: glow.opacity,
							toneMapped: false,
							transparent: true
						})
					)
					sprite.scale.setScalar(glow.size * 2)
					sprite.userData['noAO'] = true
					node.add(sprite)
				}
			}
		)
	}
	return root
}

// The materials an actor made for itself, its cargo tint and halos, go with it; the models' shared geometry and materials, and the team paints, stay.
function release(actor: Actor) {
	Option.match(actor.tint, {onNone: () => undefined, onSome: material => material.dispose()})
	for (const node of nodesOf(actor.object)) {
		if (node instanceof THREE.Sprite) node.material.dispose()
	}
}

// A model's portrait: its idle pose lit like the world and seen from the game camera's 30°, framed to what shows, on a clear ground.
function portraitOf(gltf: GLTF, painter: THREE.WebGLRenderer) {
	const object = clone(gltf.scene)
	const ground = object.getObjectByName('ground')
	if (ground !== undefined) ground.visible = false
	const mixer = new THREE.AnimationMixer(object)
	Option.match(
		Option.orElse(
			Array.findFirst(gltf.animations, clip => clip.name === 'idle'),
			() => Array.head(gltf.animations)
		),
		{
			onNone: () => undefined,
			onSome: clip => {
				mixer.clipAction(clip).play()
				mixer.update(0.2)
			}
		}
	)
	object.updateMatrixWorld(true)
	// Framed to the posed vertices between their 3rd and 97th percentile on each axis: some rigs park spare parts or effects far off the body.
	const points = MutableList.make<THREE.Vector3>()
	object.traverseVisible(node => {
		if (!(node instanceof THREE.Mesh)) return
		const position = node.geometry.getAttribute('position')
		for (const index of Array.range(0, position.count - 1)) {
			const point = new THREE.Vector3().fromBufferAttribute(position, index)
			if (node instanceof THREE.SkinnedMesh) node.applyBoneTransform(index, point)
			MutableList.append(points, point.applyMatrix4(node.matrixWorld))
		}
	})
	const all = MutableList.toArray(points)
	function span(axis: 'x' | 'y' | 'z') {
		const sorted = Array.sort(
			Array.map(all, point => point[axis]),
			Order.Number
		)
		return {high: sorted[Math.floor(sorted.length * 0.97)] ?? 0, low: sorted[Math.floor(sorted.length * 0.03)] ?? 0}
	}
	const box = new THREE.Box3(
		new THREE.Vector3(span('x').low, span('y').low, span('z').low),
		new THREE.Vector3(span('x').high, span('y').high, span('z').high)
	)
	const centre = box.getCenter(new THREE.Vector3())
	const size = box.getSize(new THREE.Vector3())
	const half = Number.max(Number.max(size.x, size.y), size.z) * 0.6
	const yaw = Math.PI * 1.25
	const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 100)
	camera.position
		.copy(centre)
		.add(
			new THREE.Vector3(
				Math.sin(yaw) * Math.cos(Math.PI / 6),
				0.5,
				Math.cos(yaw) * Math.cos(Math.PI / 6)
			).multiplyScalar(20)
		)
	camera.lookAt(centre)
	const scene = new THREE.Scene()
	const sun = new THREE.DirectionalLight('#fff0dc', 2.6)
	sun.position.set(-3.5, 8, 4.5)
	scene.add(new THREE.HemisphereLight('#eef4ff', '#d9c6ae', 1.6), sun, object)
	painter.render(scene, camera)
	return painter.domElement.toDataURL('image/png')
}

/* oxlint-disable no-param-reassign -- three takes onBeforeCompile off the material and hands it the shader to edit in place. */
// A team's edge: the back faces of a unit's own mesh, pushed out on screen along their normals and drawn flat in the team's colour, so only a thin rim shows round the unit at any zoom.
function hullMaterial(color: string) {
	const material = new THREE.MeshBasicMaterial({color, side: THREE.BackSide})
	material.onBeforeCompile = shader => {
		shader.vertexShader = String.replace(
			'#include <project_vertex>',
			// The rim stands off the unit by 0.35% of the screen's height.
			`#include <project_vertex>\nvec2 hullWay = (projectionMatrix * vec4(normalize(normalMatrix * normal), 0.)).xy;\ngl_Position.xy += normalize(hullWay + 1e-6) * 0.0035 * gl_Position.w;`
		)(shader.vertexShader)
	}
	return material
}
/* oxlint-enable no-param-reassign */

const HULL_FALLBACK = hullMaterial('#888888')

// A mesh's hull beside it, sharing its geometry and, for a rigged mesh, its skeleton, so it moves with every pose.
function bareHull(mesh: THREE.Mesh, material: THREE.Material) {
	if (mesh instanceof THREE.SkinnedMesh) {
		const skinned = new THREE.SkinnedMesh(mesh.geometry, material)
		skinned.bind(mesh.skeleton, mesh.bindMatrix)
		return skinned
	}
	return new THREE.Mesh(mesh.geometry, material)
}

function hullOf(mesh: THREE.Mesh, material: THREE.Material) {
	const hull = bareHull(mesh, material)
	hull.position.copy(mesh.position)
	hull.quaternion.copy(mesh.quaternion)
	hull.scale.copy(mesh.scale)
	hull.userData['noAO'] = true
	hull.userData['shared'] = true
	mesh.parent?.add(hull)
}

function placeholder() {
	const mesh = new THREE.Mesh(BOX, BOX_SKIN)
	mesh.position.y = 0.15
	const group = new THREE.Group()
	group.add(mesh)
	return shaded(group)
}

// A building's parts with its team's flag on a mast at a height.
function marked(parts: Part[], h: number) {
	return [
		...parts,
		{d: 0.04, h: h + 0.5, paint: 'dark', round: true, w: 0.04, x: 0.25, y: 0, z: 0.25},
		{d: 0.05, h: 0.22, paint: 'team', w: 0.4, x: 0.45, y: h + 0.25, z: 0.25}
	] satisfies Part[]
}

// A building's walls, roof and chimney on its `w` by `d` footprint, each `h` high.
function body(w: number, d: number, h: number) {
	return {d: d - 0.3, h, paint: 'wall', w: w - 0.3, x: w / 2, y: 0, z: d / 2} satisfies Part
}

function roof(w: number, d: number, h: number) {
	return {d: d - 0.2, h: 0.12, paint: 'roof', w: w - 0.2, x: w / 2, y: h, z: d / 2} satisfies Part
}

function stack(w: number, h: number, at: number) {
	return {d: 0.3, h, paint: 'metal', round: true, w: 0.3, x: w - 0.45, y: 0, z: at} satisfies Part
}

// The shapes the kinds share: a paved tile, a belt, a belt hub, a crate, a miner, a generator, a kiln and a machine.
function paved() {
	return [{d: 0.98, h: 0.03, paint: 'road', w: 0.98, x: 0.5, y: 0, z: 0.5}] satisfies Part[]
}

function belt() {
	return [
		{d: 0.9, h: 0.1, paint: 'dark', w: 0.9, x: 0.5, y: 0, z: 0.5},
		{d: 0.92, h: 0.04, paint: 'metal', w: 0.92, x: 0.5, y: 0.1, z: 0.5}
	] satisfies Part[]
}

function hub() {
	return [{d: 0.8, h: 0.35, paint: 'metal', w: 0.8, x: 0.5, y: 0, z: 0.5}] satisfies Part[]
}

function crate(w: number, d: number) {
	return marked(
		[
			{d: d * 0.42, h: 0.45, paint: 'timber', w: w * 0.42, x: w * 0.28, y: 0, z: d * 0.3},
			{d: d * 0.42, h: 0.45, paint: 'timber', w: w * 0.42, x: w * 0.72, y: 0, z: d * 0.32},
			{d: d * 0.42, h: 0.45, paint: 'timber', w: w * 0.42, x: w * 0.5, y: 0, z: d * 0.72},
			{d: d * 0.4, h: 0.4, paint: 'timber', w: w * 0.4, x: w * 0.5, y: 0.45, z: d * 0.5}
		],
		0.85
	)
}

function miner(w: number, d: number) {
	return marked(
		[
			{d: d - 0.6, h: 0.2, paint: 'dark', w: w - 0.6, x: w / 2, y: 0, z: d / 2},
			{d: 1.2, h: 1.1, paint: 'wall', w: 1.4, x: w / 2, y: 0.2, z: d / 2},
			roof(w, d, 1.3),
			{d: 0.35, h: 2.4, paint: 'metal', round: true, w: 0.35, x: w / 2 + 0.9, y: 0, z: d / 2 + 0.6}
		],
		1.4
	)
}

function generator(w: number, d: number) {
	return marked([body(w, d, 1), roof(w, d, 1), stack(w, 2.2, 0.45), stack(w, 1.8, d - 0.45)], 1.1)
}

function kiln(w: number, d: number) {
	return marked([body(w, d, 1.1), roof(w, d, 1.1), stack(w, 2.3, d / 2)], 1.2)
}

function machine(w: number, d: number) {
	return marked(
		[body(w, d, 1.2), roof(w, d, 1.2), {d: d * 0.5, h: 0.4, paint: 'roof', w: w * 0.3, x: w * 0.3, y: 1.3, z: d / 2}],
		1.3
	)
}

// Each building and structure as a few boxes and cylinders on its footprint, `w` by `d` tiles.
const SHAPES = {
	antenna: () =>
		[
			{d: 0.12, h: 3, paint: 'metal', round: true, w: 0.12, x: 0.5, y: 0, z: 0.5},
			{d: 0.6, h: 0.08, paint: 'metal', round: true, w: 0.6, x: 0.5, y: 2.6, z: 0.5}
		] satisfies Part[],
	assembler: machine,
	beacon: (w: number, d: number) =>
		marked(
			[
				{d: d - 0.4, h: 0.3, paint: 'wall', w: w - 0.4, x: w / 2, y: 0, z: d / 2},
				{d: 0.25, h: 3.2, paint: 'metal', round: true, w: 0.25, x: w / 2, y: 0.3, z: d / 2},
				{d: 1.1, h: 0.08, paint: 'metal', round: true, w: 1.1, x: w / 2, y: 3.4, z: d / 2}
			],
			0.3
		),
	belt_mk1: belt,
	belt_mk2: belt,
	belt_mk3: belt,
	bridge: paved,
	burner_generator: generator,
	core_generator: generator,
	crate_mk1: crate,
	crate_mk2: crate,
	crate_mk3: crate,
	fabricator: machine,
	foundry: kiln,
	furnace: kiln,
	home: (w: number, d: number) =>
		[
			{d: d - 0.25, h: 0.16, paint: 'alloy', w: w - 0.25, x: w / 2, y: 0, z: d / 2},
			{d: 1.5, h: 0.35, paint: 'metal', w: 1.5, x: w / 2, y: 0.16, z: d / 2},
			{d: 0.95, h: 2.65, paint: 'alloy', w: 0.95, x: w / 2, y: 0.51, z: d / 2},
			{d: 1.12, h: 0.14, paint: 'metal', w: 1.12, x: w / 2, y: 3.16, z: d / 2},
			{d: 0.06, h: 0.65, paint: 'metal', w: 0.06, x: w / 2, y: 3.3, z: d / 2},
			...Array.flatMap([-1, 1], side => [
				{d: 0.2, h: 2.05, paint: 'alloy', w: 0.18, x: w / 2 + side * 0.75, y: 0.51, z: d / 2},
				{d: 0.08, h: 1.7, paint: 'circuit', w: 0.035, x: w / 2 + side * 0.85, y: 0.7, z: d / 2},
				{d: 0.3, h: 0.12, paint: 'metal', w: 0.4, x: w / 2 + side * 0.6, y: 0.7, z: d / 2},
				...Array.flatMap([-1, 1], face => [
					{d: 0.025, h: 2.2, paint: 'team', w: 0.09, x: w / 2 + side * 0.32, y: 0.7, z: d / 2 + face * 0.49},
					{d: 0.025, h: 0.045, paint: 'circuit', w: 0.18, x: w / 2 + side * 0.18, y: 1.5, z: d / 2 + face * 0.49},
					{d: 0.025, h: 0.045, paint: 'circuit', w: 0.18, x: w / 2 + side * 0.18, y: 1.7, z: d / 2 + face * 0.49}
				])
			])
		] satisfies Part[],
	junction: hub,
	lift: belt,
	manufacturer: machine,
	merger: hub,
	miner_mk1: miner,
	miner_mk2: miner,
	miner_mk3: miner,
	pipe: () => [{d: 0.3, h: 0.3, paint: 'metal', round: true, w: 0.3, x: 0.5, y: 0.1, z: 0.5}] satisfies Part[],
	pole: () =>
		[
			{d: 0.08, h: 1.6, paint: 'timber', round: true, w: 0.08, x: 0.5, y: 0, z: 0.5},
			{d: 0.06, h: 0.06, paint: 'timber', w: 0.5, x: 0.5, y: 1.45, z: 0.5}
		] satisfies Part[],
	pump: (w: number, d: number) =>
		marked(
			[
				{d: d - 0.4, h: 0.7, paint: 'metal', round: true, w: w - 0.4, x: w / 2, y: 0, z: d / 2},
				{d: 0.3, h: 0.5, paint: 'dark', round: true, w: 0.3, x: w / 2, y: 0.7, z: d / 2}
			],
			0.7
		),
	pylon: () =>
		[
			{d: 0.18, h: 2.6, paint: 'metal', round: true, w: 0.18, x: 0.5, y: 0, z: 0.5},
			{d: 0.08, h: 0.08, paint: 'metal', w: 0.9, x: 0.5, y: 2.4, z: 0.5}
		] satisfies Part[],
	ramp: paved,
	refinery: (w: number, d: number) =>
		marked(
			[
				body(w, d, 0.9),
				roof(w, d, 0.9),
				{d: 1.2, h: 1.8, paint: 'metal', round: true, w: 1.2, x: w - 0.9, y: 0, z: 0.9},
				{d: 1.2, h: 1.5, paint: 'metal', round: true, w: 1.2, x: w - 0.9, y: 0, z: d - 0.9}
			],
			1
		),
	road: paved,
	smelter: kiln,
	splitter: hub,
	steam_generator: generator
} satisfies Record<BuildingView['kind'], (w: number, d: number) => Part[]>

function geometryOf(part: Part) {
	if (part.round === true) return new THREE.CylinderGeometry(part.w / 2, part.w / 2, part.h, 12)
	return new THREE.BoxGeometry(part.w, part.h, part.d)
}

function paintOf(part: Part, ghost: boolean, team: THREE.Material) {
	if (ghost) return PAINT.ghost
	if (part.paint === 'team') return team
	return PAINT[part.paint]
}

// A building's mesh: its parts in their paint, its team's flag; a site still waiting for items is a pale ghost, one under construction rises with its progress.
function buildingObject(view: BuildingView, team: THREE.Material) {
	const group = new THREE.Group()
	const ghost = view.built < 0.5
	for (const part of SHAPES[view.kind](view.w, view.d)) {
		const mesh = new THREE.Mesh(geometryOf(part), paintOf(part, ghost, team))
		mesh.position.set(part.x - view.w / 2, part.y + part.h / 2, part.z - view.d / 2)
		group.add(mesh)
	}
	if (!ghost) group.scale.y = Number.max(0.15, Number.min(1, (view.built - 0.5) * 2))
	return shaded(group)
}

// A building's own geometry goes with it; a model's stays for the next clone.
function disposeObject(object: THREE.Object3D) {
	for (const mesh of Array.filter(meshesOf(object), entry => entry.userData['shared'] !== true)) {
		mesh.geometry.dispose()
	}
	object.removeFromParent()
}

// The units and buildings on the map, drawn from server frames: each model eases toward its latest place and plays the clip for its state, in its team's colour.
export function createCast(view: Renderer) {
	const models = MutableHashMap.empty<string, GLTF>()
	const actors = MutableHashMap.empty<number, Actor>()
	const buildings = new THREE.Group()
	// Each building drawn, by id: the signature it was drawn from, its object and its belt item.
	const drawn = MutableHashMap.empty<
		number,
		{item: Option.Option<THREE.Mesh>; object: THREE.Object3D; signature: string; view: BuildingView}
	>()
	// A model material in a team's colour, by the material's id and the team.
	const paints = MutableHashMap.empty<string, THREE.Material>()
	const teamPaints = Array.map(TEAMS, team => new THREE.MeshStandardMaterial({color: team.color, roughness: 0.6}))
	const itemPaints = MutableHashMap.empty<ItemId, THREE.Material>()
	const hulls = Array.map(TEAMS, team => hullMaterial(team.color))
	const state = {
		count: 0,
		fading: Array.empty<{action: THREE.AnimationAction; at: number}>(),
		homes: Array.empty<{x: number; z: number}>(),
		models: 0,
		// The buildings last drawn, and how many models had loaded then: a model that loads since redraws them.
		placed: {list: Option.none<NonNullable<Frame['buildings']>>(), models: 0},
		seconds: 0,
		tracers: Array.empty<{mesh: THREE.Mesh; until: number}>()
	}
	view.scene.add(buildings)
	const loader = new GLTFLoader()
	// Portraits are painted on a small canvas of their own as each model loads; the page hears of each new one.
	const portraits = {listeners: Array.empty<() => void>(), painted: MutableHashMap.empty<string, string>()}
	const painter = new THREE.WebGLRenderer({alpha: true, antialias: true, preserveDrawingBuffer: true})
	painter.setPixelRatio(1)
	painter.setSize(PORTRAIT, PORTRAIT, false)
	painter.outputColorSpace = THREE.SRGBColorSpace
	painter.toneMapping = THREE.NeutralToneMapping
	painter.setClearColor(0x00_00_00, 0)
	for (const name of MODELS) {
		Option.match(Record.get(URLS, `./-models/${name}.glb`), {
			onNone: () => undefined,
			onSome: url =>
				loader.load(
					url,
					gltf => {
						MutableHashMap.set(models, name, gltf)
						state.models += 1
						MutableHashMap.set(portraits.painted, name, portraitOf(gltf, painter))
						for (const listener of portraits.listeners) listener()
					},
					undefined,
					() => undefined
				)
		})
	}

	function actorOf(id: number) {
		return Option.getOrUndefined(MutableHashMap.get(actors, id))
	}

	// A model's material in its team's colour, shared by every unit of the team.
	function paintFor(material: THREE.Material, team: number) {
		const key = `${material.uuid}:${team}`
		return Option.getOrElse(MutableHashMap.get(paints, key), () => {
			const painted = material.clone()
			if (painted instanceof THREE.MeshStandardMaterial && painted.name !== 'cargo') {
				// A unit's own paint takes a third of its team's colour.
				painted.color.lerp(new THREE.Color(TEAMS[team]?.color ?? '#ffffff'), 0.35)
			}
			MutableHashMap.set(paints, key, painted)
			return painted
		})
	}

	// Swaps a unit's placeholder for its model once the model has loaded, painted in its team's colour.
	function dress(id: number) {
		const actor = actorOf(id)
		if (actor === undefined || actor.dressed) return
		const gltf = Option.getOrUndefined(MutableHashMap.get(models, actor.kind))
		if (gltf === undefined) return
		const object = halos(shaded(clone(gltf.scene)))
		Option.match(Option.fromUndefinedOr(actor.target.team), {
			onNone: () => undefined,
			onSome: team => {
				for (const mesh of meshesOf(object)) {
					if (mesh.material instanceof THREE.Material) mesh.material = paintFor(mesh.material, team)
					hullOf(mesh, hulls[team] ?? HULL_FALLBACK)
				}
			}
		})
		const mixer = new THREE.AnimationMixer(object)
		// A creature's baked ground (a fish's pond, a bird's perch) stays behind: fish swim in the world's water, and a bird keeps its perch only while it sits.
		actor.ground = Option.fromNullishOr(object.getObjectByName('ground'))
		Option.match(
			Option.filter(actor.ground, () => actor.kind === 'fish'),
			{onNone: () => undefined, onSome: ground => ground.scale.setScalar(0)}
		)
		object.position.copy(actor.object.position)
		view.scene.remove(actor.object)
		view.scene.add(object)
		actor.object = object
		actor.mixer = Option.some(mixer)
		actor.actions = MutableHashMap.fromIterable(
			Array.map(gltf.animations, clip => Tuple.make(clip.name, mixer.clipAction(clip)))
		)
		actor.cargo = Option.fromNullishOr(object.getObjectByName('cargo'))
		actor.tint = tintOf(actor.cargo)
		actor.turret = Option.fromNullishOr(object.getObjectByName('turret'))
		actor.clip = ''
		actor.dressed = true
	}

	function spawn(unit: UnitView) {
		const object = placeholder()
		view.scene.add(object)
		MutableHashMap.set(actors, unit.id, {
			actions: MutableHashMap.empty<string, THREE.AnimationAction>(),
			cargo: Option.none(),
			clip: '',
			dressed: false,
			fallen: 0,
			ground: Option.none(),
			id: unit.id,
			kind: unit.kind,
			mixer: Option.none(),
			object,
			seen: state.count,
			target: unit,
			tint: Option.none(),
			turret: Option.none(),
			x: unit.x,
			yaw: unit.yaw,
			z: unit.z
		})
	}

	// A loader carrying cargo plays its carry clip; everything else plays the clip for its state.
	function clipFor(actor: Actor) {
		if (actor.kind === 'loader' && actor.target.load > 0) return Option.some('carry')
		return Array.findFirst(CLIPS[actor.target.act], name => MutableHashMap.has(actor.actions, name))
	}

	function play(id: number) {
		const actor = actorOf(id)
		if (actor === undefined) return
		const name = Option.getOrElse(clipFor(actor), () => actor.clip)
		const next = Option.getOrUndefined(MutableHashMap.get(actor.actions, name))
		if (name === actor.clip || next === undefined) return
		next.reset().play()
		Option.match(MutableHashMap.get(actor.actions, actor.clip), {
			onNone: () => undefined,
			onSome: previous => {
				previous.crossFadeTo(next, 0.25, false)
				// Once faded out it stops, which puts the joints only it moved back at rest: a faded clip left running holds them where it last had them, and a crawler's legs come off.
				state.fading = [...state.fading, {action: previous, at: state.seconds + 0.3}]
			}
		})
		actor.clip = name
	}

	// Height of a unit at a point: on the ground, over the water for a skiff, or a flier's cruising height.
	function heightOf(actor: Actor, x: number, z: number) {
		const at = Option.getOrUndefined(view.heightAt(x, z))
		if (at === undefined) return actor.object.position.y
		// Fliers keep above the tallest crew they serve, a digger's cab.
		if (Array.contains(FLIERS, actor.kind)) return at.ground + 1.6 + Math.sin(state.seconds * 1.7 + actor.id) * 0.04
		if (actor.kind === 'skiff' && at.liquid > 0) return Number.max(at.ground, at.surface) + 0.05
		// Fish school just under the surface.
		if (actor.kind === 'fish') return Number.max(at.ground, at.surface - 0.19)
		return at.ground
	}

	// Places a unit on the ground, tilted to the slope under it; a unit that is down rolls onto its side.
	function seat(id: number, delta: number) {
		const actor = actorOf(id)
		if (actor === undefined) return
		const ahead = {x: Math.sin(actor.yaw) * 0.3, z: Math.cos(actor.yaw) * 0.3}
		const pitch = Math.atan2(
			heightOf(actor, actor.x - ahead.x, actor.z - ahead.z) - heightOf(actor, actor.x + ahead.x, actor.z + ahead.z),
			0.6
		)
		const roll = Math.atan2(
			heightOf(actor, actor.x + ahead.z, actor.z - ahead.x) - heightOf(actor, actor.x - ahead.z, actor.z + ahead.x),
			0.6
		)
		const y = heightOf(actor, actor.x, actor.z)
		if (actor.target.act === 'die') actor.fallen = Number.min(1, actor.fallen + delta * 3)
		if (actor.target.act !== 'die') actor.fallen = Number.max(0, actor.fallen - delta * 3)
		actor.object.position.set(
			actor.x,
			actor.object.position.y + (y - actor.object.position.y) * (1 - Math.exp(-delta * 12)),
			actor.z
		)
		actor.object.rotation.set(0, 0, 0)
		actor.object.rotateY(actor.yaw)
		const perch = Option.getOrUndefined(Option.filter(actor.ground, () => actor.kind !== 'fish'))
		if (perch !== undefined) perch.visible = actor.target.act === 'idle'
		if (Array.contains(FLIERS, actor.kind) || Array.contains(UPRIGHT, actor.kind)) return
		actor.object.rotateX(pitch * 0.8)
		actor.object.rotateZ(roll * 0.8 + actor.fallen * 1.2)
	}

	// The cargo a unit carries shows as full as it is, and a sentry's turret turns to its aim.
	function drive(id: number, ease: number) {
		const actor = actorOf(id)
		if (actor === undefined) return
		const cargo = Option.getOrUndefined(actor.cargo)
		const turret = Option.getOrUndefined(actor.turret)
		if (cargo !== undefined) {
			cargo.visible = actor.target.load > 0.01
			cargo.scale.setScalar(Number.max(0.01, Math.sqrt(actor.target.load)))
		}
		if (turret !== undefined) turret.rotation.y += shortestTurn(turret.rotation.y, actor.target.aim ?? 0) * ease
	}

	// Where a shot starts or lands: a body, or a building's middle (Home's gun).
	function shotEnd(id: number, lift: number) {
		return Option.orElse(
			Option.map(MutableHashMap.get(actors, id), actor =>
				actor.object.position.clone().add(new THREE.Vector3(0, lift, 0))
			),
			() =>
				Option.map(MutableHashMap.get(drawn, id), entry =>
					entry.object.position.clone().add(new THREE.Vector3(0, 1.2, 0))
				)
		)
	}

	function shoot(shot: Frame['shots'][number]) {
		Option.match(Option.all([shotEnd(shot.from, 0.45), shotEnd(shot.to, 0.3)]), {
			onNone: () => undefined,
			onSome: ends => {
				const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, ends[0].distanceTo(ends[1])), TRACER)
				mesh.position.copy(ends[0]).lerp(ends[1], 0.5)
				mesh.lookAt(ends[1])
				mesh.userData['noAO'] = true
				view.scene.add(mesh)
				state.tracers = [...state.tracers, {mesh, until: state.seconds + 0.12}]
			}
		})
	}

	function frame(next: Frame) {
		state.count += 1
		for (const unit of next.units) {
			const actor = actorOf(unit.id)
			// A refitted unit is drawn as its new model, from scratch.
			if (actor !== undefined && actor.kind !== unit.kind) {
				view.scene.remove(actor.object)
				release(actor)
				MutableHashMap.remove(actors, actor.id)
			}
			if (actor === undefined || actor.kind !== unit.kind) spawn(unit)
			if (actor !== undefined && actor.kind === unit.kind) {
				actor.target = unit
				actor.seen = state.count
				Option.match(Option.all({item: Option.fromUndefinedOr(unit.cargo), material: actor.tint}), {
					onNone: () => undefined,
					onSome: found => found.material.color.set(itemColour(found.item))
				})
			}
		}
		for (const actor of Array.fromIterable(MutableHashMap.values(actors))) {
			if (actor.seen < state.count) {
				view.scene.remove(actor.object)
				release(actor)
				MutableHashMap.remove(actors, actor.id)
			}
		}
		for (const shot of next.shots) shoot(shot)
	}

	// A belt's item rides on it as a small block of its colour.
	function itemOn(building: BuildingView) {
		return Option.map(Option.fromUndefinedOr(building.item), item => {
			const paint = Option.getOrElse(MutableHashMap.get(itemPaints, item), () => {
				const made = new THREE.MeshStandardMaterial({color: itemColour(item), roughness: 0.7})
				MutableHashMap.set(itemPaints, item, made)
				return made
			})
			const mesh = new THREE.Mesh(BOX, paint)
			mesh.userData['shared'] = true
			mesh.scale.setScalar(0.6)
			mesh.position.y = 0.24
			mesh.castShadow = true
			return mesh
		})
	}

	// The buildings as last sent: each one redrawn only when what it shows changed, Home's where every Home's sight is.
	function places(list: NonNullable<Frame['buildings']>) {
		state.placed = {list: Option.some(list), models: state.models}
		state.homes = Array.map(
			Array.filter(list, building => building.kind === 'home'),
			home => ({x: home.x + home.w / 2, z: home.z + home.d / 2})
		)
		const ids = Array.map(list, building => building.id)
		for (const entry of Array.fromIterable(drawn)) {
			if (!Array.contains(ids, entry[0])) {
				disposeObject(entry[1].object)
				MutableHashMap.remove(drawn, entry[0])
			}
		}
		for (const building of list) {
			const signature = `${building.kind}:${Number.round(building.built, 2)}:${state.models}`
			const before = Option.getOrUndefined(MutableHashMap.get(drawn, building.id))
			if (before !== undefined && before.signature === signature) {
				if (before.view.item !== building.item) {
					Option.match(before.item, {onNone: () => undefined, onSome: mesh => mesh.removeFromParent()})
					const item = itemOn(building)
					Option.match(item, {onNone: () => undefined, onSome: mesh => before.object.add(mesh)})
					MutableHashMap.set(drawn, building.id, {...before, item, view: building})
				}
			} else {
				if (before !== undefined) disposeObject(before.object)
				const object = buildingObject(building, teamPaints[building.team] ?? PAINT.roof)
				object.position.set(
					building.x + building.w / 2,
					view.ground(building.x + building.w / 2, building.z + building.d / 2),
					building.z + building.d / 2
				)
				const item = itemOn(building)
				Option.match(item, {onNone: () => undefined, onSome: mesh => object.add(mesh)})
				buildings.add(object)
				MutableHashMap.set(drawn, building.id, {item, object, signature, view: building})
			}
		}
	}

	// The unit under a pixel: the nearest middle within a few dozen pixels.
	function pick(clientX: number, clientY: number) {
		return Option.map(
			Array.head(
				Array.sort(
					Array.filter(
						Array.map(Array.fromIterable(MutableHashMap.values(actors)), actor => {
							const point = view.project(
								actor.object.position.x,
								actor.object.position.y + 0.3,
								actor.object.position.z
							)
							return {distance: Math.hypot(point.x - clientX, point.y - clientY), id: actor.id}
						}),
						entry => entry.distance < 36
					),
					(a: {distance: number}, b: {distance: number}) => Number.sign(a.distance - b.distance)
				)
			),
			entry => entry.id
		)
	}

	function screenOf(id: number) {
		return Option.map(MutableHashMap.get(actors, id), actor =>
			view.project(actor.object.position.x, actor.object.position.y + 0.9, actor.object.position.z)
		)
	}

	// Where a unit is drawn now, eased between the server's frames: what the camera follows.
	function positionOf(id: number) {
		return Option.map(MutableHashMap.get(actors, id), actor => ({x: actor.x, y: actor.object.position.y, z: actor.z}))
	}

	function animate(seconds: number, delta: number) {
		state.seconds = seconds
		for (const entry of state.fading) {
			// A clip that has come back since is playing again, and keeps going.
			if (entry.at <= seconds && entry.action.getEffectiveWeight() < 0.01) entry.action.stop()
		}
		state.fading = Array.filter(state.fading, entry => entry.at > seconds)
		const ease = 1 - Math.exp(-delta * 10)
		for (const actor of MutableHashMap.values(actors)) {
			dress(actor.id)
			actor.x += (actor.target.x - actor.x) * ease
			actor.z += (actor.target.z - actor.z) * ease
			actor.yaw += shortestTurn(actor.yaw, actor.target.yaw) * ease
			seat(actor.id, delta)
			play(actor.id)
			drive(actor.id, ease)
			// A unit that is down holds still.
			Option.match(actor.mixer, {onNone: () => undefined, onSome: mixer => mixer.update(delta * (1 - actor.fallen))})
		}
		// The fog clears round every Home and every team's unit where it is drawn now.
		view.sight([
			...Array.map(state.homes, home => ({radius: HOME_SIGHT, x: home.x, z: home.z})),
			...Array.map(
				Array.filter(Array.fromIterable(MutableHashMap.values(actors)), actor => actor.target.team !== undefined),
				// A unit sees nine tiles round it.
				actor => ({radius: 9, x: actor.x, z: actor.z})
			)
		])
		for (const tracer of Array.filter(state.tracers, entry => entry.until < seconds)) {
			tracer.mesh.removeFromParent()
			tracer.mesh.geometry.dispose()
		}
		state.tracers = Array.filter(state.tracers, entry => entry.until >= seconds)
		if (state.placed.models !== state.models) Option.map(state.placed.list, places)
		// Buildings settle onto the ground as it loads.
		for (const child of buildings.children) {
			Option.match(view.heightAt(child.position.x, child.position.z), {
				onNone: () => undefined,
				onSome: at => child.position.setY(at.ground)
			})
		}
	}

	view.onFrame(animate)

	return {
		dispose() {
			painter.dispose()
		},
		frame,
		// A unit's model as drawn, for its outline.
		objectOf(id: number) {
			return Option.map(MutableHashMap.get(actors, id), actor => actor.object)
		},
		// Runs each time a model's portrait is painted.
		onPortrait(listener: () => void) {
			portraits.listeners = [...portraits.listeners, listener]
		},
		pick,
		places,
		portraits() {
			return Record.fromEntries(Array.fromIterable(portraits.painted))
		},
		positionOf,
		// Every unit and building gone, for a stream that starts over.
		reset() {
			for (const actor of MutableHashMap.values(actors)) {
				view.scene.remove(actor.object)
				release(actor)
			}
			MutableHashMap.clear(actors)
			for (const entry of MutableHashMap.values(drawn)) disposeObject(entry.object)
			MutableHashMap.clear(drawn)
			state.homes = []
		},
		screenOf
	}
}

export type Cast = ReturnType<typeof createCast>
