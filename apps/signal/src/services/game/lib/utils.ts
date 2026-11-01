import {Array, Number, Option, Record} from 'effect'

import type {
	BuildingKind,
	EnemyKind,
	GateId,
	ItemId,
	MobKind,
	Point,
	RecipeId,
	StructureKind,
	UnitClass,
	UnitKind
} from '#services/game/schema.ts'
import type {Material} from '#services/world/schema.ts'

// Each body's footprint as its model is drawn, in tiles: a capsule along its heading, `radius` its half width, its round ends' centres `reach` ahead of and behind its middle, which lies `ahead` in front of its place.
const BODIES = {
	burrower: {ahead: 0, radius: 0.6, reach: 0},
	cart: {ahead: 0.06, radius: 0.5, reach: 0.3},
	crawler: {ahead: -0.2, radius: 0.5, reach: 0.22},
	digger: {ahead: 0.45, radius: 0.46, reach: 0.65},
	dozer: {ahead: 0.25, radius: 0.5, reach: 0.3},
	drifter: {ahead: 0, radius: 0.45, reach: 0},
	glitch: {ahead: 0.05, radius: 0.48, reach: 0.04},
	golem: {ahead: 0.3, radius: 0.6, reach: 0},
	grazer: {ahead: 0.1, radius: 0.19, reach: 0.55},
	hare: {ahead: 0, radius: 0.12, reach: 0.05},
	lizard: {ahead: -0.1, radius: 0.22, reach: 0.25},
	loader: {ahead: 0, radius: 0.2, reach: 0},
	lurker: {ahead: 0, radius: 0.65, reach: 0},
	rotor: {ahead: 0, radius: 0.3, reach: 0},
	ruinsentry: {ahead: 0, radius: 0.6, reach: 0.08},
	scrapdog: {ahead: 0, radius: 0.16, reach: 0.52},
	sentry: {ahead: 0.18, radius: 0.36, reach: 0.28},
	skiff: {ahead: 0, radius: 0.62, reach: 0.22},
	skimmer: {ahead: 0.05, radius: 0.75, reach: 0},
	strider: {ahead: 0, radius: 0.62, reach: 0},
	worker: {ahead: 0, radius: 0.26, reach: 0.08},
	yak: {ahead: 0.1, radius: 0.33, reach: 0.25}
} satisfies Record<
	EnemyKind | UnitKind | 'grazer' | 'hare' | 'lizard' | 'yak',
	{ahead: number; radius: number; reach: number}
>

// The sim runs 20 ticks a second and sends each client 10 frames a second.
export const TICK_HZ = 20
export const FRAME_HZ = 10

// A world tick is TICK seconds; a round, when every team's model gives its commands, is ROUND ticks.
export const TICK = 0.05
export const ROUND = 600

// The teams, one a start basin, each run by its own model.
export const TEAMS = [
	{color: '#4d6bfe', model: 'deepseek/deepseek-v4.1-flash-1017', name: 'DeepSeek'},
	{color: '#ff6900', model: 'xiaomi/mimo-v2.6-flash', name: 'MiMo'},
	{color: '#d9dce3', model: 'z-ai/glm-5.3-flash', name: 'GLM'}
]

// The model each unit class is drawn as, by mark.
export const KINDS: Record<UnitClass, [UnitKind, UnitKind, UnitKind]> = {
	builder: ['worker', 'dozer', 'strider'],
	guard: ['sentry', 'strider', 'skiff'],
	hauler: ['cart', 'digger', 'skiff'],
	scout: ['loader', 'rotor', 'rotor']
}

// A kind's footprint; kinds that never touch ground, a small round one.
export function shapeOf(kind: string) {
	const shapes: Record.ReadonlyRecord<string, {ahead: number; radius: number; reach: number}> = BODIES
	return Option.getOrElse(Record.get(shapes, kind), () => ({ahead: 0, radius: 0.3, reach: 0}))
}

// A body's capsule where it stands and faces: its two end centres and its half width.
export function capsuleOf(body: {kind: string; x: number; yaw: number; z: number}) {
	const shape = shapeOf(body.kind)
	const facing = {x: Math.sin(body.yaw), z: Math.cos(body.yaw)}
	const middle = {x: body.x + facing.x * shape.ahead, z: body.z + facing.z * shape.ahead}
	return {
		back: {x: middle.x - facing.x * shape.reach, z: middle.z - facing.z * shape.reach},
		front: {x: middle.x + facing.x * shape.reach, z: middle.z + facing.z * shape.reach},
		radius: shape.radius
	}
}

// The point of a segment nearest another point.
export function nearestOn(from: Point, to: Point, point: Point) {
	const span = {x: to.x - from.x, z: to.z - from.z}
	const length = span.x * span.x + span.z * span.z
	if (length < 1e-9) return from
	const share = Number.clamp(((point.x - from.x) * span.x + (point.z - from.z) * span.z) / length, {
		maximum: 1,
		minimum: 0
	})
	return {x: from.x + span.x * share, z: from.z + span.z * share}
}

// Where two segments cross, if they do.
function crossingOf(first: {back: Point; front: Point}, second: {back: Point; front: Point}) {
	const a = {x: first.front.x - first.back.x, z: first.front.z - first.back.z}
	const b = {x: second.front.x - second.back.x, z: second.front.z - second.back.z}
	const across = a.x * b.z - a.z * b.x
	if (Math.abs(across) < 1e-9) return Option.none()
	const gap = {x: second.back.x - first.back.x, z: second.back.z - first.back.z}
	const s = (gap.x * b.z - gap.z * b.x) / across
	const t = (gap.x * a.z - gap.z * a.x) / across
	if (s < 0 || s > 1 || t < 0 || t > 1) return Option.none()
	const at = {x: first.back.x + a.x * s, z: first.back.z + a.z * s}
	return Option.some({from: at, to: at})
}

// The nearest pair of points on two segments, one on each: the segments' ends against each other, and their crossing when they cross.
export function nearestPair(first: {back: Point; front: Point}, second: {back: Point; front: Point}) {
	const candidates = [
		...Option.toArray(crossingOf(first, second)),
		{from: first.back, to: nearestOn(second.back, second.front, first.back)},
		{from: first.front, to: nearestOn(second.back, second.front, first.front)},
		{from: nearestOn(first.back, first.front, second.back), to: second.back},
		{from: nearestOn(first.back, first.front, second.front), to: second.front}
	]
	return Array.reduce(Array.drop(candidates, 1), candidates[0] ?? {from: first.back, to: second.back}, (best, pair) => {
		if (
			Math.hypot(pair.to.x - pair.from.x, pair.to.z - pair.from.z) <
			Math.hypot(best.to.x - best.from.x, best.to.z - best.from.z)
		) {
			return pair
		}
		return best
	})
}

// How far Home sees, in tiles.
export const HOME_SIGHT = 14

// The hostile each biome sends, in Biome order.
export const ENEMIES = [
	'scrapdog',
	'skimmer',
	'burrower',
	'golem',
	'crawler',
	'ruinsentry',
	'drifter',
	'lurker',
	'skimmer',
	'skimmer',
	'golem',
	'glitch',
	'lurker',
	'burrower',
	'golem',
	'golem',
	'scrapdog'
] satisfies EnemyKind[]

// How each creature lives: walkers wander and bolt, fliers take off and land elsewhere, swarms and fish stay at their spot; speeds in tiles a second, the name its card shows and what it does when left alone.
export const CREATURES = {
	beetles: {flee: 0, life: 'swarm', name: 'Heat beetles', rest: 'basking at a vent', walk: 0},
	bird: {flee: 1.5, life: 'flier', name: 'Bird drone', rest: 'pecking at the ground', walk: 0},
	fireflies: {flee: 0, life: 'swarm', name: 'Fireflies', rest: 'blinking over the grass', walk: 0},
	fish: {flee: 0, life: 'fish', name: 'Leaping fish', rest: 'schooling under the surface', walk: 0},
	grazer: {flee: 1.7, life: 'walker', name: 'Grazer', rest: 'grazing', walk: 0.48},
	hare: {flee: 1.35, life: 'walker', name: 'Snow hare', rest: 'sitting still, ears up', walk: 0.34},
	heron: {flee: 1.1, life: 'flier', name: 'Heron', rest: 'stalking the shallows', walk: 0},
	jellies: {flee: 0, life: 'swarm', name: 'Glow jellies', rest: 'drifting and pulsing', walk: 0},
	lizard: {flee: 1.8, life: 'walker', name: 'Rock lizard', rest: 'basking, doing push-ups', walk: 1.2},
	moths: {flee: 0, life: 'swarm', name: 'Ruin moths', rest: 'circling an old lamp', walk: 0},
	yak: {flee: 0.8, life: 'walker', name: 'Frost yak', rest: 'standing in the snow', walk: 0.27}
} satisfies Record<
	MobKind,
	{flee: number; life: 'fish' | 'flier' | 'swarm' | 'walker'; name: string; rest: string; walk: number}
>

// The wildlife of each biome, in Biome order: per 16-tile patch of land, the chance of a group and how many in it.
export const WILDLIFE: {chance: number; kind: MobKind; most: number}[][] = [
	[
		{chance: 0.3, kind: 'grazer', most: 4},
		{chance: 0.2, kind: 'bird', most: 1}
	],
	[
		{chance: 0.25, kind: 'heron', most: 1},
		{chance: 0.25, kind: 'fireflies', most: 1},
		{chance: 0.25, kind: 'fish', most: 1}
	],
	[{chance: 0.35, kind: 'lizard', most: 2}],
	[
		{chance: 0.3, kind: 'yak', most: 3},
		{chance: 0.25, kind: 'hare', most: 2}
	],
	[{chance: 0.35, kind: 'beetles', most: 1}],
	[
		{chance: 0.3, kind: 'moths', most: 1},
		{chance: 0.2, kind: 'bird', most: 1}
	],
	[{chance: 0.35, kind: 'jellies', most: 1}],
	[
		{chance: 0.25, kind: 'bird', most: 1},
		{chance: 0.25, kind: 'lizard', most: 1}
	],
	[{chance: 0.3, kind: 'lizard', most: 2}],
	[{chance: 0.35, kind: 'lizard', most: 2}],
	[
		{chance: 0.25, kind: 'heron', most: 1},
		{chance: 0.2, kind: 'bird', most: 1}
	],
	[
		{chance: 0.3, kind: 'heron', most: 1},
		{chance: 0.25, kind: 'fireflies', most: 1},
		{chance: 0.2, kind: 'fish', most: 1}
	],
	[
		{chance: 0.4, kind: 'fish', most: 1},
		{chance: 0.2, kind: 'heron', most: 1}
	],
	[
		{chance: 0.3, kind: 'lizard', most: 2},
		{chance: 0.2, kind: 'bird', most: 1}
	],
	[
		{chance: 0.3, kind: 'jellies', most: 1},
		{chance: 0.25, kind: 'hare', most: 2}
	],
	[
		{chance: 0.3, kind: 'yak', most: 3},
		{chance: 0.3, kind: 'hare', most: 2}
	],
	[
		{chance: 0.3, kind: 'grazer', most: 3},
		{chance: 0.25, kind: 'bird', most: 1},
		{chance: 0.2, kind: 'hare', most: 1}
	]
]

// Props a Builder clears for wood, and those for stone; how much each gives at full size.
export const TIMBER = ['tree', 'pine', 'maple', 'snag', 'bamboo', 'cactus']
export const BOULDERS = ['rock', 'spire', 'hoodoo', 'crystal', 'coral', 'shard']
export function yieldOf(prop: {kind: string; s: number}) {
	return Number.max(2, Number.round(3 * prop.s, 0))
}

// Signal's production tree: what teams gather, make, build and pay to move up. Footprints are tiles [across, deep], power is MW, rates are items a second, fluids are units (u) and u/s, time is seconds.

export type Items = Partial<Record<ItemId, number>>

// What a tile of each world material yields when mined, by hand or by a Miner.
export const ORE_ITEM: Record<Material, ItemId> = {
	bauxite: 'bauxite',
	coal: 'coal',
	cobalt: 'cobalt',
	copper: 'copper_ore',
	crystal: 'crystal',
	iron: 'iron_ore',
	lumen: 'lumen',
	peat: 'peat',
	quartz: 'quartz',
	stone: 'stone',
	sulfur: 'sulfur',
	tungsten: 'tungsten'
}

// Moves in pipes, never in crates, on belts or in a cargo bed.
export const FLUIDS: ItemId[] = ['water', 'fuel', 'acid']

// Each milestone: where its items are delivered, what must be done first, and its name. It unlocks every building, structure, recipe and unit mark whose `tier` it is. Delivered items are consumed by the milestone; there is no global counter.
export const GATES: Record<GateId, {at: 'beacon' | 'home'; cost: Items; name: string; needs: GateId}> = {
	p1: {at: 'beacon', cost: {concrete: 20, frame: 10, wire: 40}, name: 'Phase 1: Mast', needs: 't2'},
	p2: {at: 'beacon', cost: {circuit: 40, frame: 30, motor: 20, steel_beam: 40}, name: 'Phase 2: Dish', needs: 't4'},
	p3: {at: 'beacon', cost: {computer: 20, motor: 40, plastic: 80, steel_beam: 80}, name: 'Phase 3: Array', needs: 't6'},
	p4: {
		at: 'beacon',
		cost: {battery: 40, computer: 60, heavy_frame: 30, lens: 30},
		name: 'Phase 4: Engine',
		needs: 't8'
	},
	t0: {at: 'home', cost: {}, name: 'Camp', needs: 't0'},
	t1: {at: 'home', cost: {iron_plate: 10, iron_rod: 10}, name: 'Workshop', needs: 't0'},
	t2: {at: 'home', cost: {iron_plate: 30, iron_rod: 15, wire: 20}, name: 'Industry', needs: 't1'},
	t3: {at: 'home', cost: {concrete: 30, frame: 10, iron_rod: 40}, name: 'Steel and Steam', needs: 'p1'},
	t4: {at: 'home', cost: {frame: 20, steel_beam: 20, steel_pipe: 20}, name: 'Motion', needs: 'p1'},
	t5: {
		at: 'home',
		cost: {circuit: 30, concrete: 60, motor: 20, peat: 10, quartz: 10, steel_pipe: 40, sulfur: 10},
		name: 'Chemistry',
		needs: 'p2'
	},
	t6: {at: 'home', cost: {circuit: 60, plastic: 40, steel_beam: 40}, name: 'Factory', needs: 'p2'},
	t7: {
		at: 'home',
		cost: {bauxite: 10, cobalt: 10, computer: 30, motor: 40, plastic: 60},
		name: 'Light Metals',
		needs: 'p3'
	},
	t8: {
		at: 'home',
		cost: {aluminium_sheet: 60, computer: 40, crystal: 10, plastic: 80, tungsten: 10},
		name: 'Heavy Industry',
		needs: 't7'
	},
	t9: {
		at: 'home',
		cost: {battery: 80, computer: 100, heavy_frame: 50, lens: 50, lumen: 10},
		name: 'Lumen Age',
		needs: 'p4'
	}
}

// What Signal cycle n (from 1) costs at the Beacon once Tier 9 is done: a fifth more than the one before, rounded up. Cycles only count; they unlock nothing.
export function cycleCost(n: number) {
	const scale = 1.2 ** (n - 1)
	return {
		heavy_frame: Math.ceil(10 * scale),
		lumen_cell: Math.ceil(10 * scale),
		signal_core: Math.ceil(5 * scale)
	} satisfies Items
}

// A unit class's stats at each mark. Home makes a mark 1 from items; a mark 2 or 3 is an upgrade at Home that consumes a unit of the mark before. `clear` is seconds a tree or a rock takes to clear, `gather` seconds an item takes by hand, `damage` health a hit takes.
export type Mark = {
	cargo: number
	clear?: {rock: number; tree: number}
	cost: Items
	damage?: number
	gather?: number
	health: number
	mover: 'fly' | 'hover' | 'legs' | 'stride' | 'tracks' | 'wheels'
	seconds: number
	sight: number
	speed: number
	tier: GateId
}

export const UNITS: Record<UnitClass, {job: string; marks: [Mark, Mark, Mark]}> = {
	builder: {
		job: 'gathers ore, wood and stone by hand, clears trees and rocks, carries items, builds, lays belts, pipes and poles, repairs',
		marks: [
			{
				cargo: 10,
				clear: {rock: 12, tree: 6},
				cost: {iron_plate: 8, iron_rod: 4},
				gather: 2,
				health: 60,
				mover: 'legs',
				seconds: 20,
				sight: 7,
				speed: 0.9,
				tier: 't0'
			},
			{
				cargo: 20,
				clear: {rock: 6, tree: 3},
				cost: {circuit: 2, motor: 2, steel_beam: 4},
				gather: 1,
				health: 120,
				mover: 'tracks',
				seconds: 40,
				sight: 7,
				speed: 0.8,
				tier: 't4'
			},
			{
				cargo: 30,
				clear: {rock: 3, tree: 1.5},
				cost: {aluminium_sheet: 8, computer: 1, motor: 4},
				gather: 0.5,
				health: 160,
				mover: 'stride',
				seconds: 60,
				sight: 9,
				speed: 1.1,
				tier: 't8'
			}
		]
	},
	guard: {
		job: 'can hold a position or choose to attack a visible entity; no automatic enemy classification',
		marks: [
			{
				cargo: 0,
				cost: {iron_plate: 12, iron_rod: 10},
				damage: 1,
				health: 100,
				mover: 'tracks',
				seconds: 20,
				sight: 10,
				speed: 0.75,
				tier: 't0'
			},
			{
				cargo: 0,
				cost: {circuit: 2, motor: 2, steel_beam: 8},
				damage: 2,
				health: 180,
				mover: 'stride',
				seconds: 40,
				sight: 10,
				speed: 1,
				tier: 't4'
			},
			{
				cargo: 0,
				cost: {aluminium_sheet: 6, computer: 1, tungsten_carbide: 6},
				damage: 4,
				health: 300,
				mover: 'hover',
				seconds: 60,
				sight: 12,
				speed: 1.5,
				tier: 't8'
			}
		]
	},
	hauler: {
		job: 'carries items between two stops (a crate, a machine or Home) wherever no belt runs',
		marks: [
			{
				cargo: 40,
				cost: {iron_plate: 10, iron_rod: 8},
				health: 80,
				mover: 'wheels',
				seconds: 20,
				sight: 7,
				speed: 1.6,
				tier: 't0'
			},
			{
				cargo: 90,
				cost: {frame: 2, motor: 3, steel_beam: 6},
				health: 140,
				mover: 'tracks',
				seconds: 40,
				sight: 7,
				speed: 1,
				tier: 't4'
			},
			{
				cargo: 160,
				cost: {aluminium_sheet: 12, battery: 2, motor: 6},
				health: 180,
				mover: 'hover',
				seconds: 60,
				sight: 8,
				speed: 2,
				tier: 't8'
			}
		]
	},
	scout: {
		job: 'flies over anything, reveals the map and finds ore fields',
		marks: [
			{
				cargo: 0,
				cost: {iron_plate: 4, iron_rod: 2},
				health: 40,
				mover: 'fly',
				seconds: 20,
				sight: 8,
				speed: 2.2,
				tier: 't0'
			},
			{
				cargo: 0,
				cost: {circuit: 4, motor: 1, steel_pipe: 2},
				health: 50,
				mover: 'fly',
				seconds: 40,
				sight: 14,
				speed: 2.6,
				tier: 't4'
			},
			{
				cargo: 0,
				cost: {battery: 1, computer: 1, lens: 2},
				health: 80,
				mover: 'fly',
				seconds: 60,
				sight: 22,
				speed: 3.4,
				tier: 't8'
			}
		]
	}
}

// A class's stats at a mark, the first mark's past the last.
export function markOf(unit: {class: UnitClass; mark: number}) {
	const marks = UNITS[unit.class].marks
	return marks[unit.mark] ?? marks[0]
}

// `mw` is power drawn, a generator's negative; `fuels` the MJ each item gives a generator, burnt in proportion to the load; `water` u/s it needs; `capacity` the items a crate holds; `rate` items a second a Miner digs.
export type Building = {
	capacity?: number
	cost: Items
	fuels?: Items
	mw: number
	note: string
	// Solid in, solid out, fluid in, fluid out.
	ports: [number, number, number, number]
	rate?: number
	size: [number, number]
	tier: GateId
	water?: number
}

// Every building a Builder raises from items it fetches from the nearest crate or Home. A machine takes items into its input ports and fills its output buffer; a belt, an adjacent machine, a Hauler or a Builder moves them on. A machine without power idles; a brownout slows every machine on the network by supply over demand and never trips.
export const BUILDINGS: Record<BuildingKind, Building> = {
	assembler: {
		cost: {iron_plate: 16, iron_rod: 8, wire: 20},
		mw: 15,
		note: 'Two input items to one output item.',
		ports: [2, 1, 0, 0],
		size: [3, 3],
		tier: 't2'
	},
	beacon: {
		cost: {concrete: 40, iron_plate: 30, iron_rod: 40, wire: 60},
		mw: 0,
		note: 'One a team. Phases and the endless Signal cycles are delivered here.',
		ports: [4, 0, 0, 0],
		size: [5, 5],
		tier: 't2'
	},
	burner_generator: {
		cost: {iron_plate: 6, iron_rod: 4, wire: 6},
		fuels: {coal: 300, peat: 200, wood: 150},
		mw: -30,
		note: 'Supplies 30 MW from solid fuel, no water. The first power.',
		ports: [1, 0, 0, 0],
		size: [2, 2],
		tier: 't1'
	},
	core_generator: {
		cost: {battery: 10, computer: 20, concrete: 100, heavy_frame: 10, lens: 10},
		fuels: {lumen_cell: 72_000},
		mw: -600,
		note: 'Supplies 600 MW; a lumen cell lasts 120 s. Needs 4 u/s of water to cool.',
		ports: [1, 0, 1, 0],
		size: [4, 4],
		tier: 't9',
		water: 4
	},
	crate_mk1: {
		capacity: 150,
		cost: {wood: 10},
		mw: 0,
		note: 'Holds any mix of items; belts and Haulers load and unload it.',
		ports: [1, 1, 0, 0],
		size: [1, 2],
		tier: 't0'
	},
	crate_mk2: {
		capacity: 600,
		cost: {concrete: 8, steel_beam: 2},
		mw: 0,
		note: 'Holds any mix of items; belts and Haulers load and unload it.',
		ports: [1, 1, 0, 0],
		size: [2, 2],
		tier: 't3'
	},
	crate_mk3: {
		capacity: 2400,
		cost: {concrete: 20, plastic: 6, steel_beam: 6},
		mw: 0,
		note: 'Holds any mix of items; belts and Haulers load and unload it.',
		ports: [1, 1, 0, 0],
		size: [3, 2],
		tier: 't6'
	},
	fabricator: {
		cost: {iron_plate: 8, wire: 8},
		mw: 4,
		note: 'One input item to one output item.',
		ports: [1, 1, 0, 0],
		size: [2, 2],
		tier: 't1'
	},
	foundry: {
		cost: {concrete: 20, frame: 6, iron_rod: 10},
		mw: 16,
		note: 'Alloys and hot metal: two inputs to one output.',
		ports: [2, 1, 0, 0],
		size: [3, 2],
		tier: 't3'
	},
	furnace: {
		cost: {stone: 10},
		mw: 0,
		note: 'No power: its fuel is an ingredient. Slow, and never in the way once the Smelter arrives.',
		ports: [2, 1, 0, 0],
		size: [2, 2],
		tier: 't0'
	},
	home: {
		cost: {},
		mw: 0,
		note: 'Given. Storage, where tiers are paid, a slow workbench and the only unit line.',
		ports: [0, 0, 0, 0],
		size: [3, 3],
		tier: 't0'
	},
	manufacturer: {
		cost: {circuit: 20, motor: 8, plastic: 10, steel_beam: 10},
		mw: 55,
		note: 'Up to four inputs to one output.',
		ports: [4, 1, 0, 0],
		size: [4, 4],
		tier: 't6'
	},
	miner_mk1: {
		cost: {iron_ingot: 8, stone: 4},
		mw: 0,
		note: 'On an ore field: mines the tiles under it and the ring round them into a 40-item buffer. Fields run dry.',
		ports: [0, 1, 0, 0],
		rate: 0.25,
		size: [2, 2],
		tier: 't0'
	},
	miner_mk2: {
		cost: {concrete: 4, iron_plate: 12, wire: 12},
		mw: 5,
		note: 'On an ore field: mines the tiles under it and the ring round them into a 40-item buffer. Fields run dry.',
		ports: [0, 1, 0, 0],
		rate: 0.5,
		size: [2, 2],
		tier: 't2'
	},
	miner_mk3: {
		cost: {computer: 1, motor: 6, steel_beam: 6, tungsten_carbide: 4},
		mw: 15,
		note: 'On an ore field: mines the tiles under it and the ring round them into a 40-item buffer. Fields run dry.',
		ports: [0, 1, 0, 0],
		rate: 1,
		size: [2, 2],
		tier: 't8'
	},
	pump: {
		cost: {iron_plate: 8, steel_pipe: 4, wire: 10},
		mw: 5,
		note: 'Draws 12 u/s of water from a water, spring or lagoon tile. Every 32 tiles of pipe needs another pump in line.',
		ports: [0, 0, 0, 1],
		size: [1, 1],
		tier: 't3'
	},
	refinery: {
		cost: {circuit: 10, concrete: 30, motor: 4, steel_pipe: 12},
		mw: 30,
		note: 'Solids and one fluid in; a solid or a fluid out.',
		ports: [2, 1, 1, 1],
		size: [3, 4],
		tier: 't5'
	},
	smelter: {cost: {iron_rod: 5, wire: 8}, mw: 4, note: 'Ore to ingot.', ports: [1, 1, 0, 0], size: [2, 2], tier: 't1'},
	steam_generator: {
		cost: {concrete: 10, frame: 4, steel_pipe: 6, wire: 20},
		fuels: {coal: 300, fuel: 60, peat: 200},
		mw: -75,
		note: 'Supplies 75 MW from coal, peat or fuel with 0.75 u/s of water.',
		ports: [1, 0, 2, 0],
		size: [3, 3],
		tier: 't3',
		water: 0.75
	}
}

// Laid a tile or a piece at a time by a Builder, at `cost` each. A belt's `rate` is items a second, a pipe's u/s.
export const STRUCTURES: Record<StructureKind, {cost: Items; note: string; rate?: number; tier: GateId}> = {
	antenna: {
		cost: {iron_rod: 8, wire: 12},
		note: 'Radio repeater: links within 80 tiles of Core or another connected antenna, covers 40 tiles.',
		tier: 't1'
	},
	belt_mk1: {cost: {iron_plate: 1}, note: '1 item/s.', rate: 1, tier: 't2'},
	belt_mk2: {cost: {iron_plate: 1, steel_pipe: 1}, note: '2 items/s.', rate: 2, tier: 't4'},
	belt_mk3: {cost: {plastic: 1, steel_beam: 1}, note: '4.5 items/s.', rate: 4.5, tier: 't6'},
	bridge: {cost: {stone: 8}, note: 'A deck over liquid; belts and pipes may ride it.', tier: 't0'},
	junction: {cost: {iron_plate: 2, iron_rod: 2}, note: 'Two belts cross without mixing.', tier: 't2'},
	lift: {
		cost: {motor: 1, steel_beam: 1},
		note: 'Carries a belt up or down as far as 4 levels in one tile.',
		tier: 't4'
	},
	merger: {cost: {iron_plate: 4, iron_rod: 4}, note: 'Two belts in, one out, taking from each in turn.', tier: 't2'},
	pipe: {cost: {steel_pipe: 1}, note: '24 u/s; one fluid a network.', rate: 24, tier: 't3'},
	pole: {cost: {wire: 1, wood: 1}, note: 'Wires to poles within 6 tiles; powers machines within 2.', tier: 't1'},
	pylon: {
		cost: {concrete: 4, steel_beam: 2, wire: 10},
		note: 'Wires to pylons within 16 tiles; powers machines within 4.',
		tier: 't4'
	},
	ramp: {cost: {stone: 6}, note: 'Wheels climb one level.', tier: 't0'},
	road: {cost: {stone: 2}, note: 'Wheels cross a paved tile.', tier: 't0'},
	splitter: {cost: {iron_plate: 4, wire: 6}, note: 'One belt in, two out, in turn.', tier: 't2'}
}

// A furnace's fuel is an ingredient; Home's bench is slow and needs no power.
export type Recipe = {building: BuildingKind; inputs: Items; outputs: Items; seconds: number; tier: GateId}

export const RECIPES: Record<RecipeId, Recipe> = {
	asm_circuit: {building: 'assembler', inputs: {iron_plate: 1, wire: 3}, outputs: {circuit: 1}, seconds: 4, tier: 't4'},
	asm_frame: {
		building: 'assembler',
		inputs: {iron_plate: 4, iron_rod: 8},
		outputs: {frame: 1},
		seconds: 10,
		tier: 't2'
	},
	asm_motor: {building: 'assembler', inputs: {steel_pipe: 2, wire: 8}, outputs: {motor: 1}, seconds: 10, tier: 't4'},
	bench_iron_plate: {building: 'home', inputs: {iron_ingot: 3}, outputs: {iron_plate: 2}, seconds: 10, tier: 't0'},
	bench_iron_rod: {building: 'home', inputs: {iron_ingot: 1}, outputs: {iron_rod: 1}, seconds: 6, tier: 't0'},
	bench_wire: {building: 'home', inputs: {copper_ingot: 1}, outputs: {wire: 2}, seconds: 6, tier: 't1'},
	fab_aluminium_sheet: {
		building: 'fabricator',
		inputs: {aluminium_ingot: 3},
		outputs: {aluminium_sheet: 2},
		seconds: 4,
		tier: 't7'
	},
	fab_concrete: {building: 'fabricator', inputs: {stone: 3}, outputs: {concrete: 1}, seconds: 4, tier: 't2'},
	fab_iron_plate: {building: 'fabricator', inputs: {iron_ingot: 3}, outputs: {iron_plate: 2}, seconds: 6, tier: 't1'},
	fab_iron_rod: {building: 'fabricator', inputs: {iron_ingot: 1}, outputs: {iron_rod: 1}, seconds: 4, tier: 't1'},
	fab_lens: {building: 'fabricator', inputs: {crystal: 2}, outputs: {lens: 1}, seconds: 6, tier: 't8'},
	fab_steel_beam: {building: 'fabricator', inputs: {steel_ingot: 4}, outputs: {steel_beam: 1}, seconds: 4, tier: 't3'},
	fab_steel_pipe: {building: 'fabricator', inputs: {steel_ingot: 3}, outputs: {steel_pipe: 2}, seconds: 4, tier: 't3'},
	fab_wire: {building: 'fabricator', inputs: {copper_ingot: 1}, outputs: {wire: 2}, seconds: 4, tier: 't1'},
	foundry_aluminium: {
		building: 'foundry',
		inputs: {alumina: 2, coal: 1},
		outputs: {aluminium_ingot: 2},
		seconds: 6,
		tier: 't7'
	},
	foundry_carbide: {
		building: 'foundry',
		inputs: {coal: 1, tungsten: 2},
		outputs: {tungsten_carbide: 1},
		seconds: 8,
		tier: 't8'
	},
	foundry_silicon: {building: 'foundry', inputs: {coal: 1, quartz: 2}, outputs: {silicon: 1}, seconds: 6, tier: 't5'},
	foundry_steel: {
		building: 'foundry',
		inputs: {coal: 2, iron_ingot: 2},
		outputs: {steel_ingot: 2},
		seconds: 4,
		tier: 't3'
	},
	furnace_copper_coal: {
		building: 'furnace',
		inputs: {coal: 1, copper_ore: 2},
		outputs: {copper_ingot: 2},
		seconds: 6,
		tier: 't0'
	},
	furnace_copper_wood: {
		building: 'furnace',
		inputs: {copper_ore: 2, wood: 1},
		outputs: {copper_ingot: 2},
		seconds: 8,
		tier: 't0'
	},
	furnace_iron_coal: {
		building: 'furnace',
		inputs: {coal: 1, iron_ore: 2},
		outputs: {iron_ingot: 2},
		seconds: 6,
		tier: 't0'
	},
	furnace_iron_wood: {
		building: 'furnace',
		inputs: {iron_ore: 2, wood: 1},
		outputs: {iron_ingot: 2},
		seconds: 8,
		tier: 't0'
	},
	make_computer: {
		building: 'manufacturer',
		inputs: {circuit: 4, plastic: 4, silicon: 2},
		outputs: {computer: 1},
		seconds: 12,
		tier: 't6'
	},
	make_heavy_frame: {
		building: 'manufacturer',
		inputs: {concrete: 6, frame: 4, steel_beam: 4, tungsten_carbide: 2},
		outputs: {heavy_frame: 1},
		seconds: 20,
		tier: 't8'
	},
	make_lumen_cell: {
		building: 'manufacturer',
		inputs: {aluminium_sheet: 2, battery: 1, lumen: 6, silicon: 4},
		outputs: {lumen_cell: 1},
		seconds: 30,
		tier: 't9'
	},
	make_signal_core: {
		building: 'manufacturer',
		inputs: {battery: 1, computer: 2, lens: 2, lumen: 2},
		outputs: {signal_core: 1},
		seconds: 40,
		tier: 't9'
	},
	refine_acid: {building: 'refinery', inputs: {sulfur: 2, water: 10}, outputs: {acid: 10}, seconds: 4, tier: 't5'},
	refine_alumina: {building: 'refinery', inputs: {acid: 6, bauxite: 3}, outputs: {alumina: 2}, seconds: 6, tier: 't7'},
	refine_battery: {
		building: 'refinery',
		inputs: {acid: 6, aluminium_sheet: 2, cobalt: 2},
		outputs: {battery: 1},
		seconds: 10,
		tier: 't7'
	},
	refine_fuel: {building: 'refinery', inputs: {peat: 2, water: 6}, outputs: {fuel: 12}, seconds: 4, tier: 't5'},
	refine_plastic: {building: 'refinery', inputs: {peat: 3, water: 6}, outputs: {plastic: 2}, seconds: 6, tier: 't5'},
	smelt_copper: {building: 'smelter', inputs: {copper_ore: 1}, outputs: {copper_ingot: 1}, seconds: 2, tier: 't1'},
	smelt_iron: {building: 'smelter', inputs: {iron_ore: 1}, outputs: {iron_ingot: 1}, seconds: 2, tier: 't1'}
}

// A team starts with Home, empty, and one Builder. Everything else it gathers by hand, smelts and builds, as in Satisfactory.
export const START: {stock: Items; units: UnitClass[]} = {stock: {}, units: ['builder']}
