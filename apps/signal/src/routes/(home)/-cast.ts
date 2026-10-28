import {Array, MutableHashMap, MutableList, Number, Option, Record, String, Tuple} from 'effect'

import * as THREE from 'three'
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {clone} from 'three/addons/utils/SkeletonUtils.js'

import type {Renderer} from './-renderer.ts'

import {RESEARCH} from '#services/game/lib/utils.ts'
import type {Act, Frame, Hud, UnitView} from '#services/game/schema.ts'
import {ORES} from '#services/world/lib/utils.ts'

// The clip each state plays, in order of preference: units idle, move and work; loaders fly and carry; hostiles idle, move and attack.
const CLIPS = {
	alarm: ['move', 'fly', 'idle'],
	attack: ['attack', 'idle'],
	die: ['idle', 'fly'],
	idle: ['idle', 'fly'],
	move: ['move', 'fly', 'idle'],
	work: ['work', 'carry', 'attack', 'idle']
} satisfies Record<Act, string[]>
const FLIERS = ['loader', 'rotor']
const MODELS = [
	'burrower',
	'cart',
	'crawler',
	'digger',
	'dozer',
	'drifter',
	'glitch',
	'golem',
	'home',
	'lab',
	'loader',
	'lurker',
	'rotor',
	'ruinsentry',
	'scrapdog',
	'sentry',
	'skiff',
	'skimmer',
	'strider',
	'worker'
]

// Model files by name, as Vite serves them.
const URLS = import.meta.glob<string>('./-models/*.glb', {eager: true, import: 'default', query: '?url'})
const TRACER = new THREE.MeshBasicMaterial({color: '#ffd98a', toneMapped: false})
const POLE = new THREE.MeshStandardMaterial({color: '#8d8681', roughness: 0.6})
const CLOTH = new THREE.MeshStandardMaterial({color: '#f4b860', roughness: 0.8, side: THREE.DoubleSide})

type Actor = {
	actions: MutableHashMap.MutableHashMap<string, THREE.AnimationAction>
	cargo: Option.Option<THREE.Object3D>
	clip: string
	dressed: boolean
	fallen: number
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

// A unit's ore takes its material's colour: the model's `cargo` material, cloned so each unit tints its own.
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

function placeholder() {
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.5), new THREE.MeshStandardMaterial({color: '#e9e2d5'}))
	mesh.position.y = 0.15
	const group = new THREE.Group()
	group.add(mesh)
	return shaded(group)
}

function flag(at: {x: number; y: number; z: number}) {
	const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.4, 6), POLE)
	pole.position.y = 0.7
	const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32), CLOTH)
	cloth.position.set(0.25, 1.22, 0)
	const group = new THREE.Group()
	group.add(pole, cloth)
	group.position.set(at.x, at.y, at.z)
	return shaded(group)
}

// The units and buildings on the map, drawn from server frames: each model eases toward its latest place and plays the clip for its state.
export function createCast(view: Renderer) {
	const models = MutableHashMap.empty<string, GLTF>()
	const actors = MutableHashMap.empty<number, Actor>()
	const buildings = new THREE.Group()
	const flags = new THREE.Group()
	const state = {
		built: '',
		count: 0,
		flags: '',
		ingots: Array.empty<THREE.Object3D>(),
		mixers: Array.empty<THREE.AnimationMixer>(),
		research: 0,
		seconds: 0,
		tracers: Array.empty<{mesh: THREE.Mesh; until: number}>()
	}
	view.scene.add(buildings, flags)
	const loader = new GLTFLoader()
	for (const name of MODELS) {
		Option.match(Record.get(URLS, `./-models/${name}.glb`), {
			onNone: () => undefined,
			onSome: url =>
				loader.load(
					url,
					gltf => MutableHashMap.set(models, name, gltf),
					undefined,
					() => undefined
				)
		})
	}

	function actorOf(id: number) {
		return Option.getOrUndefined(MutableHashMap.get(actors, id))
	}

	// Swaps a unit's placeholder for its model once the model has loaded.
	function dress(id: number) {
		const actor = actorOf(id)
		if (actor === undefined || actor.dressed) return
		const gltf = Option.getOrUndefined(MutableHashMap.get(models, actor.kind))
		if (gltf === undefined) return
		const object = shaded(clone(gltf.scene))
		const mixer = new THREE.AnimationMixer(object)
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

	// A loader carrying ore plays its carry clip; everything else plays the clip for its state.
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
			onSome: previous => previous.crossFadeTo(next, 0.25, false)
		})
		actor.clip = name
	}

	// Height of a unit at a point: on the ground, over the water for a skiff, or a flier's cruising height.
	function heightOf(actor: Actor, x: number, z: number) {
		const at = Option.getOrUndefined(view.heightAt(x, z))
		if (at === undefined) return actor.object.position.y
		if (Array.contains(FLIERS, actor.kind)) return at.ground + 1.1 + Math.sin(state.seconds * 1.7 + actor.id) * 0.04
		if (actor.kind === 'skiff' && at.liquid > 0) return Number.max(at.ground, at.surface) + 0.05
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
		if (Array.contains(FLIERS, actor.kind)) return
		actor.object.rotateX(pitch * 0.8)
		actor.object.rotateZ(roll * 0.8 + actor.fallen * 1.2)
	}

	// The ore a unit carries shows as full as it is, and a sentry's turret turns to its aim.
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

	function animate(seconds: number, delta: number) {
		state.seconds = seconds
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
		for (const mixer of state.mixers) mixer.update(delta)
		for (const tracer of Array.filter(state.tracers, entry => entry.until < seconds)) {
			tracer.mesh.removeFromParent()
			tracer.mesh.geometry.dispose()
		}
		state.tracers = Array.filter(state.tracers, entry => entry.until >= seconds)
		// Placed buildings and flags settle onto the ground as it loads.
		for (const child of [...buildings.children, ...flags.children]) {
			Option.match(view.heightAt(child.position.x, child.position.z), {
				onNone: () => undefined,
				onSome: at => child.position.setY(at.ground)
			})
		}
		// The lab's shelf fills with ingots as research runs.
		for (const entry of Array.map(state.ingots, (ingot, index) => ({index, ingot}))) {
			entry.ingot.visible = entry.index < state.ingots.length * state.research
		}
	}

	function shoot(shot: Frame['shots'][number]) {
		Option.match(Option.all([MutableHashMap.get(actors, shot.from), MutableHashMap.get(actors, shot.to)]), {
			onNone: () => undefined,
			onSome: pair => {
				const start = pair[0].object.position.clone().add(new THREE.Vector3(0, 0.45, 0))
				const end = pair[1].object.position.clone().add(new THREE.Vector3(0, 0.3, 0))
				const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, start.distanceTo(end)), TRACER)
				mesh.position.copy(start).lerp(end, 0.5)
				mesh.lookAt(end)
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
			if (actor === undefined) spawn(unit)
			if (actor !== undefined) {
				actor.target = unit
				actor.seen = state.count
				Option.match(actor.tint, {
					onNone: () => undefined,
					onSome: material => material.color.set(ORES[unit.cargo ?? 'stone'].colour)
				})
			}
		}
		for (const actor of Array.fromIterable(MutableHashMap.values(actors))) {
			if (actor.seen < state.count) {
				view.scene.remove(actor.object)
				MutableHashMap.remove(actors, actor.id)
			}
		}
		for (const shot of next.shots) shoot(shot)
	}

	function building(name: string, at: {x: number; z: number}) {
		Option.match(MutableHashMap.get(models, name), {
			onNone: () => undefined,
			onSome: gltf => {
				const object = shaded(clone(gltf.scene))
				object.position.set(
					at.x,
					Option.getOrElse(
						Option.map(view.heightAt(at.x, at.z), height => height.ground),
						() => 0
					),
					at.z
				)
				const mixer = new THREE.AnimationMixer(object)
				for (const clip of gltf.animations) mixer.clipAction(clip).play()
				state.mixers = [...state.mixers, mixer]
				state.ingots = [
					...state.ingots,
					...Array.filter(nodesOf(object), node => String.startsWith('ingot_')(node.name))
				]
				buildings.add(object)
			}
		})
	}

	// Home and the lab stand where the HUD says, once their models load; flags mark waypoints; the lab's shelf shows research.
	function places(hud: Hud) {
		state.research = Option.match(
			Option.all({left: Option.fromUndefinedOr(hud.research.left), tier: Array.get(RESEARCH, hud.research.tier - 1)}),
			{onNone: () => 0, onSome: running => 1 - running.left / running.tier.seconds}
		)
		const key = `${hud.home.x},${hud.home.z},${MutableHashMap.size(models)}`
		if (key !== state.built) {
			state.built = key
			buildings.clear()
			state.mixers = []
			state.ingots = []
			building('home', hud.home)
			building('lab', hud.lab)
		}
		const marks = JSON.stringify(hud.waypoints)
		if (marks === state.flags) return
		state.flags = marks
		flags.clear()
		for (const waypoint of hud.waypoints) {
			flags.add(
				flag({
					...waypoint.at,
					y: Option.getOrElse(
						Option.map(view.heightAt(waypoint.at.x, waypoint.at.z), at => at.ground),
						() => 0
					)
				})
			)
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

	view.onFrame(animate)

	return {frame, pick, places, screenOf}
}

export type Cast = ReturnType<typeof createCast>
