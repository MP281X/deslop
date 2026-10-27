import {Array, HashMap, HashSet, MutableHashMap, MutableHashSet, Number, Option, Order, String, pipe} from 'effect'

import * as THREE from 'three'
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js'
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js'
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js'
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'

import type {Focus, View} from '#lib/utils.ts'
import {
	CHUNK,
	CHUNK_TILES,
	CODES,
	STATS,
	STRIDE,
	TEAM_COLORS,
	TILE,
	YIELD,
	bit,
	chunkKey,
	chunkOf,
	chunkTiles,
	explored,
	FLAG_WORKING,
	hash,
	makeTerrain,
	separation,
	stride,
	tileIndex
} from '#services/game/lib/utils.ts'
import {EntityKind} from '#services/game/schema.ts'
import type {EntityInfo, Hud, MemoryEntry} from '#services/game/schema.ts'

// Tile colors by biome (moss, mesa, frost), then by kind: water, shore, plain, highland, rock, ore ground, ruin, crystal ground, scrap ground.
const TILE_COLORS = [
	[0x132029, 0x34372c, 0x253024, 0x2f3627, 0x6f7468, 0x2f2d27, 0x45464a, 0x2c2a36, 0x30291f],
	[0x1b1a1e, 0x3d2f25, 0x3a271e, 0x4a2e21, 0x8a5a42, 0x3c2a22, 0x50433d, 0x342a36, 0x3a2a1c],
	[0x1b2a36, 0x47505a, 0x3b434d, 0x56606c, 0xc9d1dc, 0x3f4148, 0x5a5f69, 0x3a3850, 0x40382e]
]
// Deposits and ruins look alike in every biome: pale ore crystals, ruin pillars, violet crystal seams and rusted scrap.
const DEPOSIT_DECOR: Decor[][] = [
	[
		{chance: 0.8, color: 0xd4d8e4, form: 'spike', height: 0.5, size: 0.13},
		{chance: 0.2, color: 0xc4c8d4, form: 'spike', height: 0.35, size: 0.1}
	],
	[{chance: 0.85, color: 0x5a5a63, form: 'block', height: 1.1, size: 0.42}],
	[
		{chance: 1, color: 0xb4a7f5, form: 'spike', height: 0.85, size: 0.12},
		{chance: 1, color: 0x9d8ee8, form: 'spike', height: 0.55, size: 0.1},
		{chance: 0.6, color: 0xc9bff8, form: 'spike', height: 0.4, size: 0.08}
	],
	[
		{chance: 1, color: 0x7a5236, form: 'block', height: 0.2, size: 0.2},
		{chance: 0.7, color: 0x5b5b63, form: 'block', height: 0.32, size: 0.13}
	]
]
// What grows or stands on open ground, by biome then kind: moss has reeds, grass and shrubs; the mesa dry grass, rubble and red hoodoos; frost ice shards, snow mounds and dark pines.
const DECOR: Decor[][][] = [
	[
		[],
		[
			{chance: 0.35, color: 0x4f6a44, form: 'spike', height: 0.45, size: 0.03},
			{chance: 0.3, color: 0x5b7650, form: 'spike', height: 0.35, size: 0.03}
		],
		[
			{chance: 0.14, color: 0x2f4a2a, form: 'spike', height: 0.24, size: 0.18},
			{chance: 0.3, color: 0x3f5a35, form: 'spike', height: 0.3, size: 0.035}
		],
		[
			{chance: 0.14, color: 0x4d4944, form: 'block', height: 0.24, size: 0.22},
			{chance: 0.1, color: 0x2c4430, form: 'spike', height: 0.5, size: 0.16}
		],
		[{chance: 0.12, color: 0x9a9aa0, form: 'spike', height: 1, size: 0.15}]
	],
	[
		[],
		[{chance: 0.25, color: 0x7a5a3a, form: 'spike', height: 0.3, size: 0.03}],
		[
			{chance: 0.1, color: 0x5a3a2a, form: 'block', height: 0.18, size: 0.2},
			{chance: 0.05, color: 0x4f5a3a, form: 'spike', height: 0.55, size: 0.06}
		],
		[
			{chance: 0.12, color: 0x7a4a34, form: 'spike', height: 0.9, size: 0.2},
			{chance: 0.12, color: 0x5a3a2a, form: 'block', height: 0.22, size: 0.22}
		],
		[{chance: 0.16, color: 0xa0644a, form: 'spike', height: 1.3, size: 0.2}]
	],
	[
		[],
		[{chance: 0.25, color: 0xaac4d8, form: 'spike', height: 0.3, size: 0.06}],
		[
			{chance: 0.16, color: 0xd8e0ea, form: 'block', height: 0.12, size: 0.28},
			{chance: 0.06, color: 0x22332e, form: 'spike', height: 0.9, size: 0.18}
		],
		[
			{chance: 0.22, color: 0x22332e, form: 'spike', height: 1.1, size: 0.2},
			{chance: 0.1, color: 0xd8e0ea, form: 'block', height: 0.16, size: 0.26}
		],
		[{chance: 0.14, color: 0xe6eef6, form: 'spike', height: 1.1, size: 0.16}]
	]
]
const UNKNOWN = 0x0e0e10
const NEIGHBOURS = [
	{x: -1, z: -1},
	{x: 0, z: -1},
	{x: 1, z: -1},
	{x: -1, z: 0},
	{x: 1, z: 0},
	{x: -1, z: 1},
	{x: 0, z: 1},
	{x: 1, z: 1}
]
const SHADOW_CORNERS = [
	{x: 0.35, z: 0.35},
	{x: -0.35, z: 0.35},
	{x: 0.35, z: -0.35},
	{x: -0.35, z: -0.35}
]
// Seconds ahead along its velocity where a body looks for higher ground.
const LOOKAHEAD = [0.15, 0.3, 0.45]
const MAX_INSTANCES = 2048
const MAX_BLADES = 8192
const MAX_TRACERS = 512
const BUILD = {quads: 0}
const TRACERS = {next: 0}
const STRANGER = '#5ec8e5'
const FOG = new THREE.Color(UNKNOWN)
const TERRAIN = makeTerrain()
export const MARKS = {Note: '·', Place: '□', RouteAssaulted: '✕', Sighting: '◇', Standing: '◆'} satisfies Record<
	MemoryEntry['_tag'],
	string
>
// A tile is at most a top, four walls and three props of up to five faces.
const MAX_QUADS = CHUNK_TILES * 20
const QUAD_POSITIONS = new Float32Array(MAX_QUADS * 12)
const QUAD_COLORS = new Float32Array(MAX_QUADS * 12)
const QUAD_NORMALS = new Float32Array(MAX_QUADS * 12)
const BORDERED = CHUNK + 2
const BORDER = Array.filter(
	Array.range(0, BORDERED * BORDERED - 1),
	cell => cell < BORDERED || cell >= BORDERED * (BORDERED - 1) || cell % BORDERED === 0 || cell % BORDERED === CHUNK + 1
)
const QUAD_INDICES = Uint32Array.from(Array.range(0, MAX_QUADS * 6 - 1), index => {
	const corner = [0, 1, 2, 0, 2, 3][index % 6] ?? 0
	return Math.floor(index / 6) * 4 + corner
})
const TRACER_POSITIONS = new Float32Array(MAX_TRACERS * 6)
const TRACER_LIFE = new Float32Array(MAX_TRACERS)
const EVERYTHING = Uint8Array.from(Array.makeBy(CHUNK_TILES / 8, () => 255))
const NOTHING = new Uint8Array(CHUNK_TILES / 8)
const FLASH = new THREE.Color('#f08a4b')
const WHITE = new THREE.Color('#ffffff')
const TINT = new THREE.Color()
// What each label's DOM shows, so a frame rewrites text and health bars only when they change.
const SHOWN = new WeakMap<HTMLElement, {health: number; text: string}>()
const PROP = new THREE.Color()
const DUMMY = new THREE.Object3D()
const LOCAL = new THREE.Matrix4()
const WORLD = new THREE.Matrix4()
const SPIN = new THREE.Quaternion()
const UP = new THREE.Vector3(0, 1, 0)
const FORWARD = new THREE.Vector3(0, 0, 1)
const OFFSET = new THREE.Vector3()
const SIZE = new THREE.Vector3()
const PROJECTED = new THREE.Vector3()
// The mock's camera direction (0, 12, 10.5), normalized: about 49 degrees down, looking north.
const VIEW_DIRECTION = new THREE.Vector3(0, 0.7526, 0.6585)
const byGroup = Order.mapInput(
	Order.Tuple([Order.String, Order.Number]),
	(body: Body) => [body.info.group, body.id] as const
)
const byDistance = Order.mapInput(Order.Number, (candidate: {distance: number}) => candidate.distance)

export type Controls = {
	focus: (focus: Focus) => void
	labels: HTMLElement
	steer: (steer: {drone: number; px: number; pz: number; x: number; z: number}) => void
}

type Part = {
	color: number
	geometry: THREE.BufferGeometry
	scale?: [number, number, number]
	tilt?: number
	turn?: number
	x?: number
	y?: number
	z?: number
}

type Decor = {chance: number; color: number; form: 'block' | 'spike'; height: number; size: number}

type Model = {altitude: number; hull: Part[]; lights: Part[]; rotors: [number, number, number][]}

type Label = {bar: HTMLElement; element: HTMLElement; name: HTMLElement}

type Snapshot = {at: number; x: number; z: number}

// trail holds the last server positions by server time; a body is drawn between the two around the render time.
type Body = {
	bank: number
	flags: number
	flash: number
	// The walk cycle's phase, advanced by the distance actually covered, so feet never slide.
	gait: number
	heading: number
	health: number
	id: number
	info: EntityInfo
	label: Label
	pitch: number
	seen: number
	targetHeading: number
	trail: Snapshot[]
	targetX: number
	targetZ: number
	vx: number
	vy: number
	vz: number
	x: number
	y: number
	z: number
}

// around holds the 8 neighbouring chunks' exploration, which the fog fade at this chunk's edges reads.
type Chunk = {around: Uint8Array[]; bits: Uint8Array; cx: number; cz: number; depleted: number; mesh: THREE.Mesh}

type Marker = {at: {x: number; z: number}; group: THREE.Group; label: Label; stamp: number}

function box(width: number, height: number, depth: number) {
	return new THREE.BoxGeometry(width, height, depth)
}

function merge(parts: Part[]) {
	if (Array.isArrayEmpty(parts)) return new THREE.BufferGeometry()
	const geometry = mergeGeometries(
		Array.map(parts, part => {
			const shaped = part.geometry.toNonIndexed()
			shaped.deleteAttribute('uv')
			shaped.scale(...(part.scale ?? [1, 1, 1]))
			shaped.rotateX(part.tilt ?? 0)
			shaped.rotateY(part.turn ?? 0)
			shaped.translate(part.x ?? 0, part.y ?? 0, part.z ?? 0)
			const color = new THREE.Color(part.color)
			shaped.setAttribute(
				'color',
				new THREE.Float32BufferAttribute(
					Array.flatten(Array.makeBy(shaped.getAttribute('position').count, () => [color.r, color.g, color.b])),
					3
				)
			)
			return shaped
		})
	)
	return geometry ?? new THREE.BufferGeometry()
}

// Glow strips are white here; each instance tints them with its team color, and bloom makes them glow.
function strip(width: number, y: number, z: number) {
	return {color: 0xffffff, geometry: box(width, 0.03, 0.03), y, z}
}

// The drone and structure shapes of the approved mock, each merged into one hull and one glow geometry.
const MODELS = {
	builder: {
		altitude: 1.3,
		hull: [
			{color: 0x9a9aa2, geometry: box(0.42, 0.3, 0.42)},
			{color: 0x52525b, geometry: box(0.04, 0.04, 0.34), tilt: 0.5, x: -0.16, y: -0.08, z: 0.28},
			{color: 0x52525b, geometry: box(0.04, 0.04, 0.34), tilt: 0.5, x: 0.16, y: -0.08, z: 0.28}
		],
		lights: [strip(0.42, 0.05, 0.215)],
		rotors: [
			[-0.34, -0.34, 0.14],
			[0.34, -0.34, 0.14],
			[-0.34, 0.34, 0.14],
			[0.34, 0.34, 0.14]
		]
	},
	core: {
		altitude: 0,
		hull: [
			{color: 0x1f1f23, geometry: box(2.2, 2.6, 2.2), x: -0.6, y: 1.3, z: -0.4},
			{color: 0x2a2a30, geometry: box(1.6, 1.4, 1.4), x: 1.4, y: 0.7, z: -0.8},
			{color: 0x3f3f46, geometry: new THREE.CylinderGeometry(0.18, 0.22, 1.2, 8), x: 1.8, y: 1.9, z: -1.1},
			{color: 0x232328, geometry: box(0.7, 2.4, 0.7), x: -0.8, y: 1.2, z: 1.6}
		],
		lights: [
			{color: 0xffffff, geometry: box(2.24, 0.05, 0.05), x: -0.6, y: 2.1, z: 0.72},
			{color: 0xffffff, geometry: box(0.72, 0.04, 0.72), x: -0.8, y: 0.8, z: 1.6},
			{color: 0xffffff, geometry: box(0.72, 0.04, 0.72), x: -0.8, y: 1.7, z: 1.6},
			{color: 0xffffff, geometry: box(0.9, 0.08, 0.04), x: 1.4, y: 1, z: -0.08}
		],
		rotors: []
	},
	glitch: {
		altitude: 0,
		hull: Array.makeBy(6, index => ({
			color: 0xe4e4e7,
			geometry: new THREE.TetrahedronGeometry(0.12 + (index % 3) * 0.05),
			tilt: index * 1.3,
			turn: index * 2.1,
			x: Math.cos(index * 1.05) * 0.18,
			y: 0.4 + (index % 2) * 0.25,
			z: Math.sin(index * 1.05) * 0.18
		})),
		lights: [],
		rotors: []
	},
	guard: {
		altitude: 1.25,
		hull: [
			{color: 0x5f5f68, geometry: new THREE.OctahedronGeometry(0.24), scale: [1.05, 0.5, 1.15]},
			{color: 0x3f3f46, geometry: box(0.05, 0.05, 0.36), x: -0.2, y: -0.04, z: 0.2},
			{color: 0x3f3f46, geometry: box(0.05, 0.05, 0.36), x: 0.2, y: -0.04, z: 0.2}
		],
		lights: [strip(0.22, 0.08, 0.18)],
		rotors: [
			[-0.3, -0.24, 0.15],
			[0.3, -0.24, 0.15]
		]
	},
	// A hover-truck riding low on skids: a cab, a flat bed and a cargo crate.
	hauler: {
		altitude: 0.4,
		hull: [
			{color: 0x8a8a92, geometry: box(0.58, 0.16, 1.05)},
			{color: 0xa1a1aa, geometry: box(0.52, 0.28, 0.34), y: 0.22, z: 0.32},
			{color: 0x5b5b63, geometry: box(0.46, 0.22, 0.52), y: 0.19, z: -0.2},
			{color: 0x3f3f46, geometry: box(0.06, 0.08, 0.95), x: -0.27, y: -0.14},
			{color: 0x3f3f46, geometry: box(0.06, 0.08, 0.95), x: 0.27, y: -0.14}
		],
		lights: [strip(0.5, 0.24, 0.495), strip(0.56, 0, -0.53)],
		rotors: []
	},
	// A walking mining robot: a torso with a drill arm; its legs and drill bit are separate meshes that swing and spin.
	miner: {
		altitude: 0,
		hull: [
			{color: 0x8a8a92, geometry: box(0.5, 0.34, 0.42), y: 0.62},
			{color: 0x6b6b74, geometry: box(0.26, 0.14, 0.22), y: 0.86, z: 0.06},
			{color: 0x3f3f46, geometry: box(0.36, 0.08, 0.16), y: 0.45},
			{color: 0x52525b, geometry: box(0.1, 0.1, 0.2), y: 0.52, z: 0.26}
		],
		lights: [strip(0.4, 0.66, 0.215), {color: 0xffffff, geometry: box(0.18, 0.03, 0.03), y: 0.88, z: 0.175}],
		rotors: []
	},
	relay: {
		altitude: 0,
		hull: [{color: 0x202024, geometry: box(0.42, 2.6, 0.42), y: 1.3}],
		lights: [{color: 0xffffff, geometry: box(0.05, 1.8, 0.02), y: 1.3, z: 0.215}],
		rotors: []
	},
	scout: {
		altitude: 1.9,
		hull: [
			{color: 0xc4c4cc, geometry: new THREE.OctahedronGeometry(0.2), scale: [0.7, 0.45, 1.4]},
			{color: 0x8a8a92, geometry: box(0.012, 0.32, 0.012), y: 0.18, z: -0.15}
		],
		lights: [strip(0.18, 0.05, 0.12), {color: 0xffffff, geometry: box(0.08, 0.04, 0.04), z: 0.28}],
		rotors: [
			[-0.34, -0.08, 0.16],
			[0.34, -0.08, 0.16]
		]
	},
	turret: {
		altitude: 0,
		hull: [
			{color: 0x3f3f46, geometry: box(0.9, 0.4, 0.9), y: 0.2},
			{color: 0x3f3f46, geometry: box(0.6, 0.4, 0.6), y: 0.6},
			{color: 0x52525b, geometry: box(0.5, 0.3, 0.5), y: 0.95},
			{color: 0x6b6b74, geometry: box(0.36, 0.26, 0.5), y: 1.25},
			{color: 0x27272a, geometry: box(0.06, 0.06, 0.5), y: 1.25, z: 0.35}
		],
		lights: [{color: 0xffffff, geometry: box(0.3, 0.03, 0.03), y: 1.35, z: 0.26}],
		rotors: []
	},
	wall: {
		altitude: 0,
		hull: [{color: 0x3f3f46, geometry: box(0.95, 0.9, 0.95), y: 0.45}],
		lights: [{color: 0xffffff, geometry: box(0.97, 0.04, 0.04), y: 0.7, z: 0.48}],
		rotors: []
	}
} satisfies Record<EntityKind, Model>

function surface(kind: number, level: number) {
	if (kind === TILE.Water) return -0.2
	return level * 0.45
}

function groundAt(x: number, z: number) {
	const tile = TERRAIN.tile(Math.floor(x), Math.floor(z))
	return surface(tile.kind, tile.level)
}

// Lighting uses flat-shaded face normals; the normal attribute only marks top faces for the grid lines.
function quad(corners: number[][], color: THREE.Color, shade: number, up: number) {
	Array.forEach(corners, (point, corner) => {
		QUAD_POSITIONS.set(point, BUILD.quads * 12 + corner * 3)
		QUAD_COLORS.set([color.r * shade, color.g * shade, color.b * shade], BUILD.quads * 12 + corner * 3)
		QUAD_NORMALS.set([0, up, 0], BUILD.quads * 12 + corner * 3)
	})
	BUILD.quads += 1
}

// A side face drops from this tile's top to each lower neighbour in the chunk's bordered height grid.
function walls(x: number, z: number, color: THREE.Color, heights: Float32Array, cell: number) {
	const top = heights[cell] ?? 0
	const east = heights[cell + 1] ?? top
	const south = heights[cell + BORDERED] ?? top
	const west = heights[cell - 1] ?? top
	const north = heights[cell - BORDERED] ?? top
	const sides = [
		{
			bottom: east,
			corners: [
				[x + 1, top, z],
				[x + 1, top, z + 1],
				[x + 1, east, z + 1],
				[x + 1, east, z]
			]
		},
		{
			bottom: south,
			corners: [
				[x, top, z + 1],
				[x, south, z + 1],
				[x + 1, south, z + 1],
				[x + 1, top, z + 1]
			]
		},
		{
			bottom: west,
			corners: [
				[x, top, z],
				[x, west, z],
				[x, west, z + 1],
				[x, top, z + 1]
			]
		},
		{
			bottom: north,
			corners: [
				[x, top, z],
				[x + 1, top, z],
				[x + 1, north, z],
				[x, north, z]
			]
		}
	]
	for (const side of Array.filter(sides, candidate => candidate.bottom < top)) quad(side.corners, color, 0.8, 0)
}

// A prop is sized and placed by its tile's hash, so it never moves between builds; a spike's faces are quads meeting at the tip.
function prop(x: number, z: number, top: number, decor: Decor, salt: number) {
	const size = decor.size * (0.6 + hash(salt, x, z) * 0.8)
	const height = decor.height * (0.6 + hash(salt + 1, x, z) * 0.8)
	const centerX = x + 0.5 + (hash(salt + 2, x, z) - 0.5) * (0.9 - size * 2)
	const centerZ = z + 0.5 + (hash(salt + 3, x, z) - 0.5) * (0.9 - size * 2)
	const base = [
		[centerX + size, top, centerZ - size],
		[centerX + size, top, centerZ + size],
		[centerX - size, top, centerZ + size],
		[centerX - size, top, centerZ - size]
	]
	PROP.setHex(decor.color)
	if (decor.form === 'spike') {
		const tip = [centerX, top + height, centerZ]
		Array.forEach(base, (corner, index) => {
			quad([base[(index + 1) % 4] ?? corner, corner, tip, tip], PROP, 0.75 + (index % 2) * 0.25, 0)
		})
		return
	}
	const lid = Array.map(base, corner => [corner[0] ?? 0, top + height, corner[2] ?? 0])
	quad(lid, PROP, 1, 0)
	Array.forEach(base, (corner, index) => {
		const next = (index + 1) % 4
		quad([lid[index] ?? corner, corner, base[next] ?? corner, lid[next] ?? corner], PROP, 0.7 + (index % 2) * 0.15, 0)
	})
}

// Heights of the chunk plus a one-tile border, so walls compare neighbours without regenerating terrain per tile.
function heightsOf(cx: number, cz: number, tiles: ReturnType<typeof chunkTiles>) {
	const heights = new Float32Array(BORDERED * BORDERED)
	for (const index of Array.range(0, CHUNK_TILES - 1)) {
		heights.set(
			[surface(tiles.kinds[index] ?? 0, tiles.levels[index] ?? 0)],
			(Math.floor(index / CHUNK) + 1) * BORDERED + (index % CHUNK) + 1
		)
	}
	for (const cell of BORDER) {
		heights.set([groundAt(cx * CHUNK + (cell % BORDERED) - 1, cz * CHUNK + Math.floor(cell / BORDERED) - 1)], cell)
	}
	return heights
}

function decorOf(biome: number, kind: number) {
	if (kind >= TILE.Ore) return DEPOSIT_DECOR[kind - TILE.Ore] ?? []
	return DECOR[biome]?.[kind] ?? []
}

// How much of the 5 by 5 tiles around each tile the team knows, from a known-grid with a two-tile border, so the edge of the known world fades over a few tiles instead of cutting a sharp line.
function nearness(cx: number, cz: number, knownAt: (x: number, z: number) => boolean) {
	const span = CHUNK + 4
	const grid = Uint8Array.from(Array.range(0, span * span - 1), cell =>
		bit(knownAt(cx * CHUNK + (cell % span) - 2, cz * CHUNK + Math.floor(cell / span) - 2))
	)
	return Float32Array.from(Array.range(0, CHUNK_TILES - 1), index => {
		const origin = Math.floor(index / CHUNK) * span + (index % CHUNK)
		return (
			Array.reduce(
				Array.range(0, 24),
				0,
				(sum, offset) => sum + (grid[origin + Math.floor(offset / 5) * span + (offset % 5)] ?? 0)
			) / 25
		)
	})
}

// Unexplored ground keeps its shape in a faint tint of its biome, brightening toward what the team knows; it stays bare, so the unknown reads as dark land, not holes.
function buildChunk(
	cx: number,
	cz: number,
	depleted: HashSet.HashSet<string>,
	knownAt: (x: number, z: number) => boolean,
	bits?: Uint8Array
) {
	BUILD.quads = 0
	const tiles = chunkTiles(cx, cz)
	const color = new THREE.Color()
	const heights = heightsOf(cx, cz, tiles)
	const near = nearness(cx, cz, knownAt)
	for (const index of Array.range(0, CHUNK_TILES - 1)) {
		const x = cx * CHUNK + (index % CHUNK)
		const z = cz * CHUNK + Math.floor(index / CHUNK)
		const cell = (Math.floor(index / CHUNK) + 1) * BORDERED + (index % CHUNK) + 1
		const known = bits !== undefined && explored(bits, index)
		const generated = tiles.kinds[index] ?? 0
		// A mined-out deposit reads as plain ground.
		const kind =
			generated - bit((YIELD[generated] ?? 0) > 0 && HashSet.has(depleted, chunkKey(x, z))) * (generated - TILE.Plain)
		const top = heights[cell] ?? 0
		const level = tiles.levels[index] ?? 0
		// Higher ground is lighter, so plateaus and terraces read at a glance.
		color
			.setHex(TILE_COLORS[tiles.biomes[index] ?? 0]?.[kind] ?? UNKNOWN)
			.multiplyScalar((0.82 + level * 0.05) * (0.94 + (((x * 73) ^ (z * 19)) & 7) / 70))
		if (!known) color.lerpColors(FOG, color, 0.12 + (near[index] ?? 0) * 0.35)
		quad(
			[
				[x, top, z],
				[x, top, z + 1],
				[x + 1, top, z + 1],
				[x + 1, top, z]
			],
			color,
			1,
			bit(known)
		)
		walls(x, z, color, heights, cell)
		Array.forEach(decorOf(tiles.biomes[index] ?? 0, kind), (decor, slot) => {
			if (known && hash(20 + slot * 5, x, z) < decor.chance) prop(x, z, top, decor, 21 + slot * 5)
		})
	}
	const geometry = new THREE.BufferGeometry()
	geometry.setAttribute(
		'position',
		new THREE.BufferAttribute(Float32Array.from(QUAD_POSITIONS.subarray(0, BUILD.quads * 12)), 3)
	)
	geometry.setAttribute(
		'color',
		new THREE.BufferAttribute(Float32Array.from(QUAD_COLORS.subarray(0, BUILD.quads * 12)), 3)
	)
	geometry.setAttribute(
		'normal',
		new THREE.BufferAttribute(Float32Array.from(QUAD_NORMALS.subarray(0, BUILD.quads * 12)), 3)
	)
	geometry.setIndex(new THREE.BufferAttribute(QUAD_INDICES.subarray(0, BUILD.quads * 6), 1))
	geometry.computeBoundingSphere()
	return geometry
}

// The terrain draws a thin tile grid on every top face, as in the mock, without extra geometry.
function terrainMaterial() {
	const material = new THREE.MeshStandardMaterial({
		flatShading: true,
		metalness: 0.1,
		roughness: 0.85,
		vertexColors: true
	})
	material.onBeforeCompile = shader => {
		// eslint-disable-next-line no-param-reassign -- three.js hands onBeforeCompile its shader to edit in place
		shader.fragmentShader = String.replace(
			'#include <color_fragment>',
			'#include <color_fragment>\nvec2 cell = abs(fract(vWorld.xz) - 0.5);\nvec2 line = smoothstep(0.5 - max(fwidth(vWorld.xz), vec2(0.001)), vec2(0.5), cell);\nfloat edge = max(line.x, line.y) * step(0.5, vUp);\ndiffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.35 + 0.012, edge);'
		)(`varying vec3 vWorld;\nvarying float vUp;\n${shader.fragmentShader}`)
		// eslint-disable-next-line no-param-reassign -- three.js hands onBeforeCompile its shader to edit in place
		shader.vertexShader = String.replace(
			'#include <project_vertex>',
			'#include <project_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvUp = normal.y;'
		)(`varying vec3 vWorld;\nvarying float vUp;\n${shader.vertexShader}`)
	}
	return material
}

// Teammates wear their member color; strangers read cyan, and players the team marked hostile read red.
function colorOf(info: EntityInfo, current?: Hud) {
	if (Array.some(current?.team ?? [], member => member.name === info.owner)) {
		return TEAM_COLORS[info.color % TEAM_COLORS.length] ?? STRANGER
	}
	const hostile = Array.some(
		current?.memory ?? [],
		entry => entry._tag === 'Standing' && entry.stance === 'hostile' && entry.player === info.owner
	)
	if (hostile || info.kind === 'glitch') return '#ef4444'
	return STRANGER
}

function locate(entry: MemoryEntry) {
	if (entry._tag === 'Standing') return undefined
	return entry.at
}

// Where a trail puts a body at a server time: between the snapshots around it, or up to 120 ms past the last at its last speed.
function sample(trail: Snapshot[], at: number) {
	const index = Number.clamp(
		Option.getOrElse(
			Array.findFirstIndex(trail, snapshot => snapshot.at >= at),
			() => trail.length
		),
		{maximum: Number.max(1, trail.length - 1), minimum: 1}
	)
	const from = trail[index - 1] ?? trail[0] ?? {at, x: 0, z: 0}
	const to = trail[index] ?? from
	const span = Number.max(to.at - from.at, 1)
	const progress = Number.clamp((at - from.at) / span, {maximum: 1 + 120 / span, minimum: 0})
	const moving = bit(progress < 1 + 120 / span)
	return {
		vx: (((to.x - from.x) * 1000) / span) * moving,
		vz: (((to.z - from.z) * 1000) / span) * moving,
		x: from.x + (to.x - from.x) * progress,
		z: from.z + (to.z - from.z) * progress
	}
}

function damp(rate: number, dt: number) {
	return 1 - Math.exp(-rate * dt)
}

function pressed(keys: MutableHashSet.MutableHashSet<string>, codes: string[]) {
	return bit(Array.some(codes, code => MutableHashSet.has(keys, code)))
}

function deadzone(value: number) {
	return value * bit(Math.abs(value) > 0.15)
}

function movement(keys: MutableHashSet.MutableHashSet<string>, pad?: Gamepad) {
	const x = pressed(keys, ['KeyD', 'ArrowRight']) - pressed(keys, ['KeyA', 'ArrowLeft']) + deadzone(pad?.axes[0] ?? 0)
	const z = pressed(keys, ['KeyS', 'ArrowDown']) - pressed(keys, ['KeyW', 'ArrowUp']) + deadzone(pad?.axes[1] ?? 0)
	const length = Number.max(1, Math.hypot(x, z))
	return {x: x / length, z: z / length}
}

function typing(event: KeyboardEvent) {
	return event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
}

function label(parent: HTMLElement, text: string) {
	const element = document.createElement('div')
	element.className =
		'pointer-events-none absolute top-0 left-0 hidden border-l-2 bg-background/80 px-1 text-[10px] whitespace-nowrap will-change-transform'
	const name = document.createElement('span')
	name.textContent = text
	const bar = document.createElement('div')
	bar.className = 'bg-primary hidden h-0.5'
	element.append(name, bar)
	parent.append(element)
	return {bar, element, name} satisfies Label
}

function relabel(target: Label, text: string, health: number) {
	const shown = SHOWN.get(target.element) ?? {health: 1, text: ''}
	if (shown.text !== text) target.name.replaceChildren(text)
	SHOWN.set(target.element, {health, text})
	if (Math.abs(shown.health - health) < 0.01) return
	target.bar.classList.toggle('hidden', health > 0.99)
	target.bar.classList.toggle('bg-destructive', health < 0.35)
	target.bar.style.setProperty('width', `${Number.round(health * 100)}%`)
}

export function createRenderer(canvas: HTMLCanvasElement, controls: Controls) {
	// The scene renders into the composer's targets, so multisampling the default framebuffer would only cost fill rate.
	const renderer = new THREE.WebGLRenderer({antialias: false, canvas, powerPreference: 'high-performance'})
	const quality = {frames: 0, ratio: Number.min(devicePixelRatio, 1.5), total: 0}
	renderer.setPixelRatio(quality.ratio)
	const scene = new THREE.Scene()
	scene.background = new THREE.Color('#131316')
	const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 600)
	const sun = new THREE.DirectionalLight('#cdd6ff', 1.7)
	scene.add(new THREE.HemisphereLight('#aab3c8', '#0c0c10', 1.3), sun, sun.target)
	const composer = new EffectComposer(renderer)
	const bloom = new UnrealBloomPass(new THREE.Vector2(512, 288), 0.7, 0.45, 0.6)
	composer.addPass(new RenderPass(scene, camera))
	const output = new OutputPass()
	composer.addPass(bloom)
	composer.addPass(output)
	const pillar = box(0.05, 2.2, 0.05).translate(0, 1.1, 0)
	const tip = new THREE.OctahedronGeometry(0.18).translate(0, 2.35, 0)
	const grey = new THREE.MeshBasicMaterial({color: '#a1a1aa', opacity: 0.8, toneMapped: false, transparent: true})
	const cyan = new THREE.MeshBasicMaterial({color: STRANGER, opacity: 0.8, toneMapped: false, transparent: true})
	// Places and routes read grey, sightings of strangers cyan.
	const markerMaterials = {
		Note: grey,
		Place: grey,
		RouteAssaulted: grey,
		Sighting: cyan,
		Standing: grey
	} satisfies Record<MemoryEntry['_tag'], THREE.MeshBasicMaterial>

	const terrain = terrainMaterial()
	const chunks = MutableHashMap.empty<string, Chunk>()
	const hullMaterial = new THREE.MeshStandardMaterial({
		flatShading: true,
		metalness: 0.35,
		roughness: 0.6,
		vertexColors: true
	})
	const glowMaterial = new THREE.MeshBasicMaterial({toneMapped: false, vertexColors: true})
	function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, count: number) {
		const mesh = new THREE.InstancedMesh(geometry, material, count)
		mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
		mesh.setColorAt(0, WHITE)
		mesh.frustumCulled = false
		mesh.count = 0
		scene.add(mesh)
		return mesh
	}
	const meshes = MutableHashMap.fromIterable(
		Array.map(EntityKind.literals, kind => {
			const model: Model = MODELS[kind]
			return [
				kind,
				{
					// Each rotor is a ring on an arm in the hull; its blades are a separate instanced mesh so they can spin.
					hull: instanced(
						merge([
							...model.hull,
							...Array.flatMap(model.rotors, rotor => [
								{
									color: 0x3a3a42,
									geometry: new THREE.TorusGeometry(rotor[2], 0.022, 6, 22),
									tilt: Math.PI / 2,
									x: rotor[0],
									y: 0.06,
									z: rotor[1]
								},
								{
									color: 0x52525b,
									geometry: box(Math.hypot(rotor[0], rotor[1]), 0.035, 0.05),
									turn: -Math.atan2(rotor[1], rotor[0]),
									x: rotor[0] / 2,
									y: 0.04,
									z: rotor[1] / 2
								}
							])
						]),
						hullMaterial,
						MAX_INSTANCES
					),
					lights: instanced(merge(model.lights), glowMaterial, MAX_INSTANCES),
					model
				}
			] as const
		})
	)
	const blades = instanced(
		merge([
			{color: 0x8a8a92, geometry: box(1.9, 0.012, 0.045)},
			{color: 0x8a8a92, geometry: box(0.045, 0.012, 1.9)}
		]),
		hullMaterial,
		MAX_BLADES
	)
	// A miner's legs hang from the hip, so a rotation about x swings them; the drill bit points forward along z and spins about it.
	const legs = instanced(
		merge([{color: 0x3f3f46, geometry: box(0.11, 0.46, 0.13), y: -0.23}]),
		hullMaterial,
		MAX_INSTANCES * 2
	)
	const drills = instanced(
		merge([{color: 0x71717a, geometry: new THREE.ConeGeometry(0.08, 0.36, 6), tilt: Math.PI / 2, z: 0.18}]),
		hullMaterial,
		MAX_INSTANCES
	)
	const shadows = instanced(
		new THREE.CircleGeometry(0.35, 20).rotateX(-Math.PI / 2),
		new THREE.MeshBasicMaterial({color: '#000000', depthWrite: false, opacity: 0.35, transparent: true}),
		MAX_INSTANCES
	)
	// Each core sends out a ring that widens and fades; additive blending fades it through its instance color.
	const pulses = instanced(
		new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2),
		new THREE.MeshBasicMaterial({
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			side: THREE.DoubleSide,
			transparent: true
		}),
		256
	)
	// Selection rings skip the depth test: on a terrain step the higher tiles would otherwise cut them in half.
	function ring(color: string, opacity: number) {
		const mesh = new THREE.Mesh(
			new THREE.RingGeometry(0.5, 0.58, 40).rotateX(-Math.PI / 2),
			new THREE.MeshBasicMaterial({
				color,
				depthTest: false,
				depthWrite: false,
				opacity,
				side: THREE.DoubleSide,
				transparent: true
			})
		)
		mesh.renderOrder = 10
		scene.add(mesh)
		return mesh
	}
	const selection = ring('#f08a4b', 0.95)
	const hovering = ring('#ffffff', 0.35)
	const tracerAttribute = new THREE.BufferAttribute(TRACER_POSITIONS, 3).setUsage(THREE.DynamicDrawUsage)
	const tracers = new THREE.LineSegments(
		new THREE.BufferGeometry().setAttribute('position', tracerAttribute),
		new THREE.LineBasicMaterial({color: '#fdba74', toneMapped: false})
	)
	tracers.frustumCulled = false
	scene.add(tracers)

	const bodies = MutableHashMap.empty<number, Body>()
	// Per-frame instance counters, reset at the start of every draw.
	const counts = MutableHashMap.empty<EntityKind, number>()
	const extras = {blades: 0, drills: 0, legs: 0, pulses: 0, shadows: 0}
	const markers = MutableHashMap.empty<string, Marker>()
	const keys = MutableHashSet.empty<string>()
	const state: {
		buttons: boolean[]
		cameraVelocity: THREE.Vector3
		cameraX: number
		cameraY: number
		cameraZ: number
		controlled: boolean
		distance: number
		distanceVelocity: number
		drone?: number
		frame: number
		hover?: number
		lastSteer: number
		lastTime: number
		memory: number
		overview: boolean
		raf: number
		sentX: number
		sentZ: number
		offset?: number
		velocityX: number
		velocityZ: number
		view?: View
		zoom: number
	} = {
		buttons: [],
		cameraVelocity: new THREE.Vector3(),
		cameraX: 0,
		cameraY: 0,
		cameraZ: 0,
		controlled: false,
		distance: 40,
		distanceVelocity: 0,
		frame: -1,
		lastSteer: 0,
		lastTime: 0,
		memory: -1,
		overview: false,
		raf: 0,
		sentX: 0,
		sentZ: 0,
		velocityX: 0,
		velocityZ: 0,
		zoom: 1
	}

	function hud() {
		return Option.getOrUndefined(Option.flatMap(Option.fromUndefinedOr(state.view), current => current.hud))
	}

	function bodyOf(id?: number) {
		return Option.getOrUndefined(Option.flatMap(Option.fromUndefinedOr(id), found => MutableHashMap.get(bodies, found)))
	}

	function own() {
		const you = hud()?.you ?? ''
		return Array.sort(
			Array.filter(
				Array.fromIterable(MutableHashMap.values(bodies)),
				body => body.info.owner === you && body.info.kind !== 'glitch' && STATS[body.info.kind].speed > 0
			),
			byGroup
		)
	}

	function publish() {
		controls.focus({controlled: state.controlled, drone: state.drone, overview: state.overview})
	}

	function focus(drone: number) {
		state.drone = drone
		state.controlled = false
		state.overview = false
		publish()
	}

	function cycle(step: number) {
		const fleet = own()
		const index = Option.getOrElse(
			Array.findFirstIndex(fleet, body => body.id === state.drone),
			() => -1
		)
		const next = fleet[(index + step + fleet.length) % Number.max(1, fleet.length)]
		if (next !== undefined) focus(next.id)
	}

	function toggleControl() {
		const body = bodyOf(state.drone)
		state.controlled = body !== undefined && Array.some(own(), owned => owned.id === body.id) && !state.controlled
		state.overview = false
		publish()
	}

	// The overview only pulls the camera back; a drone you are flying stays under your control.
	function toggleOverview() {
		state.overview = !state.overview
		publish()
	}

	function release() {
		state.controlled = false
		state.overview = false
		publish()
	}

	function onKeyDown(event: KeyboardEvent) {
		if (typing(event)) return
		MutableHashSet.add(keys, event.code)
		if (event.code === 'Tab') event.preventDefault()
		if (event.repeat) return
		if (event.code === 'Tab') cycle(1 - 2 * bit(event.shiftKey))
		if (event.code === 'KeyF') toggleControl()
		if (event.code === 'KeyQ') toggleOverview()
		if (event.code === 'Escape') release()
	}

	function onKeyUp(event: KeyboardEvent) {
		MutableHashSet.remove(keys, event.code)
	}

	function onBlur() {
		MutableHashSet.clear(keys)
	}

	function onWheel(event: WheelEvent) {
		event.preventDefault()
		state.zoom = Number.clamp(state.zoom * Math.exp(event.deltaY * 0.001), {maximum: 4, minimum: 0.4})
	}

	// Picking projects every body to the screen and takes the nearest within 24 pixels.
	function pick(event: MouseEvent) {
		const rect = canvas.getBoundingClientRect()
		return pipe(
			Array.fromIterable(MutableHashMap.values(bodies)),
			Array.map(body => {
				PROJECTED.set(body.x, body.y, body.z).project(camera)
				return {
					body,
					distance: Math.hypot(
						((PROJECTED.x + 1) / 2) * rect.width - (event.clientX - rect.left),
						((1 - PROJECTED.y) / 2) * rect.height - (event.clientY - rect.top)
					)
				}
			}),
			Array.filter(candidate => candidate.distance < 24),
			Array.sort(byDistance),
			Array.head,
			Option.map(found => found.body.id),
			Option.getOrUndefined
		)
	}

	function onClick(event: MouseEvent) {
		const id = pick(event)
		if (id !== undefined) focus(id)
	}

	function onPointerMove(event: MouseEvent) {
		state.hover = pick(event)
		canvas.classList.toggle('cursor-pointer', state.hover !== undefined)
	}

	function resize() {
		renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
		composer.setSize(canvas.clientWidth, canvas.clientHeight)
		camera.aspect = canvas.clientWidth / Number.max(canvas.clientHeight, 1)
		camera.updateProjectionMatrix()
	}

	// The pad is polled once per frame; buttons act on the frame they go down.
	function gamepad() {
		const pad = Option.getOrUndefined(Array.findFirst(navigator.getGamepads(), candidate => candidate !== null))
		const buttons = Array.map(pad?.buttons ?? [], button => button.pressed)
		const down = Array.map(buttons, (held, index) => held && state.buttons[index] !== true)
		state.buttons = buttons
		if (down[0] === true) toggleControl()
		if (down[1] === true) release()
		if (down[3] === true) toggleOverview()
		if (down[4] === true) cycle(-1)
		if (down[5] === true) cycle(1)
		return pad
	}

	function upsert(info: EntityInfo, record: Float32Array, frame: number, at: number) {
		const id = record[0] ?? 0
		const x = record[1] ?? 0
		const z = record[2] ?? 0
		const heading = record[3] ?? 0
		const health = record[4] ?? 1
		const body = bodyOf(id)
		if (body === undefined) {
			MutableHashMap.set(bodies, id, {
				bank: 0,
				flags: record[5] ?? 0,
				flash: 0,
				gait: 0,
				heading,
				health,
				id,
				info,
				label: label(controls.labels, `${CODES[info.kind]}-${id}`),
				pitch: 0,
				seen: frame,
				targetHeading: heading,
				targetX: x,
				targetZ: z,
				trail: [{at, x, z}],
				vx: 0,
				vy: 0,
				vz: 0,
				x,
				y: groundAt(x, z) + MODELS[info.kind].altitude,
				z
			})
			return
		}
		const predicted = state.controlled && state.drone === id
		body.flash = Number.max(body.flash, bit(health < body.health - 0.001))
		body.flags = record[5] ?? 0
		body.health = health
		body.info = info
		body.seen = frame
		// A cut (a respawn, a relocated base) restarts the trail instead of sliding across the map.
		const cut = Math.hypot(x - body.targetX, z - body.targetZ) > 24
		body.trail = Array.append(Array.takeRight(body.trail, 7 * bit(!cut)), {at, x, z})
		// The controlled drone is predicted locally; the server only wins when it disagrees by more than a few tiles.
		if (predicted && Math.hypot(x - body.x, z - body.z) <= 6) return
		if (predicted || cut) {
			body.x = x
			body.z = z
		}
		body.targetHeading = heading
		body.targetX = x
		body.targetZ = z
	}

	function tracer(from: number, to: number) {
		const source = bodyOf(from)
		const target = bodyOf(to)
		if (source === undefined || target === undefined) return
		const slot = TRACERS.next % MAX_TRACERS
		TRACER_POSITIONS.set(
			[
				source.targetX,
				groundAt(source.targetX, source.targetZ) + MODELS[source.info.kind].altitude + 0.2,
				source.targetZ,
				target.targetX,
				groundAt(target.targetX, target.targetZ) + MODELS[target.info.kind].altitude + 0.4,
				target.targetZ
			],
			slot * 6
		)
		TRACER_LIFE.set([0.09], slot)
		TRACERS.next += 1
	}

	// Remembered places stand as named pillars sharing one geometry pair, so replacing one allocates no GPU memory.
	function syncMarkers(current: Hud) {
		const located = Array.filter(current.memory, entry => locate(entry) !== undefined)
		const wanted = HashSet.fromIterable(Array.map(located, entry => entry.key))
		for (const marker of Array.fromIterable(markers)) {
			if (!HashSet.has(wanted, marker[0])) {
				scene.remove(marker[1].group)
				marker[1].label.element.remove()
				MutableHashMap.remove(markers, marker[0])
			}
		}
		for (const entry of located) {
			const at = locate(entry)
			const existing = Option.getOrUndefined(MutableHashMap.get(markers, entry.key))
			if (at !== undefined && existing?.stamp !== entry.updatedAt) {
				if (existing !== undefined) {
					scene.remove(existing.group)
					existing.label.element.remove()
				}
				const material = markerMaterials[entry._tag]
				const group = new THREE.Group()
				group.add(new THREE.Mesh(pillar, material), new THREE.Mesh(tip, material))
				group.position.set(at.x, groundAt(at.x, at.z), at.z)
				scene.add(group)
				const created = label(controls.labels, `${MARKS[entry._tag]} ${String.replace(/^[a-z]+:/u, '')(entry.key)}`)
				created.element.style.borderColor = `#${material.color.getHexString()}`
				MutableHashMap.set(markers, entry.key, {at, group, label: created, stamp: entry.updatedAt})
			}
		}
	}

	// The server clock is the client clock plus the largest offset seen, the frame that came fastest; it decays 1 ms a frame to follow drift.
	function applyView(view: View, time: number) {
		state.offset = Number.max(view.at - time, (state.offset ?? view.at - time) - 1)
		for (const offset of Array.range(0, view.positions.length / STRIDE - 1)) {
			const record = view.positions.subarray(offset * STRIDE, offset * STRIDE + STRIDE)
			Option.map(HashMap.get(view.info, record[0] ?? 0), info => upsert(info, record, view.frame, view.at))
		}
		for (const body of Array.fromIterable(MutableHashMap.values(bodies))) {
			if (body.seen !== view.frame) {
				body.label.element.remove()
				MutableHashMap.remove(bodies, body.id)
			}
		}
		for (const shot of view.shots) tracer(shot[0], shot[1])
		const first = Array.head(own())
		if (bodyOf(state.drone) === undefined && Option.isSome(first)) Option.map(first, body => focus(body.id))
		Option.map(view.hud, current => {
			const stamp = Array.reduce(current.memory, current.memory.length, (sum, entry) => sum + entry.updatedAt)
			if (stamp !== state.memory) {
				state.memory = stamp
				syncMarkers(current)
			}
		})
	}

	// Without a HUD nobody is signed in, so the whole world shows as a flyover behind the sign-in panel.
	function bitsOf(key: string) {
		return Option.getOrElse(
			Option.map(
				Option.filter(Option.fromUndefinedOr(state.view), current => Option.isSome(current.hud)),
				current => Option.getOrElse(HashMap.get(current.explored, key), () => NOTHING)
			),
			() => EVERYTHING
		)
	}

	function knownAt(x: number, z: number) {
		const bits = bitsOf(chunkKey(chunkOf(x), chunkOf(z)))
		return bits !== undefined && explored(bits, tileIndex(x, z))
	}

	function syncChunks(radius: number) {
		const cx = chunkOf(state.cameraX)
		const cz = chunkOf(state.cameraZ)
		const wanted = Array.sort(
			Array.cartesian(Array.range(cx - radius, cx + radius), Array.range(cz - radius, cz + radius)),
			Order.mapInput(Order.Number, (pair: [number, number]) => Math.hypot(pair[0] - cx, pair[1] - cz))
		)
		// Chunk meshes rebuild nearest first for at most 3 ms a frame (one always goes), so exploring never stalls a frame.
		const budget = {deadline: performance.now() + 3, first: true}
		for (const pair of wanted) {
			const key = chunkKey(pair[0], pair[1])
			const bits = bitsOf(key)
			const depleted = Option.getOrElse(
				Option.flatMap(Option.fromUndefinedOr(state.view), current => HashMap.get(current.depletedChunks, key)),
				() => 0
			)
			const chunk = Option.getOrUndefined(MutableHashMap.get(chunks, key))
			const around = Array.map(NEIGHBOURS, offset => bitsOf(chunkKey(pair[0] + offset.x, pair[1] + offset.z)))
			if (
				(chunk === undefined ||
					chunk.bits !== bits ||
					chunk.depleted !== depleted ||
					Array.some(around, (neighbour, index) => chunk.around[index] !== neighbour)) &&
				(budget.first || performance.now() < budget.deadline)
			) {
				budget.first = false
				const geometry = buildChunk(pair[0], pair[1], state.view?.depleted ?? HashSet.empty(), knownAt, bits)
				chunk?.mesh.geometry.dispose()
				const mesh = chunk?.mesh ?? new THREE.Mesh(geometry, terrain)
				mesh.geometry = geometry
				scene.add(mesh)
				MutableHashMap.set(chunks, key, {around, bits, cx: pair[0], cz: pair[1], depleted, mesh})
			}
		}
		for (const chunk of Array.fromIterable(MutableHashMap.values(chunks))) {
			if (Math.abs(chunk.cx - cx) > radius + 2 || Math.abs(chunk.cz - cz) > radius + 2) {
				scene.remove(chunk.mesh)
				chunk.mesh.geometry.dispose()
				MutableHashMap.remove(chunks, chunkKey(chunk.cx, chunk.cz))
			}
		}
	}

	function steer(time: number, id: number, input: {x: number; z: number}, dt: number) {
		const body = bodyOf(id)
		if (body === undefined) return
		state.velocityX += (input.x * STATS[body.info.kind].speed - state.velocityX) * damp(7, dt)
		state.velocityZ += (input.z * STATS[body.info.kind].speed - state.velocityZ) * damp(7, dt)
		// The prediction parts from other units the way the server does, so the two stay in agreement.
		const push = separation(
			{id, mobile: true, size: STATS[body.info.kind].size, x: body.x, z: body.z},
			Array.map(
				Array.filter(
					Array.fromIterable(MutableHashMap.values(bodies)),
					other => Math.abs(other.x - body.x) < 4 && Math.abs(other.z - body.z) < 4
				),
				other => ({
					id: other.id,
					// Others do not yield to a predicted drone, so it takes the whole overlap.
					mobile: false,
					size: STATS[other.info.kind].size,
					x: other.x,
					z: other.z
				})
			)
		)
		// The terrain stops the prediction where it stops the server: a miner at a cliff or shore slides along it.
		const moved = stride(TERRAIN, body.info.kind, body, state.velocityX * dt + push.x, state.velocityZ * dt + push.z)
		state.velocityX *= bit(moved.x !== body.x || Math.abs(state.velocityX * dt + push.x) < 1e-6)
		state.velocityZ *= bit(moved.z !== body.z || Math.abs(state.velocityZ * dt + push.z) < 1e-6)
		body.x = moved.x
		body.z = moved.z
		body.targetX = body.x
		body.targetZ = body.z
		if (Math.hypot(state.velocityX, state.velocityZ) > 0.2) {
			body.targetHeading = Math.atan2(state.velocityX, state.velocityZ)
		}
		// Input goes out when it changes, at most every 50 ms, and every 200 ms as a keep-alive.
		if (
			(Math.abs(input.x - state.sentX) + Math.abs(input.z - state.sentZ) <= 0.05 || time - state.lastSteer <= 50) &&
			time - state.lastSteer <= 200
		) {
			return
		}
		state.lastSteer = time
		state.sentX = input.x
		state.sentZ = input.z
		controls.steer({drone: body.id, px: body.x, pz: body.z, x: input.x, z: input.z})
	}

	// The overview frames drones within 40 tiles of the anchor, so a far scout cannot push the base off screen.
	function aim(time: number) {
		const fleet = own()
		const anchor = bodyOf(state.drone) ?? Option.getOrUndefined(Array.head(fleet))
		// Signed out, the camera circles a dry stretch of highland, rock and ore found by probing the seeded world.
		if (anchor === undefined) {
			return {
				distance: 46,
				follow: false,
				x: -400 + Math.sin(time * 0.00003) * 40,
				y: groundAt(-400, -176),
				z: -176 + Math.cos(time * 0.00003) * 30
			}
		}
		// Following a drone, the camera looks at the drone itself, so it stays centred at any zoom and altitude.
		if (!state.overview) return {distance: 15 * state.zoom, follow: true, x: anchor.x, y: anchor.y, z: anchor.z}
		const cluster = Array.filter(fleet, body => Math.hypot(body.x - anchor.x, body.z - anchor.z) < 40)
		const xs = Array.map(cluster, body => body.x)
		const zs = Array.map(cluster, body => body.z)
		const left = Array.reduce(xs, anchor.x, Number.min)
		const right = Array.reduce(xs, anchor.x, Number.max)
		const top = Array.reduce(zs, anchor.z, Number.min)
		const bottom = Array.reduce(zs, anchor.z, Number.max)
		const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
		return {
			distance:
				Number.clamp(
					Number.max(
						((right - left) / 2 + 5) / (tangent * camera.aspect * 0.5),
						(((bottom - top) / 2 + 3) * 0.85) / tangent
					),
					{maximum: 95, minimum: 20}
				) * state.zoom,
			follow: false,
			x: (left + right) / 2,
			y: Number.max(0, groundAt((left + right) / 2, (top + bottom) / 2)),
			z: (top + bottom) / 2
		}
	}

	// A critically damped spring pans the camera between targets; once it has arrived on a followed drone it locks on, so a fast drone never drifts off centre. A jump of more than 24 tiles cuts.
	function frameCamera(time: number, dt: number) {
		const target = aim(time)
		const gap = Math.hypot(target.x - state.cameraX, target.z - state.cameraZ)
		if (gap > 24 || state.frame < 2 || (target.follow && gap < 0.5)) {
			state.cameraX = target.x
			state.cameraZ = target.z
			state.cameraVelocity.set(0, 0, 0)
		}
		state.cameraVelocity.x += ((target.x - state.cameraX) * 70 - state.cameraVelocity.x * 2 * Math.sqrt(70)) * dt
		state.cameraVelocity.z += ((target.z - state.cameraZ) * 70 - state.cameraVelocity.z * 2 * Math.sqrt(70)) * dt
		state.cameraX += state.cameraVelocity.x * dt
		state.cameraZ += state.cameraVelocity.z * dt
		state.cameraY += (target.y - state.cameraY) * damp(10, dt)
		state.distanceVelocity +=
			((target.distance - state.distance) * 45 - state.distanceVelocity * 2 * Math.sqrt(45)) * dt
		state.distance += state.distanceVelocity * dt
		camera.position.set(state.cameraX, state.cameraY, state.cameraZ).addScaledVector(VIEW_DIRECTION, state.distance)
		camera.lookAt(state.cameraX, state.cameraY, state.cameraZ)
		sun.position.set(state.cameraX - 8, 24, state.cameraZ + 10)
		sun.target.position.set(state.cameraX, 0, state.cameraZ)
	}

	function place(element: HTMLElement, x: number, y: number, z: number, show: boolean) {
		PROJECTED.set(x, y, z).project(camera)
		const visible = show && PROJECTED.z < 1 && Math.abs(PROJECTED.x) < 1.05 && Math.abs(PROJECTED.y) < 1.05
		element.classList.toggle('hidden', !visible)
		if (!visible) return
		element.style.setProperty(
			'transform',
			`translate(${((PROJECTED.x + 1) / 2) * canvas.clientWidth}px, ${((1 - PROJECTED.y) / 2) * canvas.clientHeight}px) translate(-50%, -100%)`
		)
	}

	// Other bodies are drawn where their trail puts them 160 ms of server time ago, so a late frame never stalls them; the controlled one moves by local prediction in steer.
	function glide(id: number, time: number, dt: number) {
		const body = bodyOf(id)
		if (body === undefined) return
		const remote = bit(!(state.controlled && body.id === state.drone))
		const now = sample(body.trail, time + (state.offset ?? 0) - 160)
		body.x += (now.x - body.x) * remote
		body.z += (now.z - body.z) * remote
		const vx = now.vx * remote + state.velocityX * (1 - remote)
		const vz = now.vz * remote + state.velocityZ * (1 - remote)
		// A moving body faces where it is drawn going, not where the newer server heading points.
		if (remote === 1 && Math.hypot(vx, vz) > 0.3) body.targetHeading = Math.atan2(vx, vz)
		// Bank into turns and pitch into acceleration, from the eased change in velocity across and along the heading.
		const ax = (vx - body.vx) * damp(8, dt)
		const az = (vz - body.vz) * damp(8, dt)
		body.vx += ax
		body.vz += az
		// Half a walk cycle, one footfall, every 0.45 tiles covered.
		body.gait += (Math.hypot(body.vx, body.vz) * dt * Math.PI) / 0.45
		const rate = 1 / Number.max(dt, 0.001)
		const forward = (Math.sin(body.heading) * ax + Math.cos(body.heading) * az) * rate
		const lateral = (Math.cos(body.heading) * ax - Math.sin(body.heading) * az) * rate
		body.heading +=
			Math.atan2(Math.sin(body.targetHeading - body.heading), Math.cos(body.targetHeading - body.heading)) *
			damp(12, dt)
		body.pitch +=
			(Number.clamp(forward * 0.012 + Math.hypot(body.vx, body.vz) * 0.025, {maximum: 0.35, minimum: -0.35}) -
				body.pitch) *
			damp(10, dt)
		body.bank += (Number.clamp(-lateral * 0.015, {maximum: 0.5, minimum: -0.5}) - body.bank) * damp(10, dt)
		body.flash = Number.max(0, body.flash - dt * 6)
		lift(id, dt)
	}

	// A walker's feet stay on the tile under it, stepping up or down a level in a few frames. A flier's height follows a critically damped spring toward the highest ground under it and along its next half second, so it starts climbing before a step and never cuts into it.
	function lift(id: number, dt: number) {
		const body = bodyOf(id)
		if (body === undefined) return
		if (body.info.kind === 'miner') {
			body.y += (groundAt(body.x, body.z) - body.y) * damp(25, dt)
			body.vy = 0
			return
		}
		const ground = Array.reduce(
			LOOKAHEAD,
			Array.reduce(SHADOW_CORNERS, groundAt(body.x, body.z), (top, corner) =>
				Number.max(top, groundAt(body.x + corner.x, body.z + corner.z))
			),
			(top, ahead) => Number.max(top, groundAt(body.x + body.vx * ahead, body.z + body.vz * ahead))
		)
		body.vy += ((ground + MODELS[body.info.kind].altitude - body.y) * 60 - body.vy * 2 * Math.sqrt(60)) * dt
		body.y += body.vy * dt
	}

	function instance(id: number, time: number) {
		const body = bodyOf(id)
		if (body === undefined) return
		const model: Model = MODELS[body.info.kind]
		const ground = groundAt(body.x, body.z)
		const flying = bit(model.altitude > 0)
		const walker = bit(body.info.kind === 'miner')
		const working = bit((body.flags & FLAG_WORKING) !== 0)
		// Fliers hover and lean. A walker dips at each footfall and rolls toward the planted foot; at work it shudders with the drill.
		const pace = Number.min(1, Math.hypot(body.vx, body.vz) / 1.5)
		const shudder = Math.sin(time * 0.06 + body.id) * 0.012 * working
		DUMMY.position.set(
			body.x,
			body.y +
				flying * Math.sin(time * 0.0026 + body.x) * 0.04 +
				walker * (Math.abs(Math.cos(body.gait)) * 0.05 * pace + shudder),
			body.z
		)
		DUMMY.rotation.set(
			body.pitch * flying + walker * (pace * 0.12 + working * 0.18),
			body.heading,
			-body.bank * flying + walker * Math.sin(body.gait) * 0.06 * pace,
			'YXZ'
		)
		if (body.info.kind === 'glitch') DUMMY.rotation.set(0, time * 0.002 + body.id, 0)
		DUMMY.updateMatrix()
		const index = Option.getOrElse(MutableHashMap.get(counts, body.info.kind), () => 0)
		MutableHashMap.set(counts, body.info.kind, index + 1)
		const entry = Option.getOrUndefined(MutableHashMap.get(meshes, body.info.kind))
		if (entry !== undefined && index < MAX_INSTANCES) {
			entry.hull.setMatrixAt(index, DUMMY.matrix)
			entry.hull.setColorAt(index, TINT.copy(WHITE).lerp(FLASH, body.flash))
			entry.lights.setMatrixAt(index, DUMMY.matrix)
			entry.lights.setColorAt(index, TINT.set(colorOf(body.info, hud())).multiplyScalar(1.6))
		}
		for (const rotor of model.rotors) {
			LOCAL.compose(
				OFFSET.set(rotor[0], 0.06, rotor[1]),
				SPIN.setFromAxisAngle(UP, time * 0.03 + body.id),
				SIZE.setScalar(rotor[2])
			)
			if (extras.blades < MAX_BLADES) blades.setMatrixAt(extras.blades, WORLD.multiplyMatrices(DUMMY.matrix, LOCAL))
			extras.blades += 1
		}
		if (walker === 1 && extras.legs < MAX_INSTANCES * 2 - 1) {
			// The legs swing opposite each other through the gait, a stride a little under a tile.
			for (const side of [-1, 1]) {
				LOCAL.makeRotationX(Math.sin(body.gait) * 0.55 * side * pace).setPosition(side * 0.16, 0.46, 0)
				legs.setMatrixAt(extras.legs, WORLD.multiplyMatrices(DUMMY.matrix, LOCAL))
				extras.legs += 1
			}
			LOCAL.compose(OFFSET.set(0, 0.52, 0.36), SPIN.setFromAxisAngle(FORWARD, time * 0.03 * working), SIZE.setScalar(1))
			drills.setMatrixAt(extras.drills, WORLD.multiplyMatrices(DUMMY.matrix, LOCAL))
			extras.drills += 1
		}
		if (flying === 1 && extras.shadows < MAX_INSTANCES) {
			// The shadow lies on the highest tile under it, so a step beside the drone never cuts it.
			const floor = Array.reduce(SHADOW_CORNERS, ground, (top, corner) =>
				Number.max(top, groundAt(body.x + corner.x, body.z + corner.z))
			)
			DUMMY.position.set(body.x, floor + 0.02, body.z)
			DUMMY.rotation.set(0, 0, 0)
			DUMMY.updateMatrix()
			shadows.setMatrixAt(extras.shadows, DUMMY.matrix)
			extras.shadows += 1
		}
		if (body.info.kind === 'core' && extras.pulses < 256) {
			DUMMY.position.set(body.x, ground + 0.05, body.z)
			DUMMY.rotation.set(0, 0, 0)
			DUMMY.scale.setScalar(1 + ((time * 0.0008) % 1) * 1.6)
			DUMMY.updateMatrix()
			DUMMY.scale.setScalar(1)
			pulses.setMatrixAt(extras.pulses, DUMMY.matrix)
			pulses.setColorAt(extras.pulses, TINT.copy(FLASH).multiplyScalar(1 - ((time * 0.0008) % 1)))
			extras.pulses += 1
		}
	}

	// Labels show for the drone you are on, what the pointer is over, strangers, cores, and your fleet in the overview.
	function tag(id: number) {
		const body = bodyOf(id)
		const current = hud()
		if (body === undefined) return
		const mine = body.info.owner === current?.you
		body.label.element.style.borderColor = colorOf(body.info, current)
		const code = `${CODES[body.info.kind]}-${body.id}`
		if (mine) relabel(body.label, code, body.health)
		if (!mine) relabel(body.label, `${code} · ${body.info.owner || 'glitch'}`, body.health)
		place(
			body.label.element,
			body.x,
			body.y + 0.55 + 1.6 * bit(body.info.kind === 'core'),
			body.z,
			body.id === state.drone ||
				body.id === state.hover ||
				!mine ||
				body.info.kind === 'core' ||
				(state.overview && STATS[body.info.kind].speed > 0)
		)
		body.label.element.classList.toggle('bg-primary', body.id === state.drone)
		body.label.element.classList.toggle('text-primary-foreground', body.id === state.drone)
	}

	function draw(time: number, dt: number) {
		MutableHashMap.clear(counts)
		extras.blades = 0
		extras.drills = 0
		extras.legs = 0
		extras.pulses = 0
		extras.shadows = 0
		for (const id of Array.fromIterable(MutableHashMap.keys(bodies))) {
			glide(id, time, dt)
			instance(id, time)
			tag(id)
		}
		for (const entry of meshes) {
			const count = Option.getOrElse(MutableHashMap.get(counts, entry[0]), () => 0)
			for (const mesh of [entry[1].hull, entry[1].lights]) {
				mesh.count = Number.min(count, MAX_INSTANCES)
				mesh.instanceMatrix.needsUpdate = true
				if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
			}
		}
		blades.count = Number.min(extras.blades, MAX_BLADES)
		drills.count = extras.drills
		legs.count = extras.legs
		shadows.count = extras.shadows
		pulses.count = extras.pulses
		for (const mesh of [blades, drills, legs, shadows, pulses]) mesh.instanceMatrix.needsUpdate = true
		if (pulses.instanceColor !== null) pulses.instanceColor.needsUpdate = true
	}

	// Markers, tracers and the selection and hover rings.
	function decorate(time: number, dt: number) {
		const focused = bodyOf(state.drone)
		for (const marker of MutableHashMap.values(markers)) {
			marker.group.rotation.y = time * 0.0015
			place(marker.label.element, marker.at.x, groundAt(marker.at.x, marker.at.z) + 2.7, marker.at.z, true)
		}
		for (const slot of Array.range(0, MAX_TRACERS - 1)) {
			const life = Number.max(0, (TRACER_LIFE[slot] ?? 0) - dt)
			TRACER_LIFE.set([life], slot)
			if (life <= 0) TRACER_POSITIONS.set([0, -99, 0, 0, -99, 0], slot * 6)
		}
		tracerAttribute.needsUpdate = true
		const hovered = bodyOf(state.hover)
		selection.visible = focused !== undefined
		hovering.visible = hovered !== undefined && hovered.id !== state.drone
		if (focused !== undefined) {
			selection.position.set(focused.x, groundAt(focused.x, focused.z) + 0.04, focused.z)
			selection.scale.setScalar((1 + Math.sin(time * 0.006) * 0.06) * (1 + bit(state.controlled) * 0.4))
		}
		if (hovered !== undefined) hovering.position.set(hovered.x, groundAt(hovered.x, hovered.z) + 0.04, hovered.z)
	}

	// Each second resolution drops a step under 50 fps and climbs above 75 fps; a gap over 250 ms is a hidden tab.
	function adapt(gap: number) {
		if (gap > 250) return
		quality.frames += 1
		quality.total += gap
		if (quality.total < 1000) return
		const average = quality.total / quality.frames
		quality.frames = 0
		quality.total = 0
		const ratio = Number.clamp(quality.ratio - 0.25 * bit(average > 20) + 0.25 * bit(average < 13.3), {
			maximum: Number.min(devicePixelRatio, 1.5),
			minimum: 0.75
		})
		if (ratio === quality.ratio) return
		quality.ratio = ratio
		renderer.setPixelRatio(ratio)
		composer.setPixelRatio(ratio)
		resize()
	}

	function render(time: number) {
		state.raf = requestAnimationFrame(render)
		adapt(time - state.lastTime)
		const dt = Number.clamp((time - state.lastTime) / 1000, {maximum: 0.05, minimum: 0})
		state.lastTime = time
		if (state.view !== undefined && state.view.frame !== state.frame) {
			state.frame = state.view.frame
			applyView(state.view, time)
		}
		const pad = gamepad()
		if (state.controlled && state.drone !== undefined) steer(time, state.drone, movement(keys, pad), dt)
		draw(time, dt)
		decorate(time, dt)
		frameCamera(time, dt)
		syncChunks(Number.clamp(Math.ceil((state.distance * 0.9) / CHUNK) + 1, {maximum: 6, minimum: 2}))
		composer.render()
	}

	const observer = new ResizeObserver(resize)
	observer.observe(canvas)
	resize()
	addEventListener('keydown', onKeyDown)
	addEventListener('keyup', onKeyUp)
	addEventListener('blur', onBlur)
	canvas.addEventListener('wheel', onWheel, {passive: false})
	canvas.addEventListener('click', onClick)
	canvas.addEventListener('pointermove', onPointerMove)
	state.raf = requestAnimationFrame(render)

	return {
		dispose() {
			cancelAnimationFrame(state.raf)
			observer.disconnect()
			removeEventListener('keydown', onKeyDown)
			removeEventListener('keyup', onKeyUp)
			removeEventListener('blur', onBlur)
			canvas.removeEventListener('wheel', onWheel)
			canvas.removeEventListener('click', onClick)
			canvas.removeEventListener('pointermove', onPointerMove)
			for (const chunk of MutableHashMap.values(chunks)) chunk.mesh.geometry.dispose()
			controls.labels.replaceChildren()
			for (const resource of [pillar, tip, grey, cyan, bloom, output]) resource.dispose()
			composer.dispose()
			renderer.dispose()
		},
		focus,
		setView(view: View) {
			state.view = view
		}
	}
}
