import {
	Array,
	Boolean,
	Effect,
	MutableHashMap,
	MutableHashSet,
	Match,
	MutableList,
	Number,
	Option,
	Order,
	Record,
	Schema,
	String,
	Struct,
	Tuple,
	pipe
} from 'effect'
import type {Types} from 'effect'

import {Machine} from '@typeonce/effect-machine'

import {daylightAt, makeLife} from '#services/game/lib/life.ts'
import type {Body} from '#services/game/lib/life.ts'
import {route} from '#services/game/lib/path.ts'
import {Creatures, START_STATES, Sites, Tasks} from '#services/game/lib/tasks.ts'
import type {Creature, Site, SiteEvent, Task, TaskEvent} from '#services/game/lib/tasks.ts'
import {
	BOULDERS,
	BUILDINGS,
	CREATURES,
	ENEMIES,
	FLUIDS,
	GATES,
	HOME_SIGHT,
	KINDS,
	ORE_ITEM,
	RECIPES,
	START,
	STRUCTURES,
	TEAMS,
	TICK,
	TICK_HZ,
	TIMBER,
	UNITS,
	WILDLIFE,
	capsuleOf,
	cycleCost,
	markOf,
	nearestOn,
	nearestPair,
	shapeOf,
	yieldOf
} from '#services/game/lib/utils.ts'
import type {Items} from '#services/game/lib/utils.ts'
import {BuildingKind, GameError, GateId, ItemId, StructureKind} from '#services/game/schema.ts'
import type {
	BuildingView,
	Command,
	Direction,
	EnemyKind,
	Journal,
	Explored,
	Fact,
	Frame,
	Job,
	LocalDecision,
	Mark,
	MobKind,
	Outcome,
	Point,
	RecipeId,
	Saved,
	SavedBuilding,
	SavedEnemy,
	SavedMob,
	SavedTeam,
	SavedUnit,
	Standing,
	TeamView,
	UnitClass,
	UnitView,
	Zone
} from '#services/game/schema.ts'
import {
	CHUNK,
	GENERATOR,
	GROUND,
	LIQUID,
	MOVERS,
	chunkOf,
	crossable,
	hash,
	lowest,
	makeWorld,
	standable,
	tileGround,
	tileKey,
	tileOf
} from '#services/world/lib/utils.ts'
import type {Chunk, Mover, Prop} from '#services/world/lib/utils.ts'
import {Material} from '#services/world/schema.ts'
import type {Edit, TileChange} from '#services/world/schema.ts'

// The most a body turns in one tick, in radians.
const TURN = 0.3
// Items a machine's output buffer holds.
const BUFFER = 40
// How far round a gather point a Builder looks for what it digs or clears.
const NEAR = 10
const CORNERS = [
	{x: 0, z: 0},
	{x: 1, z: 0},
	{x: 0, z: 1},
	{x: 1, z: 1}
]
const STEP: Record<Direction, Point> = {
	east: {x: 1, z: 0},
	north: {x: 0, z: -1},
	south: {x: 0, z: 1},
	west: {x: -1, z: 0}
}
const DIRECTIONS: Direction[] = ['north', 'east', 'south', 'west']
// Wildlife lives in 16-tile patches: a patch comes alive within WILD_NEAR tiles of a unit.
const PATCH = 16
const WILD_NEAR = 56
// The props bodies walk round rather than through, with how far round each they keep at full size. Shrubs, grass and pebbles stay passable.
const SOLID: Record.ReadonlyRecord<string, number> = {
	bamboo: 0.12,
	cactus: 0.18,
	coral: 0.22,
	crystal: 0.22,
	hoodoo: 0.3,
	maple: 0.2,
	pine: 0.18,
	ruin: 0.55,
	snag: 0.14,
	spire: 0.25,
	tree: 0.2
}
// Buildings whose stock any team unit may draw from.
const STORES: BuildingKind[] = ['home', 'crate_mk1', 'crate_mk2', 'crate_mk3']
// Buildings that run a recipe.
const MAKERS: BuildingKind[] = ['furnace', 'smelter', 'fabricator', 'assembler', 'foundry', 'refinery', 'manufacturer']
// Who pays a milestone, by where it is paid.
const PAYERS = {beacon: 'the Beacon', home: 'Home'}
const BELTS: StructureKind[] = ['belt_mk1', 'belt_mk2', 'belt_mk3', 'splitter', 'merger', 'junction', 'lift']
const POLES = {pole: {link: 6, reach: 2}, pylon: {link: 16, reach: 4}}
// Wet ground wheels crawl over.
const MUD = [GROUND.mud, GROUND.mud2, GROUND.marsh, GROUND.reeds, GROUND.paddymud]
// Water fish school in and pumps draw from.
const SWIMMABLE = [LIQUID.water, LIQUID.lagoon, LIQUID.spring]
// A chunk's explored tiles, a bit each.
const CHUNK_BYTES = (CHUNK * CHUNK) / 8
export const SIMULATION = 2

// A unit and a building as the world runs them: their step and construction as machine snapshots, encoded only in a save.
type Unit = Types.Mutable<Omit<SavedUnit, 'task'>> & {task: Task}
type Building = Types.Mutable<Omit<SavedBuilding, 'site'>> & {site: Site}
type Team = Types.Mutable<Omit<SavedTeam, 'explored' | 'contacts' | 'note'>>
type Enemy = Types.Mutable<Omit<SavedEnemy, 'task'>> & {task: Creature}
type Mob = Types.Mutable<Omit<SavedMob, 'task'>> & {task: Creature}
type Kind = BuildingKind | StructureKind
type Bits = {bits: Uint8Array; version: number}
type Plan = {job: Option.Option<Job>; reason: string}
// A body in the crowd grid: where it is, what it is, its place in the listing and whether it blocks now.
type CrowdBody = {
	at: {act: string; id: number; x: number; yaw: number; z: number}
	kind: string
	order: number
	solid: () => boolean
}

const byDistance = Order.mapInput(Order.Number, (entry: {distance: number}) => entry.distance)
const byId = Order.mapInput(Order.Number, (entry: {id: number}) => entry.id)

function distance(a: Point, b: Point) {
	return Math.hypot(a.x - b.x, a.z - b.z)
}

/* ───────── items ───────── */

function countOf(items: Items, item: ItemId) {
	return items[item] ?? 0
}

function itemsIn(items: Items) {
	return Array.filter(ItemId.literals, item => countOf(items, item) > 0)
}

function totalOf(items: Items) {
	return Array.reduce(itemsIn(items), 0, (sum, item) => sum + countOf(items, item))
}

function withItem(items: Items, item: ItemId, by: number) {
	return Record.fromEntries(
		Array.filter(
			Array.map(Array.dedupe([...itemsIn(items), item]), key => {
				if (key === item) return [key, countOf(items, key) + by] as const
				return [key, countOf(items, key)] as const
			}),
			entry => entry[1] > 0
		)
	)
}

function covers(have: Items, need: Items) {
	return Array.every(itemsIn(need), item => countOf(have, item) >= countOf(need, item))
}

// What a pipe network inherits from the networks before it: each old network's fluid shared out by how many of its pipes it keeps, so a split divides the fluid and a join adds it; the most-held fluid stays.
function inherited(previous: {fluid: Option.Option<ItemId>; pipes: number[]; stock: number}[], ids: number[]) {
	const shares = Array.getSomes(
		Array.map(previous, old =>
			Option.map(old.fluid, fluid => ({
				fluid,
				stock: (old.stock * Array.intersection(old.pipes, ids).length) / Number.max(1, old.pipes.length)
			}))
		)
	)
	return Option.match(Array.head(Array.sortWith(shares, share => -share.stock, Order.Number)), {
		onNone: () => ({fluid: Option.none<ItemId>(), stock: 0}),
		onSome: most => ({
			fluid: Option.some(most.fluid),
			stock: Number.sumAll(
				Array.map(
					Array.filter(shares, share => share.fluid === most.fluid),
					share => share.stock
				)
			)
		})
	})
}

function itemsText(items: Items) {
	return (
		Array.join(
			Array.map(itemsIn(items), item => `${Number.round(countOf(items, item), 1)} ${item}`),
			', '
		) || 'nothing'
	)
}

function sizeOf(kind: Kind) {
	if (Schema.is(BuildingKind)(kind)) return {d: BUILDINGS[kind].size[1], w: BUILDINGS[kind].size[0]}
	return {d: 1, w: 1}
}

function costOf(kind: Kind) {
	if (Schema.is(BuildingKind)(kind)) return BUILDINGS[kind].cost
	return STRUCTURES[kind].cost
}

function tierOf(kind: Kind) {
	if (Schema.is(BuildingKind)(kind)) return BUILDINGS[kind].tier
	return STRUCTURES[kind].tier
}

function centreOf(building: {kind: Kind; x: number; z: number}) {
	const size = sizeOf(building.kind)
	return {x: building.x + size.w / 2, z: building.z + size.d / 2}
}

// How far a point lies outside a building's footprint.
function gapTo(building: {kind: Kind; x: number; z: number}, at: Point) {
	const size = sizeOf(building.kind)
	return Math.hypot(
		Number.max(0, Number.max(building.x - at.x, at.x - (building.x + size.w))),
		Number.max(0, Number.max(building.z - at.z, at.z - (building.z + size.d)))
	)
}

// Seconds of a Builder's work a building takes once its items are there.
function buildSeconds(kind: Kind) {
	const size = sizeOf(kind)
	if (Schema.is(StructureKind)(kind)) return 1.5
	return 4 + size.w * size.d * 2
}

function directionOf(from: Point, to: Point) {
	if (Math.abs(to.x - from.x) >= Math.abs(to.z - from.z)) {
		if (to.x >= from.x) return 'east'
		return 'west'
	}
	if (to.z >= from.z) return 'south'
	return 'north'
}

function turned(dir: Direction, by: number) {
	return (
		DIRECTIONS[
			(Option.getOrElse(
				Array.findFirstIndex(DIRECTIONS, entry => entry === dir),
				() => 0
			) +
				by +
				4) %
				4
		] ?? dir
	)
}

// The tiles of a straight line along x or z from one tile, as far as another's row or column, along the longer axis and 60 tiles at most.
function lineTiles(from: Point, to: Point) {
	const dir: Direction = directionOf(from, to)
	return {
		dir,
		tiles: Array.map(
			Array.range(0, Number.min(59, Number.max(Math.abs(to.x - from.x), Math.abs(to.z - from.z)))),
			n => ({x: from.x + STEP[dir].x * n, z: from.z + STEP[dir].z * n})
		)
	}
}

function chunkKey(cx: number, cz: number) {
	return (cx + 4096) * 8192 + (cz + 4096)
}

function chunkFrom(key: number) {
	return {cx: Math.floor(key / 8192) - 4096, cz: (key % 8192) - 4096}
}

function patchCentre(key: number) {
	return {x: (Math.floor(key / 65_536) - 32_768 + 0.5) * PATCH, z: ((key % 65_536) - 32_768 + 0.5) * PATCH}
}

// The keys of the patches whose middle lies within WILD_NEAR tiles of a point, a patch's key packing its column and row.
function patchesNear(at: Point) {
	const span = Math.ceil(WILD_NEAR / PATCH)
	const px = Math.floor(at.x / PATCH)
	const pz = Math.floor(at.z / PATCH)
	return Array.filter(
		Array.flatMap(Array.range(-span, span), dz =>
			Array.map(Array.range(-span, span), dx => (px + dx + 32_768) * 65_536 + (pz + dz + 32_768))
		),
		key => distance(patchCentre(key), at) <= WILD_NEAR
	)
}

// How much a unit gives way when bodies overlap: idle units make way for moving ones, working ones hold their place.
function giveOf(act: string) {
	if (act === 'work') return 0.05
	if (act === 'move') return 0.3
	return 1
}

// The unit vector from one body to another; on top of each other, any way out.
function awayOf(from: Point, to: Point) {
	const gap = distance(from, to)
	if (gap < 1e-4) return {x: 1, z: 0}
	return {x: (to.x - from.x) / gap, z: (to.z - from.z) / gap}
}

// A body's heading turned toward a way at most TURN a tick, so it swings round rather than snapping.
function faced(yaw: number, way: Point) {
	const want = Math.atan2(way.x, way.z)
	const next =
		yaw + Number.clamp(Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw)), {maximum: TURN, minimum: -TURN})
	return Math.atan2(Math.sin(next), Math.cos(next))
}

function nearest<A extends Point>(from: Point, among: A[]) {
	return Array.head(
		Array.map(
			Array.sort(
				Array.map(among, entry => ({distance: distance(entry, from), entry})),
				byDistance
			),
			pair => pair.entry
		)
	)
}

// A body's footprint as a capsule along its heading.
function capsuleAt(body: {at: {x: number; yaw: number; z: number}; kind: string}) {
	return capsuleOf({kind: body.kind, x: body.at.x, yaw: body.at.yaw, z: body.at.z})
}

// How far a pole wires to the next and powers buildings round it.
function reachOf(pole: Building) {
	if (pole.kind === 'pylon') return POLES.pylon
	return POLES.pole
}

// Where a unit stands to work at a building: by its edge.
function beside(building: Option.Option<Point & {kind: Kind}>, from: Point) {
	return Option.flatMap(building, entry => {
		const size = sizeOf(entry.kind)
		const x = Number.clamp(from.x, {maximum: entry.x + size.w - 0.5, minimum: entry.x + 0.5})
		const z = Number.clamp(from.z, {maximum: entry.z + size.d - 0.5, minimum: entry.z + 0.5})
		return Option.map(
			nearest(from, [
				{x, z: entry.z - 0.5},
				{x, z: entry.z + size.d + 0.5},
				{x: entry.x - 0.5, z},
				{x: entry.x + size.w + 0.5, z}
			]),
			to => ({near: 0, to})
		)
	})
}

// How far up a ramp facing a direction a tile corner sits, 0 at its foot and 1 at its top.
function riseOf(dir: Direction, corner: Point) {
	if (dir === 'east') return corner.x
	if (dir === 'west') return 1 - corner.x
	if (dir === 'south') return corner.z
	return 1 - corner.z
}

// What a building draws in megawatts, or for a generator gives as a negative.
function mwOf(kind: Kind) {
	if (Schema.is(BuildingKind)(kind)) return BUILDINGS[kind].mw
	return 0
}

// Water a building burns a second.
function waterOf(kind: Kind) {
	if (Schema.is(BuildingKind)(kind)) return BUILDINGS[kind].water ?? 0
	return 0
}

// The items a generator burns, with the seconds each gives.
function fuelsOf(kind: Kind) {
	if (Schema.is(BuildingKind)(kind)) return BUILDINGS[kind].fuels ?? {}
	return {}
}

// Tiles a second a belt moves its item.
function rateOf(kind: Kind) {
	if (Schema.is(StructureKind)(kind)) return STRUCTURES[kind].rate ?? 1
	return 1
}

// How far along a building is: up to a half while its items arrive, the other half while it is built.
function builtOf(building: Building) {
	if (building.site.state.path === 'Complete') return 1
	if (building.site.state.path === 'Constructing') {
		return 0.5 + 0.5 * (1 - building.site.state.value.left / buildSeconds(building.kind))
	}
	return 0.5 * Number.min(1, totalOf(building.stock) / Number.max(1, totalOf(costOf(building.kind))))
}

function nextGate(team: Team) {
	return Array.findFirst(GateId.literals, id => !Array.contains(team.gates, id) && id !== 't0')
}

// The props a Builder clears for an item.
function clearedFor(item: ItemId) {
	if (item === 'wood') return TIMBER
	if (item === 'stone') return BOULDERS
	return []
}

// What clearing a prop leaves in the cargo.
function clearedItem(kind: string) {
	if (Array.contains(BOULDERS, kind)) return 'stone'
	return 'wood'
}

function job(value: Job) {
	return {job: Option.some(value), reason: ''} satisfies Plan
}

function wait(reason: string) {
	return {job: Option.none<Job>(), reason} satisfies Plan
}

function outcome(command: Command, ok: boolean, text: string) {
	return {command, ok, text} satisfies Outcome
}

function place2(at: Point) {
	return `(${Math.floor(at.x)}, ${Math.floor(at.z)})`
}

function orderText(order: Standing) {
	if (order._tag === 'Gather') return `Gather ${order.item} near (${order.x}, ${order.z})`
	if (order._tag === 'Haul') {
		return `Haul ${order.item ?? 'any'} #${order.from} → #${order.to}${Option.match(Option.fromUndefinedOr(order.count), {onNone: () => '', onSome: count => ` (${count} left)`})}`
	}
	if (order._tag === 'Go' || order._tag === 'Guard') return `${order._tag} (${order.x}, ${order.z})`
	return order._tag
}

function kindOf(unit: {class: UnitClass; mark: number}) {
	return KINDS[unit.class][unit.mark] ?? KINDS[unit.class][0]
}

function nameOf(team: number) {
	return TEAMS[team]?.name ?? `Team ${team}`
}

function newUnit(id: number, team: number, unitClass: UnitClass, mark: number, at: Point, task: Task) {
	return {
		act: 'idle',
		aim: 0,
		anchor: {x: at.x, z: at.z},
		anchored: 0,
		cargo: {},
		class: unitClass,
		doing: 'waiting by Home',
		health: UNITS[unitClass].marks[mark]?.health ?? 60,
		id,
		lost: false,
		mark,
		order: {_tag: 'Auto'},
		path: [],
		planned: -99,
		route: '',
		// Far off, so its first look counts as a move.
		sighted: {x: 1e9, z: 1e9},
		task,
		team,
		upgrade: false,
		x: at.x,
		yaw: 0,
		z: at.z
	} satisfies Unit
}

function newBuilding(id: number, team: number, kind: Kind, at: Point, dir: Direction, site: Site) {
	return {
		cursor: 0,
		dir,
		fuel: 0,
		id,
		kind,
		output: {},
		progress: -1,
		site,
		stock: {},
		team,
		x: at.x,
		z: at.z
	} satisfies Building
}

// The world: every team's units and buildings, the wildlife and hostiles round them, and the ground they changed; restored from a save, else fresh on the world `fresh` seeds.
export const makeSim = Effect.fnUntraced(
	function* (saved: Option.Option<Saved>, fresh: number) {
		const start = yield* START_STATES
		const seed = Option.match(saved, {onNone: () => fresh, onSome: previous => previous.seed})
		const world = makeWorld(seed)
		const life = makeLife(Option.getOrUndefined(saved)?.life, Option.getOrUndefined(saved)?.pendingExperiences)
		const spawns = world.spawns()
		const state = {draws: 0, nextId: 1, searches: 0, tick: 0, wildId: 1_000_000_000}
		const units = MutableHashMap.empty<number, Unit>()
		const buildings = MutableHashMap.empty<number, Building>()
		const teams = MutableList.make<Team>()
		const enemies = MutableHashMap.empty<number, Enemy>()
		const mobs = MutableHashMap.empty<number, Mob>()
		const dirtyWild = MutableHashSet.empty<number>()
		// Live wildlife patches, by patch key: whatever lives in each.
		const patches = MutableHashMap.empty<number, number[]>()
		// The way and side each body last swerved, which it keeps to round the same obstacle.
		const sides = MutableHashMap.empty<number, {side: number; way: Point}>()
		// Each creature's nearest approach to its goal so far, and when it got there.
		const stalls = MutableHashMap.empty<number, {best: number; since: number; to: Point}>()
		// Wooded tiles a unit got stuck in, by when routes stop going round them.
		const jams = MutableHashMap.empty<number, number>()
		const amounts = MutableHashMap.empty<number, number>()
		const edits = MutableHashMap.empty<number, Edit>()
		const cleared = MutableHashSet.empty<number>()
		// The tiles each team has seen, a bit each, per chunk; and every team's together, which clients draw.
		const explored = MutableHashMap.empty<number, MutableHashMap.MutableHashMap<number, Bits>>()
		const seen = MutableHashMap.empty<number, Bits>()
		// The chunks each team's units stood in, a bit per team.
		const visited = MutableHashMap.empty<number, number>()
		/* Caches, rebuilt from the state above. */
		const chunks = MutableHashMap.empty<number, Chunk>()
		const solids = MutableHashMap.empty<number, {id: number; radius: number; x: number; z: number}[]>()
		const woods = MutableHashMap.empty<number, boolean>()
		// The building on each tile.
		const footprint = MutableHashMap.empty<number, number>()
		// The prop each Builder set out to clear.
		const log = MutableList.make<{key: number; revision: number}>()
		const clearedLog = MutableList.make<{id: number; revision: number}>()
		const revision = {buildings: 0, explored: 0, props: 0, teams: 0, tiles: 0, zones: 0}
		// What each team's model is doing, which the game service sets.
		const status = MutableHashMap.empty<number, TeamView['status']>()
		const shots = MutableList.make<{from: number; to: number}>()
		// Power networks by building, worked out again when buildings change.
		const grid = {
			at: -1,
			nets: Array.empty<{consumers: number[]; generators: number[]; ratio: number}>(),
			of: MutableHashMap.empty<number, number>()
		}
		const pipes = {
			at: -1,
			nets: Array.empty<{
				fluid: Option.Option<ItemId>
				members: number[]
				pipes: number[]
				room: number
				stock: number
			}>(),
			of: MutableHashMap.empty<number, number[]>()
		}

		// The world's own dice, seeded by its world so the same ticks roll the same.
		function random() {
			state.draws += 1
			return hash(seed, state.draws, 7919)
		}

		function clock() {
			return state.tick * TICK
		}

		function nextId() {
			const id = state.nextId
			state.nextId += 1
			return id
		}

		/* ───────── the ground as bodies see it: generated chunks, edits, ore left and props cleared ───────── */

		function chunkAt(cx: number, cz: number) {
			const key = chunkKey(cx, cz)
			return Option.getOrElse(MutableHashMap.get(chunks, key), () => {
				if (MutableHashMap.size(chunks) > 900) {
					MutableHashMap.clear(chunks)
					MutableHashMap.clear(solids)
					MutableHashMap.clear(woods)
				}
				const chunk = world.chunk(cx, cz)
				MutableHashMap.set(chunks, key, chunk)
				return chunk
			})
		}

		// The props of the chunks within a reach of a point that are still standing.
		function propsNear(at: Point, reach: number) {
			const low = chunkOf(Math.floor(at.x - reach), Math.floor(at.z - reach))
			const high = chunkOf(Math.floor(at.x + reach), Math.floor(at.z + reach))
			return Array.filter(
				Array.flatMap(Array.range(low.cz, high.cz), cz =>
					Array.flatMap(Array.range(low.cx, high.cx), cx => chunkAt(cx, cz).props)
				),
				(prop: Prop) =>
					Math.abs(prop.x - at.x) <= reach && Math.abs(prop.z - at.z) <= reach && !MutableHashSet.has(cleared, prop.id)
			)
		}

		// The solid props within reach of a point: those of the chunks a tile and a half round it touches.
		function solidsNear(at: Point) {
			return Array.flatMap(
				Array.dedupeWith(
					Array.map(CORNERS, corner =>
						chunkOf(Math.floor(at.x + corner.x * 3 - 1.5), Math.floor(at.z + corner.z * 3 - 1.5))
					),
					(a: {cx: number; cz: number}, b: {cx: number; cz: number}) => a.cx === b.cx && a.cz === b.cz
				),
				(area: {cx: number; cz: number}) => {
					const key = chunkKey(area.cx, area.cz)
					return Array.filter(
						Option.getOrElse(MutableHashMap.get(solids, key), () => {
							const found = Array.flatMap(
								Array.filter(chunkAt(area.cx, area.cz).props, prop => !MutableHashSet.has(cleared, prop.id)),
								(prop: Prop) =>
									Option.toArray(
										Option.map(Record.get(SOLID, prop.kind), radius => ({
											id: prop.id,
											radius: radius * prop.s,
											x: prop.x,
											z: prop.z
										}))
									)
							)
							MutableHashMap.set(solids, key, found)
							return found
						}),
						solid => Math.abs(solid.x - at.x) < 1.5 && Math.abs(solid.z - at.z) < 1.5
					)
				}
			)
		}

		function ground(x: number, z: number) {
			const at = chunkOf(x, z)
			return tileGround(chunkAt(at.cx, at.cz), at.index, MutableHashMap.get(edits, tileKey(x, z)))
		}

		function oreAt(x: number, z: number) {
			const at = chunkOf(x, z)
			const generated = chunkAt(at.cx, at.cz).amount[at.index] ?? 0
			return Option.getOrElse(MutableHashMap.get(amounts, tileKey(x, z)), () => generated)
		}

		function materialAt(x: number, z: number) {
			const at = chunkOf(x, z)
			return Option.filter(
				Array.get(Material.literals, (chunkAt(at.cx, at.cz).ore[at.index] ?? 0) - 1),
				() => oreAt(x, z) > 0
			)
		}

		function changed(x: number, z: number) {
			revision.tiles += 1
			MutableList.append(log, {key: tileKey(x, z), revision: revision.tiles})
			// A client further behind than this many changes gets the whole overlay again.
			if (log.length > 6000) MutableList.take(log)
		}

		function setAmount(x: number, z: number, amount: number) {
			MutableHashMap.set(amounts, tileKey(x, z), amount)
			changed(x, z)
		}

		function setEdit(x: number, z: number, edit: Edit) {
			MutableHashMap.set(edits, tileKey(x, z), edit)
			changed(x, z)
		}

		// A prop is gone for good: out of the steering's way and every client's view.
		function clearProp(id: number, at: Point) {
			MutableHashSet.add(cleared, id)
			const area = chunkOf(Math.floor(at.x), Math.floor(at.z))
			MutableHashMap.remove(solids, chunkKey(area.cx, area.cz))
			MutableHashMap.remove(woods, tileKey(Math.floor(at.x), Math.floor(at.z)))
			revision.props += 1
			MutableList.append(clearedLog, {id, revision: revision.props})
			if (clearedLog.length > 6000) MutableList.take(clearedLog)
		}

		// Whether a finished building stands on a tile; belts, pipes, poles and roads do not stop anything.
		function blocked(x: number, z: number) {
			return Option.exists(
				Option.flatMap(MutableHashMap.get(footprint, tileKey(x, z)), id => MutableHashMap.get(buildings, id)),
				building => Schema.is(BuildingKind)(building.kind) && Sites.root.matches(building.site, 'Complete')
			)
		}

		function moverOf(unit: Unit) {
			return markOf(unit).mover
		}

		// Whether a trunk or rock stands on a tile, which routes go round where they can.
		function wooded(x: number, z: number) {
			const key = tileKey(x, z)
			return Option.getOrElse(MutableHashMap.get(woods, key), () => {
				const found = Array.some(
					solidsNear({x: x + 0.5, z: z + 0.5}),
					solid => Math.floor(solid.x) === x && Math.floor(solid.z) === z
				)
				MutableHashMap.set(woods, key, found)
				return found
			})
		}

		// What one straight step costs a unit: roads are quick, mud slows wheels, buildings and impassable ground stop it.
		function walker(unit: Unit) {
			const mover = MOVERS[moverOf(unit)]
			return (x: number, z: number, dx: number, dz: number) => {
				if (blocked(x + dx, z + dz)) return Infinity
				const to = ground(x + dx, z + dz)
				if (!crossable(mover, ground(x, z), to, dx, dz)) return Infinity
				if (to.road) return 0.6
				if (MutableHashMap.has(jams, tileKey(x + dx, z + dz))) return 12
				if (wooded(x + dx, z + dz)) return 3
				if (moverOf(unit) === 'wheels' && Array.contains(MUD, to.ground)) return 2.5
				return 1
			}
		}

		function speedOf(unit: Unit) {
			const tile = ground(Math.floor(unit.x), Math.floor(unit.z))
			const base = markOf(unit).speed
			if (moverOf(unit) === 'fly') return base
			if (tile.road) return base * 1.5
			if (moverOf(unit) === 'wheels' && Array.contains(MUD, tile.ground)) return base * 0.5
			return base
		}

		/* ───────── lookups ───────── */

		function unitOf(id: number) {
			return Option.getOrUndefined(MutableHashMap.get(units, id))
		}

		function buildingOf(id: number) {
			return Option.getOrUndefined(MutableHashMap.get(buildings, id))
		}

		const listings = {
			buildings: {list: Array.empty<Building>(), revision: -1, size: -1},
			enemies: {list: Array.empty<Enemy>(), size: -1},
			units: {list: Array.empty<Unit>(), size: -1}
		}
		function allUnits() {
			if (listings.units.size !== MutableHashMap.size(units)) {
				listings.units = {
					list: Array.sort(Array.fromIterable(MutableHashMap.values(units)), byId),
					size: MutableHashMap.size(units)
				}
			}
			return listings.units.list
		}

		function allBuildings() {
			if (
				listings.buildings.size !== MutableHashMap.size(buildings) ||
				listings.buildings.revision !== revision.buildings
			) {
				listings.buildings = {
					list: Array.sort(Array.fromIterable(MutableHashMap.values(buildings)), byId),
					revision: revision.buildings,
					size: MutableHashMap.size(buildings)
				}
			}
			return listings.buildings.list
		}

		function allEnemies() {
			if (listings.enemies.size !== MutableHashMap.size(enemies)) {
				listings.enemies = {
					list: Array.sort(Array.fromIterable(MutableHashMap.values(enemies)), byId),
					size: MutableHashMap.size(enemies)
				}
			}
			return listings.enemies.list
		}

		function allTeams() {
			return MutableList.toArray(teams)
		}

		function teamOf(id: number) {
			return Option.getOrUndefined(Array.findFirst(allTeams(), team => team.id === id))
		}

		function homeOf(team: number) {
			return Option.getOrUndefined(
				Option.flatMap(Option.fromUndefinedOr(teamOf(team)), entry => MutableHashMap.get(buildings, entry.home))
			)
		}

		function homeAt(team: number) {
			return Option.match(Option.fromUndefinedOr(homeOf(team)), {onNone: () => ({x: 0, z: 0}), onSome: centreOf})
		}

		function homes() {
			return Array.map(allTeams(), team => homeAt(team.id))
		}

		function living(unit: Unit) {
			return {
				act: unit.act,
				capacity: markOf(unit).cargo,
				cargo: totalOf(unit.cargo),
				class: unit.class,
				doing: unit.doing,
				health: unit.health / markOf(unit).health,
				id: unit.id,
				kind: kindOf(unit),
				objective: unit.order,
				team: unit.team,
				x: unit.x,
				yaw: unit.yaw,
				z: unit.z
			} satisfies Body
		}

		function entities() {
			return [
				...Array.map<Unit[], Body>(allUnits(), living),
				...Array.map<Enemy[], Body>(allEnemies(), enemy => ({
					act: enemy.act,
					doing: enemy.doing,
					health: enemy.health / 60,
					id: enemy.id,
					kind: enemy.kind,
					x: enemy.x,
					yaw: enemy.yaw,
					z: enemy.z
				})),
				...Array.map<Mob[], Body>(Array.fromIterable(MutableHashMap.values(mobs)), mob => ({
					act: mob.act,
					doing: mob.doing,
					health: life.person(mob.id, state.tick).health,
					id: mob.id,
					kind: mob.kind,
					x: mob.x,
					yaw: mob.yaw,
					z: mob.z
				}))
			]
		}

		function entity(id: number) {
			const unit = unitOf(id)
			if (unit !== undefined) return Option.some<Body>(living(unit))
			const enemy = Option.getOrUndefined(MutableHashMap.get(enemies, id))
			if (enemy !== undefined) return Option.some<Body>({...enemy, health: enemy.health / 60})
			return Option.map<Mob, Body>(MutableHashMap.get(mobs, id), mob => ({
				...mob,
				health: life.person(id, state.tick).health
			}))
		}

		const radio = {revision: -1, stations: Array.empty<{team: number; x: number; z: number}>()}
		function recordBirth(id: number) {
			Option.match(entity(id), {
				onNone: () => undefined,
				onSome: body => life.event(body, state.tick, 'born', `${body.kind} began here.`)
			})
		}
		function connected(unit: Unit) {
			if (radio.revision !== revision.buildings) {
				radio.revision = revision.buildings
				radio.stations = Array.map(allTeams(), team => ({team: team.id, ...homeAt(team.id)}))
				const antennas = Array.filter(
					allBuildings(),
					building => building.kind === 'antenna' && Sites.root.matches(building.site, 'Complete')
				)
				Array.forEach(antennas, () => {
					for (const antenna of antennas) {
						if (
							!Array.some(
								radio.stations,
								station => station.team === antenna.team && distance(station, antenna) < 0.1
							) &&
							Array.some(radio.stations, station => station.team === antenna.team && distance(station, antenna) <= 80)
						) {
							radio.stations = [...radio.stations, {team: antenna.team, x: antenna.x, z: antenna.z}]
						}
					}
				})
			}
			return Array.some(radio.stations, station => station.team === unit.team && distance(station, unit) <= 40)
		}

		function inspectStorage(body: Body, building: Building) {
			life.inspect(
				body,
				{
					form: building.kind,
					id: building.id,
					kind: 'storage',
					stage: building.site.state.path,
					...centreOf(building),
					items: Record.fromEntries(
						Array.map(Array.dedupe([...itemsIn(building.stock), ...itemsIn(building.output)]), item => [
							item,
							countOf(building.stock, item) + countOf(building.output, item)
						])
					),
					text: `#${building.id} ${building.kind} inspected: stock ${itemsText(building.stock)}; output ${itemsText(building.output)}.`
				},
				state.tick
			)
		}

		function resourcesAt(at: Point, radius: number, source: number) {
			const visible = Array.flatMap(Array.range(-Math.ceil(radius), Math.ceil(radius)), dz =>
				Array.flatMap(Array.range(-Math.ceil(radius), Math.ceil(radius)), dx => {
					if (dx * dx + dz * dz > radius * radius) return []
					const x = Math.floor(at.x) + dx
					const z = Math.floor(at.z) + dz
					return Option.toArray(Option.map(materialAt(x, z), material => ({material, x, z})))
				})
			)
			return Array.flatMap(Material.literals, material =>
				Option.toArray(
					Option.map(
						nearest(
							at,
							Array.filter(visible, tile => tile.material === material)
						),
						tile =>
							({
								id: -1 - tileKey(tile.x, tile.z),
								kind: 'resource',
								source,
								text: `${material} field at ${place2(tile)}: ${oreAt(tile.x, tile.z)} on this observed tile. Other tiles not surveyed.`,
								tick: state.tick,
								x: tile.x,
								z: tile.z
							}) satisfies Fact
					)
				)
			)
		}

		function perceive() {
			const all = entities()
			const cells = Array.groupBy(all, body => `${Math.floor(body.x / 16)},${Math.floor(body.z / 16)}`)
			Array.forEach(all, body => {
				if (body.health <= 0) return
				life.observe(
					body,
					Array.flatMap(Array.range(-1, 1), dz =>
						Array.flatMap(
							Array.range(-1, 1),
							dx => cells[`${Math.floor(body.x / 16) + dx},${Math.floor(body.z / 16) + dz}`] ?? []
						)
					),
					state.tick,
					12 * life.visibility(body, state.tick)
				)
				if (body.team !== undefined) {
					for (const fact of resourcesAt(body, 12 * life.visibility(body, state.tick), body.id)) {
						if (
							!Array.some(
								life.person(body.id, state.tick).facts,
								remembered => remembered.id === fact.id && remembered.text === fact.text
							)
						) {
							life.inspect(body, fact, state.tick)
						}
					}
				}
				for (const store of Array.filter(
					allBuildings(),
					candidate => gapTo(candidate, body) < 8 * life.visibility(body, state.tick)
				)) {
					if (!Array.some(life.person(body.id, state.tick).facts, fact => fact.id === store.id)) {
						life.inspect(
							body,
							{
								form: store.kind,
								id: store.id,
								kind: 'storage',
								stage: store.site.state.path,
								...centreOf(store),
								text: `An uninspected ${store.kind} #${store.id}. Contents unknown.`
							},
							state.tick
						)
					}
				}
			})
		}

		function unitsOf(team: number) {
			return Array.filter(allUnits(), unit => unit.team === team)
		}

		function buildingsOf(team: number) {
			return Array.filter(allBuildings(), building => building.team === team)
		}

		function unitName(unit: Unit) {
			return `#${unit.id} ${unit.class} mk${unit.mark + 1}`
		}

		function buildingName(building: Building) {
			return `#${building.id} ${building.kind}`
		}

		// What the timeline shows, since the service last took it.
		const marks = MutableList.make<Mark>()

		function mark(kind: Mark['kind'], team: number, other: Option.Option<number> = Option.none()) {
			MutableList.append(marks, {
				kind,
				team,
				tick: state.tick,
				...Option.match(other, {onNone: () => ({}), onSome: id => ({other: id})})
			})
		}

		// A notice the team's model reads at the start of its next round.
		function notify(team: number, text: string) {
			const entry = teamOf(team)
			if (entry !== undefined) entry.inbox = Array.takeRight([...entry.inbox, text], 40)
		}

		function unlocked(team: number, tier: GateId) {
			return (
				tier === 't0' || Option.exists(Option.fromUndefinedOr(teamOf(team)), entry => Array.contains(entry.gates, tier))
			)
		}

		function refitProblem(unit: Unit) {
			const spec = Option.getOrUndefined(Array.get(UNITS[unit.class].marks, unit.mark + 1))
			if (spec === undefined) return `${unitName(unit)} is already at the last mark`
			if (!unlocked(unit.team, spec.tier)) return `mark ${unit.mark + 2} unlocks with ${spec.tier}`
			return ''
		}

		/* ───────── movement ───────── */

		// Searches a route for a unit; false when this tick's searches are spent or no way exists.
		function replan(id: number, to: Point, near: number, key: string) {
			const unit = unitOf(id)
			// Eight searches a tick, of up to 6000 tiles each, keep a tick cheap.
			if (unit === undefined || state.searches >= 8) return false
			state.searches += 1
			unit.route = key
			unit.planned = clock()
			const found = route(walker(unit), {x: unit.x, z: unit.z}, to, {budget: 6000, near})
			unit.path = Option.getOrElse(found, () => [])
			unit.lost = Option.isNone(found)
			return Option.isSome(found)
		}

		// The bodies that can collide, in 4-tile cells, sorted once a tick; each is read live, so a body that moved or fell since still answers as it is now.
		const crowd: {cells: Record<string, CrowdBody[]>; tick: number} = {cells: {}, tick: -1}

		function bodyGrid() {
			if (crowd.tick === state.tick) return crowd.cells
			crowd.tick = state.tick
			crowd.cells = Array.groupBy(
				Array.map(
					[
						...Array.map(allUnits(), unit => ({
							at: unit,
							kind: kindOf(unit),
							solid: () => moverOf(unit) !== 'fly' && unit.health > 0
						})),
						...Array.map(allEnemies(), enemy => ({at: enemy, kind: enemy.kind, solid: () => enemy.health > 0})),
						...Array.map(
							Array.filter(
								Array.fromIterable(MutableHashMap.values(mobs)),
								mob => CREATURES[mob.kind].life === 'walker'
							),
							mob => ({at: mob, kind: mob.kind, solid: () => true})
						)
					],
					(body, order) => ({...body, order})
				),
				body => `${Math.floor(body.at.x / 4)},${Math.floor(body.at.z / 4)}`
			)
			return crowd.cells
		}

		// The bodies listed in the nine cells round a point, in the order they were listed.
		function crowdNear(at: Point) {
			const cells = bodyGrid()
			return Array.sort(
				Array.flatMap(Array.range(Math.floor(at.z / 4) - 1, Math.floor(at.z / 4) + 1), z =>
					Array.flatMap(Array.range(Math.floor(at.x / 4) - 1, Math.floor(at.x / 4) + 1), x => cells[`${x},${z}`] ?? [])
				),
				Order.mapInput(Order.Number, (body: {order: number}) => body.order)
			)
		}

		// The bodies on the ground near a point, but the one at it, each as round pieces along its length: units at rest are not obstacles, they make way, pushed aside; resting creatures are, and are walked round.
		function bodiesNear(self: {id: number; x: number; z: number}) {
			return Array.flatMap(
				Array.filter(
					crowdNear(self),
					body =>
						body.at.id !== self.id &&
						body.solid() &&
						!(body.at.act === 'idle' && MutableHashMap.has(units, body.at.id)) &&
						distance(body.at, self) < 2.6
				),
				(body: CrowdBody) => {
					const capsule = capsuleAt(body)
					return Array.map([capsule.back, nearestOn(capsule.back, capsule.front, body.at), capsule.front], at => ({
						radius: capsule.radius,
						x: at.x,
						z: at.z
					}))
				}
			)
		}

		// Which way a body heads to keep clear of the trunks and bodies just ahead, and how fast: straight on when clear; else the way it last swerved while that stays clear by a looser margin, so it never sways on the edge of a gap; else turned the least that clears, to the side it last swerved to first and back across only for a much smaller turn; slowed to a creep when nothing clears.
		function avoid(self: {id: number; kind: string; x: number; z: number}, heading: Point) {
			const shape = shapeOf(self.kind)
			const obstacles = [...solidsNear(self), ...bodiesNear(self)]
			function clear(way: Point, margin: number) {
				return Array.every(obstacles, obstacle => {
					const along = (obstacle.x - self.x) * way.x + (obstacle.z - self.z) * way.z
					if (along <= 0 || along > shape.ahead + shape.reach + shape.radius + obstacle.radius + 0.6) return true
					return (
						Math.abs((obstacle.x - self.x) * way.z - (obstacle.z - self.z) * way.x) >=
						shape.radius + obstacle.radius + margin
					)
				})
			}
			function rotated(turn: number) {
				return {
					x: heading.x * Math.cos(turn) - heading.z * Math.sin(turn),
					z: heading.x * Math.sin(turn) + heading.z * Math.cos(turn)
				}
			}
			function paced(way: Point) {
				return {
					pace:
						1 -
						Number.min(Math.acos(Number.clamp(way.x * heading.x + way.z * heading.z, {maximum: 1, minimum: -1})), 2) /
							3,
					way
				}
			}
			const last = Option.getOrUndefined(MutableHashMap.get(sides, self.id))
			if (clear(heading, Option.match(Option.fromUndefinedOr(last), {onNone: () => 0.04, onSome: () => 0.2}))) {
				MutableHashMap.remove(sides, self.id)
				return {pace: 1, way: heading}
			}
			if (last !== undefined && last.way.x * heading.x + last.way.z * heading.z > -0.9 && clear(last.way, -0.08)) {
				return paced(last.way)
			}
			const side = last?.side ?? 1
			return Option.getOrElse(
				Option.map(
					Array.findFirst(
						Array.sort(
							Array.flatMap([0.4, 0.8, 1.2, 1.6, 2.2, 2.8], turn => [turn * side, -turn * side]),
							Order.mapInput(
								Order.Number,
								(turn: number) => Math.abs(turn) + Number.max(0, -Math.sign(turn) * side) * 0.9
							)
						),
						turn => clear(rotated(turn), 0.04)
					),
					turn => {
						MutableHashMap.set(sides, self.id, {side: Math.sign(turn), way: rotated(turn)})
						return paced(rotated(turn))
					}
				),
				() => ({pace: 0.15, way: heading})
			)
		}

		// Where a body pushed by an offset ends up: nowhere it could not stand or step to.
		function nudged(at: Point, mover: Mover, by: Point) {
			const moved = {x: at.x + by.x, z: at.z + by.z}
			const from = {x: Math.floor(at.x), z: Math.floor(at.z)}
			const to = {x: Math.floor(moved.x), z: Math.floor(moved.z)}
			if (from.x === to.x && from.z === to.z) return moved
			function passes(a: Point, b: Point) {
				return (
					Math.abs(b.x - a.x) + Math.abs(b.z - a.z) === 1 &&
					!blocked(b.x, b.z) &&
					crossable(mover, ground(a.x, a.z), ground(b.x, b.z), b.x - a.x, b.z - a.z)
				)
			}
			// Over a tile's corner, by either side round it.
			const corner =
				Math.abs(to.x - from.x) === 1 &&
				Math.abs(to.z - from.z) === 1 &&
				((passes(from, {x: to.x, z: from.z}) && passes({x: to.x, z: from.z}, to)) ||
					(passes(from, {x: from.x, z: to.z}) && passes({x: from.x, z: to.z}, to)))
			if (passes(from, to) || corner) return moved
			return at
		}

		// One tick of motion toward a point, steering round what is just ahead; true when it gets there.
		function walk(id: number, to: Point) {
			const unit = unitOf(id)
			if (unit === undefined) return false
			const gap = distance(unit, to)
			const travel = speedOf(unit) * TICK
			// A unit that has not got half a tile further in two seconds plans its way again, round whatever holds it and round the tiles it was stuck on.
			if (distance(unit, unit.anchor) > 0.5) {
				unit.anchor = {x: unit.x, z: unit.z}
				unit.anchored = clock()
			}
			if (clock() - unit.anchored > 2) {
				unit.anchored = clock()
				for (const tile of Array.filter(
					[unit, {x: unit.x + ((to.x - unit.x) / gap) * 0.8, z: unit.z + ((to.z - unit.z) / gap) * 0.8}, to],
					at => wooded(Math.floor(at.x), Math.floor(at.z))
				)) {
					MutableHashMap.set(jams, tileKey(Math.floor(tile.x), Math.floor(tile.z)), clock() + 60)
				}
				unit.route = ''
				unit.planned = -99
			}
			unit.act = 'move'
			if (gap <= travel) {
				unit.x = to.x
				unit.z = to.z
				return true
			}
			const flies = moverOf(unit) === 'fly'
			// A waypoint on a trunk counts as reached once a unit on the ground is beside it; fliers pass over.
			if (
				gap < 1 &&
				!flies &&
				Array.some(solidsNear(to), solid => distance(solid, to) < solid.radius + shapeOf(kindOf(unit)).radius)
			) {
				return true
			}
			const heading = {x: (to.x - unit.x) / gap, z: (to.z - unit.z) / gap}
			const steered = Option.getOrElse(
				Option.map(
					Option.liftPredicate({id: unit.id, kind: kindOf(unit), x: unit.x, z: unit.z}, () => !flies),
					entry => avoid(entry, heading)
				),
				() => ({pace: 1, way: heading})
			)
			unit.yaw = faced(unit.yaw, steered.way)
			const swerve = {x: steered.way.x * travel * steered.pace, z: steered.way.z * travel * steered.pace}
			// A swerve onto ground the unit cannot take gives way to the planned line, which can.
			const moved = Option.getOrElse(
				Option.liftPredicate(nudged(unit, MOVERS[moverOf(unit)], swerve), at => at.x !== unit.x || at.z !== unit.z),
				() => ({x: unit.x + heading.x * travel * steered.pace, z: unit.z + heading.z * travel * steered.pace})
			)
			unit.x = moved.x
			unit.z = moved.z
			return false
		}

		function progressing(id: number, from: Point, to: Point) {
			const previous = Option.getOrUndefined(MutableHashMap.get(stalls, id))
			if (previous === undefined || distance(previous.to, to) > 0.5 || previous.best - distance(from, to) > 0.3) {
				MutableHashMap.set(stalls, id, {best: distance(from, to), since: clock(), to})
				return true
			}
			return clock() - previous.since <= 4
		}

		// Moves a unit toward a point by its own ground rules; true once it is within `near` tiles.
		function goTo(id: number, to: Point, near: number) {
			const unit = unitOf(id)
			if (unit === undefined) return false
			if (Math.abs(unit.x - to.x) <= near + 0.5 && Math.abs(unit.z - to.z) <= near + 0.5) {
				unit.path = []
				unit.anchored = clock()
				return true
			}
			if (moverOf(unit) === 'fly') {
				walk(id, to)
				return false
			}
			if (!progressing(id, unit, to)) {
				// Moving in a small circle is not progress toward the destination.
				for (const waypoint of Array.take(unit.path, 1)) {
					MutableHashMap.set(jams, tileKey(Math.floor(waypoint.x), Math.floor(waypoint.z)), clock() + 60)
				}
				MutableHashMap.remove(sides, id)
				MutableHashMap.remove(stalls, id)
				unit.path = []
				unit.route = ''
				unit.planned = -99
			}
			const key = `${Math.floor(to.x)},${Math.floor(to.z)},${near}`
			// A unit plans again when its goal moves, at most every second and a half, and retries a failed plan after three.
			const stale = unit.route !== key && (Array.isReadonlyArrayEmpty(unit.path) || clock() - unit.planned > 1.5)
			const retry = unit.route === key && Array.isReadonlyArrayEmpty(unit.path) && clock() - unit.planned > 3
			if ((stale || retry) && !replan(id, to, near, key)) return false
			const waypoint = Option.getOrUndefined(Array.head(unit.path))
			if (waypoint !== undefined && walk(id, waypoint)) unit.path = Array.drop(unit.path, 1)
			return false
		}

		// Hostiles give way by half, creatures by most.
		function giveOfWild(id: number) {
			if (MutableHashMap.has(enemies, id)) return 0.5
			return 0.8
		}

		// Bodies never overlap: each pair whose footprints meet is pushed apart, along the line between their nearest points, by how much each gives way.
		function separate() {
			const bodies = Array.map(
				Array.sort(
					Array.filter(Array.flatten(Record.values(bodyGrid())), body => body.solid()),
					Order.mapInput(Order.Number, (body: {order: number}) => body.order)
				),
				body => ({
					...body,
					...Option.getOrElse(
						Option.map(MutableHashMap.get(units, body.at.id), unit => ({
							give: giveOf(unit.act),
							mover: MOVERS[moverOf(unit)]
						})),
						() => ({give: giveOfWild(body.at.id), mover: MOVERS.legs})
					)
				})
			)
			const byOrder = MutableHashMap.fromIterable(Array.map(bodies, body => Tuple.make(body.order, body)))
			// Each pair once, nearest cells only, in the order the bodies were listed.
			const pairs = Array.flatMap(bodies, first =>
				Array.map(
					Array.filter(
						Array.getSomes(
							Array.map(
								Array.filter(crowdNear(first.at), second => second.order > first.order),
								second => MutableHashMap.get(byOrder, second.order)
							)
						),
						second => distance(first.at, second.at) < 3.2
					),
					second => ({first, second})
				)
			)
			for (const pair of pairs) {
				const one = capsuleAt(pair.first)
				const other = capsuleAt(pair.second)
				const closest = nearestPair(one, other)
				const overlap = one.radius + other.radius - distance(closest.from, closest.to)
				if (overlap > 0) {
					const away = awayOf(closest.from, closest.to)
					const share = pair.first.give / (pair.first.give + pair.second.give)
					const first = nudged(pair.first.at, pair.first.mover, {
						x: -away.x * overlap * share,
						z: -away.z * overlap * share
					})
					// What the first could not give, held by the ground behind it, the second gives, and the other way round.
					const owed = overlap - distance(first, pair.first.at)
					const second = nudged(pair.second.at, pair.second.mover, {x: away.x * owed, z: away.z * owed})
					const left = owed - distance(second, pair.second.at)
					const back = nudged(first, pair.first.mover, {x: -away.x * left, z: -away.z * left})
					pair.first.at.x = back.x
					pair.first.at.z = back.z
					pair.second.at.x = second.x
					pair.second.at.z = second.z
				}
			}
			// Then every body steps out of the trunks, rocks and walls it walked into, sliding round them.
			for (const body of bodies) {
				for (const solid of solidsNear(body.at)) {
					const capsule = capsuleAt(body)
					const near = nearestOn(capsule.back, capsule.front, solid)
					const overlap = capsule.radius + solid.radius - distance(near, solid)
					if (overlap > 0) {
						const away = awayOf(solid, near)
						const out = nudged(body.at, body.mover, {x: away.x * overlap, z: away.z * overlap})
						body.at.x = out.x
						body.at.z = out.z
					}
				}
			}
		}

		// One straight step on legs: onto ground they stand on, over an edge they climb, never into a building.
		function legStep(x: number, z: number, dx: number, dz: number) {
			return (
				!blocked(x + dx, z + dz) &&
				standable(MOVERS.legs, ground(x + dx, z + dz)) &&
				crossable(MOVERS.legs, ground(x, z), ground(x + dx, z + dz), dx, dz)
			)
		}

		// Whether legs get from a tile to its neighbour; a diagonal needs one of the two straight ways round it open.
		function legsCross(from: Point, to: Point) {
			const dx = to.x - from.x
			const dz = to.z - from.z
			if (dx === 0 && dz === 0) return true
			if (dx === 0 || dz === 0) return legStep(from.x, from.z, dx, dz)
			return (
				(legStep(from.x, from.z, dx, 0) && legStep(from.x + dx, from.z, 0, dz)) ||
				(legStep(from.x, from.z, 0, dz) && legStep(from.x, from.z + dz, dx, 0))
			)
		}

		// One tick of a hostile or creature on legs toward a point at a speed, never over ground legs cannot take; false when it is blocked or there.
		function stride(id: number, to: Point, speed: number) {
			const body =
				Option.getOrUndefined(MutableHashMap.get(enemies, id)) ?? Option.getOrUndefined(MutableHashMap.get(mobs, id))
			if (body === undefined) return false
			const gap = distance(body, to)
			body.act = 'move'
			if (gap < 0.05) return false
			// A goal it has got no nearer to in four seconds is out of its reach until the goal moves.
			if (!progressing(id, body, to)) {
				body.act = 'idle'
				return false
			}
			const steered = avoid(body, {x: (to.x - body.x) / gap, z: (to.z - body.z) / gap})
			// A goal within a tile on a trunk or behind a crowd, with no straight way to it, is as near as it gets; so is one it would have to turn half round to go on to, in a herd or among trees: it stops there rather than wheel on the spot.
			if ((steered.pace < 1 && gap < 1) || steered.pace < 0.5) {
				body.act = 'idle'
				return false
			}
			body.yaw = faced(body.yaw, steered.way)
			const onto = {
				x: body.x + steered.way.x * Number.min(gap, speed * TICK) * steered.pace,
				z: body.z + steered.way.z * Number.min(gap, speed * TICK) * steered.pace
			}
			if (!legsCross({x: Math.floor(body.x), z: Math.floor(body.z)}, {x: Math.floor(onto.x), z: Math.floor(onto.z)})) {
				return false
			}
			body.x = onto.x
			body.z = onto.z
			return true
		}

		/* ───────── mechanical wildlife and physical visibility ───────── */

		function biomeAt(at: Point) {
			const tile = chunkOf(Math.floor(at.x), Math.floor(at.z))
			return chunkAt(tile.cx, tile.cz).biome[tile.index] ?? 0
		}

		function spawnEnemy(kind: EnemyKind, at: Point) {
			const id = nextId()
			MutableHashMap.set(enemies, id, {
				act: 'idle',
				doing: 'observing',
				health: 60,
				id,
				kind,
				task: start.creature,
				x: at.x,
				yaw: random() * Math.PI * 2,
				z: at.z
			})
			recordBirth(id)
			return id
		}

		// Whether a shot from a body to a target passes clear of every other body and trunk on the way.
		function clearShot(from: {id: number; x: number; z: number}, to: {id: number; x: number; z: number}) {
			const gap = distance(from, to)
			const way = {x: (to.x - from.x) / Number.max(gap, 1e-6), z: (to.z - from.z) / Number.max(gap, 1e-6)}
			return Array.every(
				Array.flatMap(
					Array.map(Array.range(0, Math.ceil(gap / 1.5)), index => ({
						id: from.id,
						x: from.x + way.x * Number.min(gap, index * 1.5),
						z: from.z + way.z * Number.min(gap, index * 1.5)
					})),
					(point: {id: number; x: number; z: number}) => [...solidsNear(point), ...bodiesNear(point)]
				),
				obstacle => {
					const along = (obstacle.x - from.x) * way.x + (obstacle.z - from.z) * way.z
					if (along <= 0.3 || along >= gap - 0.3) return true
					return Math.abs((obstacle.x - from.x) * way.z - (obstacle.z - from.z) * way.x) >= obstacle.radius + 0.08
				}
			)
		}

		/* ───────── persistent wildlife, generated as new ground is reached ───────── */

		// Ground a creature can stand on: dry and open on legs, or for fish water deep enough to school in; none by any Home.
		function habitable(kind: MobKind, x: number, z: number) {
			const tile = ground(x, z)
			if (blocked(x, z) || Array.some(homes(), home => distance({x, z}, home) < 8)) return false
			if (CREATURES[kind].life === 'fish') {
				return Array.contains(SWIMMABLE, tile.liquid) && tile.surface - lowest(tile.corners) >= 0.3
			}
			return tile.liquid === LIQUID.none && standable(MOVERS.legs, tile)
		}

		// A patch's own spot for a group, found the same way every time it comes alive.
		function spotIn(key: number, row: number, kind: MobKind) {
			const centre = patchCentre(key)
			return Option.map(
				Array.findFirst(
					Array.map(Array.range(0, 9), n => ({
						x: Math.floor(centre.x + (hash(seed + row * 31 + n, key, 3) - 0.5) * PATCH),
						z: Math.floor(centre.z + (hash(seed + row * 37 + n, key, 5) - 0.5) * PATCH)
					})),
					at => habitable(kind, at.x, at.z)
				),
				at => ({x: at.x + 0.5, z: at.z + 0.5})
			)
		}

		function spawnMob(kind: MobKind, at: Point) {
			state.wildId += 1
			MutableHashMap.set(mobs, state.wildId, {
				act: 'idle',
				doing: CREATURES[kind].rest,
				id: state.wildId,
				kind,
				task: start.creature,
				x: at.x,
				// A group stands side by side, facing much the same way.
				yaw: (random() - 0.5) * 0.6,
				z: at.z
			})
			recordBirth(state.wildId)
			return state.wildId
		}

		// A biome's population is generated once; individuals then choose their own behaviour.
		function populate(key: number) {
			const centre = patchCentre(key)
			const biome = biomeAt(centre)
			const px = Math.floor(key / 65_536)
			const pz = key % 65_536
			// A patch is 2.4 times likelier than its biome's table to hold each group, and may hold two more of it.
			const groups = Array.flatMap(WILDLIFE[biome] ?? [], (row, n) => {
				if (hash(seed + 101 + n, px, pz) >= row.chance * 2.4) return []
				return Option.match(spotIn(key, n, row.kind), {
					onNone: () => [],
					onSome: at =>
						Array.map(Array.range(1, 1 + Math.floor(hash(seed + 151 + n, px, pz) * (row.most + 2))), q =>
							spawnMob(row.kind, {x: at.x + (q - 1) * 0.9, z: at.z + ((q * 7) % 3) * 0.2})
						)
				})
			})
			// Larger mechanical bodies begin away from the starting Core.
			const roamers = Option.match(
				Option.filter(
					spotIn(key, 9, 'grazer'),
					() => Array.every(homes(), home => distance(centre, home) > 28) && hash(seed + 199, px, pz) < 0.12
				),
				{
					onNone: () => [],
					onSome: at =>
						Array.map(Array.range(1, 1 + Math.floor(hash(seed + 211, px, pz) * 2)), q =>
							spawnEnemy(ENEMIES[biome] ?? 'glitch', {x: at.x + q * 0.8, z: at.z})
						)
				}
			)
			MutableHashMap.set(patches, key, [...groups, ...roamers])
		}

		// Whether no body has an id any more.
		function gone(id: number) {
			return !MutableHashMap.has(units, id) && !MutableHashMap.has(enemies, id) && !MutableHashMap.has(mobs, id)
		}

		// Discover new populations without despawning individuals when the spectator or units leave.
		function wildlife() {
			for (const key of Array.dedupe(
				Array.flatMap(
					Array.filter(allUnits(), unit => unit.health > 0),
					patchesNear
				)
			)) {
				if (!MutableHashMap.has(patches, key)) populate(key)
			}
			for (const id of Array.filter(Array.fromIterable(MutableHashMap.keys(sides)), gone)) {
				MutableHashMap.remove(sides, id)
			}
			for (const id of Array.filter(Array.fromIterable(MutableHashMap.keys(stalls)), gone)) {
				MutableHashMap.remove(stalls, id)
			}
			for (const entry of Array.filter(Array.fromIterable(jams), jam => jam[1] < clock())) {
				MutableHashMap.remove(jams, entry[0])
			}
		}

		function mobOf(id: number) {
			return Option.getOrUndefined(MutableHashMap.get(mobs, id))
		}

		// A flier crosses anything: straight at its speed, true once there.
		function glide(id: number, to: Point, speed: number) {
			const mob = mobOf(id)
			if (mob === undefined) return false
			const gap = distance(mob, to)
			mob.act = 'move'
			if (gap <= speed * TICK) {
				mob.x = to.x
				mob.z = to.z
				return true
			}
			mob.yaw = Math.atan2(to.x - mob.x, to.z - mob.z)
			mob.x += ((to.x - mob.x) / gap) * speed * TICK
			mob.z += ((to.z - mob.z) / gap) * speed * TICK
			return false
		}

		function damage(from: Body, id: number, by: number) {
			const target = Option.getOrUndefined(entity(id))
			if (target === undefined || target.health <= 0) return
			const unit = unitOf(id)
			const enemy = Option.getOrUndefined(MutableHashMap.get(enemies, id))
			const own = life.person(id, state.tick)
			if (unit !== undefined) {
				unit.health = Number.max(0, unit.health - by)
			} else if (enemy === undefined) {
				own.health = Number.max(0, own.health - by / 40)
			} else {
				enemy.health = Number.max(0, enemy.health - by)
			}
			if (unit === undefined) MutableHashSet.add(dirtyWild, id)
			const identified = distance(target, from) <= 12 * daylightAt(state.tick) && clearShot(target, from)
			life.event(
				target,
				state.tick,
				'damage',
				Boolean.match(identified, {onFalse: () => 'Hit; source not identified.', onTrue: () => `Hit by #${from.id}.`}),
				Option.getOrUndefined(Option.filter(Option.some(from.id), () => identified))
			)
			own.next = state.tick
			if ((unit?.health ?? enemy?.health ?? own.health) <= 0) {
				life.event(target, state.tick, 'down', 'Fell here; nobody else is automatically informed.')
			}
		}

		function moveCreature(id: number, to: Point, speed: number) {
			const mob = mobOf(id)
			if (mob !== undefined && CREATURES[mob.kind].life !== 'walker') {
				if (!habitable(mob.kind, Math.floor(to.x), Math.floor(to.z))) return false
				return !glide(id, to, speed)
			}
			return stride(id, to, speed)
		}
		function attack(body: Body, target: number, strength: number) {
			const to = Option.getOrUndefined(entity(target))
			if (to === undefined || to.health <= 0 || distance(body, to) > 12 * life.visibility(body, state.tick)) {
				return false
			}
			const attacker = unitOf(body.id)
			if (attacker !== undefined) {
				attacker.aim = Math.atan2(to.x - body.x, to.z - body.z)
				attacker.act = 'attack'
				attacker.doing = `confronting #${target}`
			}
			if (distance(body, to) > 2.5) {
				if (unitOf(body.id) === undefined) {
					moveCreature(body.id, to, 0.9)
				} else {
					goTo(body.id, to, 1)
				}
				return true
			}
			if (state.tick % 20 === 0 && clearShot(body, to)) {
				damage(body, target, strength)
				MutableList.append(shots, {from: body.id, to: target})
				life.event(body, state.tick, 'action', `Attacked #${target}.`, target)
			}
			return true
		}

		const transitionWild = Effect.fnUntraced(function* (id: number) {
			const body = Option.getOrUndefined(MutableHashMap.get(enemies, id)) ?? mobOf(id)
			if (body === undefined) return
			const own = life.person(id, state.tick)
			if (Option.exists(entity(id), found => found.health <= 0)) {
				if (body.task.state.path !== 'Down') {
					body.task = (yield* Machine.plan(Creatures, body.task, {_tag: 'Down'})).next
				}
				body.act = 'die'
				body.doing = 'a body lies here'
				return
			}
			if (own.intent === 'attack' && own.foe !== undefined) {
				if (body.task.state.path !== 'Attacking' || body.task.state.value.target !== own.foe) {
					body.task = (yield* Machine.plan(Creatures, body.task, {_tag: 'Attack', target: own.foe})).next
				}
				return
			}
			if (own.target !== undefined && own.intent === 'explore') {
				body.task = (yield* Machine.plan(Creatures, body.task, {_tag: 'Move', to: own.target})).next
				return
			}
			if (body.task.state.path !== 'Resting') {
				body.task = (yield* Machine.plan(Creatures, body.task, {_tag: 'Rest'})).next
			}
		})
		function wildStep(id: number) {
			const body = Option.getOrUndefined(MutableHashMap.get(enemies, id)) ?? mobOf(id)
			const view = Option.getOrUndefined(entity(id))
			if (body === undefined || view === undefined) return
			const own = life.person(id, state.tick)

			if (view.health <= 0) {
				body.act = 'die'
				body.doing = 'a body lies here'
				return
			}

			body.act = 'idle'
			if (body.task.state.path === 'Attacking') {
				body.doing = `confronting #${body.task.state.value.target}`
				body.act = 'attack'
				if (!attack(view, body.task.state.value.target, 4)) {
					own.intent = 'rest'
					own.next = state.tick
					life.event(view, state.tick, 'action', 'Stopped the pursuit; no active target is visible.')
					MutableHashSet.add(dirtyWild, id)
				}
			} else if (body.task.state.path === 'Moving') {
				const to = body.task.state.value.to
				body.doing = 'investigating the surroundings'

				if (!moveCreature(id, to, 0.8) || distance(body, to) < 0.5) {
					life.event(
						{...view, x: body.x, z: body.z},
						state.tick,
						'action',
						Boolean.match(distance(body, to) < 0.5, {
							onFalse: () => `Movement toward ${place2(to)} was blocked here.`,
							onTrue: () => `Reached ${place2(to)}.`
						})
					)
					own.target = undefined
					own.next = state.tick
					MutableHashSet.add(dirtyWild, id)
				}
			} else {
				body.doing = 'resting and observing'
			}
			if (state.tick % 10 === 0 && distance(view, body) > 0.001) {
				life.stamp({...view, x: body.x, yaw: body.yaw, z: body.z}, state.tick)
			}
		}

		/* ───────── sight: what each team has seen, where it went and whom it met ───────── */

		function bitsOf(map: MutableHashMap.MutableHashMap<number, Bits>, key: number) {
			return Option.getOrElse(MutableHashMap.get(map, key), () => {
				const created = {bits: new Uint8Array(CHUNK_BYTES), version: 0}
				MutableHashMap.set(map, key, created)
				return created
			})
		}

		function exploredOf(team: number) {
			return Option.getOrElse(MutableHashMap.get(explored, team), () => {
				const created = MutableHashMap.empty<number, Bits>()
				MutableHashMap.set(explored, team, created)
				return created
			})
		}

		function see(team: number, x: number, z: number) {
			const at = chunkOf(x, z)
			const key = chunkKey(at.cx, at.cz)
			const byte = at.index >> 3
			const bit = 1 << (at.index & 7)
			const own = bitsOf(exploredOf(team), key)
			if (((own.bits[byte] ?? 0) & bit) !== 0) return
			own.bits[byte] = (own.bits[byte] ?? 0) | bit
			own.version = revision.explored
			const all = bitsOf(seen, key)
			if (((all.bits[byte] ?? 0) & bit) !== 0) return
			all.bits[byte] = (all.bits[byte] ?? 0) | bit
			all.version = revision.explored
		}

		function lookRound(team: number, at: Point, radius: number) {
			const span = Math.ceil(radius)
			for (const dz of Array.range(-span, span)) {
				for (const dx of Array.range(-span, span)) {
					if (dx * dx + dz * dz <= radius * radius) see(team, Math.floor(at.x) + dx, Math.floor(at.z) + dz)
				}
			}
		}

		// Whether a team has explored the tile under a point.
		function known(team: number, at: Point) {
			const tile = chunkOf(Math.floor(at.x), Math.floor(at.z))
			return Option.exists(
				MutableHashMap.get(exploredOf(team), chunkKey(tile.cx, tile.cz)),
				entry => ((entry.bits[tile.index >> 3] ?? 0) & (1 << (tile.index & 7))) !== 0
			)
		}

		// Twice a second every unit that moved half a tile looks round it as far as it sees, and marks the chunk it is in.
		function explore() {
			revision.explored += 1
			for (const unit of Array.filter(allUnits(), entry => entry.health > 0 && distance(entry, entry.sighted) >= 0.5)) {
				unit.sighted = {x: unit.x, z: unit.z}
				lookRound(-unit.id, unit, markOf(unit).sight * daylightAt(state.tick))
				life.stamp(living(unit), state.tick)
				const at = chunkOf(Math.floor(unit.x), Math.floor(unit.z))
				const key = chunkKey(at.cx, at.cz)
				const before = Option.getOrElse(MutableHashMap.get(visited, key), () => 0)
				if ((before & (1 << unit.team)) === 0) {
					MutableHashMap.set(visited, key, before | (1 << unit.team))
					revision.zones += 1
				}
			}
		}

		/* ───────── storage: what a building takes, holds and gives ───────── */

		function complete(building: Building) {
			return Sites.root.matches(building.site, 'Complete')
		}

		function recipeOf(building: Building) {
			return Option.map(Option.fromUndefinedOr(building.recipe), recipe => RECIPES[recipe])
		}

		// How many of an item a building takes now.
		function roomFor(building: Building, item: ItemId) {
			if (!complete(building)) {
				return Number.max(0, countOf(costOf(building.kind), item) - countOf(building.stock, item))
			}
			if (building.kind === 'home' || building.kind === 'beacon') return Infinity
			if (Array.contains(FLUIDS, item)) return 0
			if (building.kind === 'crate_mk1' || building.kind === 'crate_mk2' || building.kind === 'crate_mk3') {
				return Number.max(0, (BUILDINGS[building.kind].capacity ?? 0) - totalOf(building.stock))
			}
			if (Schema.is(BuildingKind)(building.kind) && BUILDINGS[building.kind].fuels !== undefined) {
				return Number.max(0, Number.min(countOf(fuelsOf(building.kind), item), 1) * 20 - countOf(building.stock, item))
			}
			return Option.match(recipeOf(building), {
				onNone: () => 0,
				onSome: recipe => {
					const need = countOf(recipe.inputs, item)
					if (need === 0) return 0
					// A machine takes up to 20 of an input ahead, or two batches' worth.
					return Number.max(0, Number.max(20, need * 2) - countOf(building.stock, item))
				}
			})
		}

		// Moves a count of an item in or out of one of a building's tallies.
		function adjust(id: number, tally: 'output' | 'stock', item: ItemId, by: number) {
			const building = buildingOf(id)
			if (building !== undefined) building[tally] = withItem(building[tally], item, by)
		}

		// Puts items in; how many it took.
		function put(id: number, item: ItemId, count: number) {
			const building = buildingOf(id)
			if (building === undefined) return 0
			const taken = Number.min(count, roomFor(building, item))
			if (taken <= 0) return 0
			adjust(id, 'stock', item, taken)
			return taken
		}

		// Takes items out; how many came.
		function take(id: number, item: ItemId, count: number) {
			const building = buildingOf(id)
			if (building === undefined) return 0
			const fromOutput = Number.min(count, countOf(building.output, item))
			const fromStock = Number.min(count - fromOutput, countOf(building.stock, item))
			adjust(id, 'output', item, -fromOutput)
			adjust(id, 'stock', item, -fromStock)
			return fromOutput + fromStock
		}

		/* ───────── units: standing orders, the steps they take and what each step does ───────── */

		function cargoOf(unit: Unit) {
			return totalOf(unit.cargo)
		}

		function spaceOf(unit: Unit) {
			return Number.max(0, markOf(unit).cargo - cargoOf(unit))
		}

		// Lets go of what a unit counted on: the site's items on their way and the store's items set aside.
		function release(id: number) {
			const unit = unitOf(id)
			if (unit === undefined) return
			unit.claim = undefined
		}

		function localDecision(id: number, choice: string, request?: LocalDecision) {
			const body = Option.getOrUndefined(entity(id))
			if (body === undefined || body.health <= 0) return
			const unit = unitOf(id)
			const offered = request ?? life.local(body, state.tick, unit !== undefined && connected(unit))
			if (!Record.has(offered.choices, choice)) return
			const own = life.person(id, state.tick)
			const remembered = Option.getOrElse(
				Option.map(Array.last(offered.experience ?? []), entry => entry.id),
				() => 0
			)
			if (request !== undefined) {
				own.unrecorded = Array.filter(own.unrecorded ?? [], entry => entry.id > remembered)
			}
			if (unit === undefined) MutableHashSet.add(dirtyWild, id)
			own.next =
				state.tick +
				TICK_HZ * Boolean.match(choice === 'rest' || choice === 'continue', {onFalse: () => 20, onTrue: () => 120})
			life.event(body, state.tick, 'decision', `Chose ${choice}: ${offered.choices[choice] ?? ''}`)
			const action = String.split(':')(choice)[0] ?? ''
			const target = Array.findFirst(own.facts, fact => choice === `${action}:${fact.id}`)
			return pipe(
				Match.value(action),
				Match.when('survey', () => {
					if (unit === undefined || !connected(unit)) return
					life.report(
						body,
						state.tick,
						'Shared remembered resource observations and claims, preserving their provenance and age.',
						Array.filter(own.facts, fact => fact.kind === 'resource')
					)
					notify(unit.team, `Resource survey received from #${id}; its observations may be stale.`)
				}),
				Match.whenOr('report', 'addresses', mode => {
					if (unit === undefined || !connected(unit)) return
					const facts = Option.toArray(Option.filter(target, () => mode === 'report'))
					const ids = Array.filter(own.contacts, () => mode === 'addresses' || choice === 'report')
					const summary = Array.join(
						[
							...Array.map(facts, fact => `Observed at tick ${fact.tick}: ${fact.text} at ${place2(fact)}.`),
							...Array.map(
								ids,
								address => `Communication address ${address} learned through encounter or received claim.`
							),
							...Array.filter(
								Array.map(Array.takeRight(own.recent, 8), entry => `${entry.tick}: ${entry.text}`),
								() => choice === 'report'
							)
						],
						'\n'
					)
					life.report(body, state.tick, summary, facts, ids)
					notify(unit.team, `Report from #${id} at ${place2(body)}: ${summary}`)
				}),
				Match.when('read', () => {
					life.read(body, state.tick)
					own.next = state.tick
				}),
				Match.when('accept', () => {
					if (unit === undefined || own.pending === undefined) return
					release(id)
					unit.order = own.pending
					unit.upgrade = unit.order._tag === 'Refit'
					if (unit.order._tag === 'Construct') {
						own.projects = Array.dedupe([...(own.projects ?? []), unit.order.building])
					}
					unit.path = []
					unit.task = start.planning
					own.pending = undefined
					own.intent = 'continue'
				}),
				Match.when('rest', () => {
					own.intent = 'rest'
				}),
				Match.when('resume', () => {
					own.intent = 'continue'
				}),
				Match.when('attack', () => {
					own.intent = 'attack'
					own.foe = Option.getOrUndefined(Option.map(target, fact => fact.id))
				}),
				Match.whenOr('north', 'east', 'south', 'west', direction => {
					own.intent = 'explore'
					own.target = {x: body.x + STEP[direction].x * 10, z: body.z + STEP[direction].z * 10}
				}),
				Match.when('approach', () => {
					own.intent = 'explore'
					own.target = Option.getOrUndefined(Option.map(target, fact => ({x: fact.x, z: fact.z})))
				}),
				Match.when('flee', () => {
					const disturbance = Option.getOrElse(
						Option.orElse(
							Option.flatMap(
								Array.findLast(own.recent, entry => entry.kind === 'damage' && entry.subject !== undefined),
								entry => Array.findFirst(own.facts, fact => fact.id === entry.subject)
							),
							() => Array.findLast(own.facts, fact => fact.kind !== 'storage' && fact.kind !== 'resource')
						),
						() => ({x: body.x - Math.sin(body.yaw) * 3, z: body.z - Math.cos(body.yaw) * 3})
					)
					own.intent = 'explore'
					own.target = {x: body.x * 2 - disturbance.x, z: body.z * 2 - disturbance.z}
				}),
				Match.when('investigate', () => {
					const trace = Option.getOrUndefined(
						nearest(
							body,
							Array.filter(
								life.traces(state.tick),
								entry => entry.fresh > 0 && distance(body, entry) < 12 * daylightAt(state.tick)
							)
						)
					)
					if (trace === undefined) return
					own.intent = 'explore'
					own.target = {x: trace.x + Math.sin(trace.yaw) * 4, z: trace.z + Math.cos(trace.yaw) * 4}
					life.event(
						body,
						state.tick,
						'observe',
						`Tracks near ${place2(trace)}: wear ${Number.round(trace.wear, 2)}, freshness ${Number.round(trace.fresh, 2)}; direction ${Number.round(trace.yaw, 1)}. Overlapping impressions: ${Array.join(
							Array.map(
								trace.impressions ?? [],
								impression => `${impression.kind} (wear ${Number.round(impression.wear, 2)})`
							),
							', '
						)}. Maker unknown; latest direction and freshness do not date every impression.`
					)
				}),
				Match.when('work', () => {
					if (unit === undefined) return
					release(id)
					unit.order = {_tag: 'Auto'}
					unit.upgrade = false
					unit.path = []
					unit.task = start.planning
					own.intent = 'continue'
				}),
				Match.whenOr('inspect', 'take', 'build', 'deposit', 'repair', intent => {
					if (unit === undefined || Option.isNone(target)) return
					release(id)
					const building = Option.getOrThrow(target).id
					unit.order = pipe(
						Match.value(intent),
						Match.when('take', () => ({_tag: 'Loot' as const, building})),
						Match.when('build', () => ({_tag: 'Construct' as const, building})),
						Match.when('deposit', () => ({_tag: 'Deposit' as const, building})),
						Match.when('repair', () => ({_tag: 'Repair' as const, unit: building})),
						Match.orElse(() => ({_tag: 'Inspect' as const, building}))
					)
					if (intent === 'build') own.projects = Array.dedupe([...(own.projects ?? []), building])
					unit.upgrade = false
					unit.path = []
					unit.task = start.planning
					own.intent = 'continue'
				}),
				Match.orElse(() => undefined)
			)
		}

		// Its cargo into the nearest store that takes it.
		function unload(unit: Unit) {
			return Option.match(
				nearest(
					unit,
					Array.filter(
						life.person(unit.id, state.tick).facts,
						fact => fact.form !== undefined && Array.contains(STORES, fact.form) && fact.stage !== 'Missing'
					)
				),
				{
					onNone: () => wait('No remembered storage; observe a container before delivering.'),
					onSome: store => job({_tag: 'Dropoff', building: store.id})
				}
			)
		}

		function park(unit: Unit) {
			const home = homeAt(unit.team)
			const index = Option.getOrElse(
				Array.findFirstIndex(
					Array.filter(unitsOf(unit.team), other => other.order._tag === 'Auto'),
					other => other.id === unit.id
				),
				() => 0
			)
			const angle = 0.9 + (index % 9) * ((Math.PI * 2 - 1.8) / 8)
			const radius = 4.5 + Math.floor(index / 9) * 1.4
			return job({_tag: 'Hold', x: home.x + Math.sin(angle) * radius, z: home.z + Math.cos(angle) * radius})
		}

		// The solid props standing on a site's footprint, which a Builder clears before it builds.
		function propsOn(building: {kind: Kind; x: number; z: number}) {
			const size = sizeOf(building.kind)
			return Array.filter(
				propsNear(centreOf(building), Number.max(size.w, size.d) / 2 + 1),
				prop =>
					Record.has(SOLID, prop.kind) &&
					prop.x >= building.x &&
					prop.x < building.x + size.w &&
					prop.z >= building.z &&
					prop.z < building.z + size.d
			)
		}

		// A private construction plan uses remembered sites and inspected supplies, never shared reservations.
		function construct(id: number) {
			const unit = unitOf(id)
			if (unit === undefined) return wait('gone')
			if (unit.claim !== undefined && cargoOf(unit) > 0) return job({_tag: 'Dropoff', building: unit.claim.site})
			if (cargoOf(unit) > 0) return unload(unit)
			const own = life.person(id, state.tick)
			const project = Option.getOrUndefined(
				nearest(
					unit,
					Array.filter(
						own.facts,
						fact => Array.contains(own.projects ?? [], fact.id) && fact.stage !== 'Complete' && fact.stage !== 'Missing'
					)
				)
			)
			if (project === undefined) return park(unit)
			const site = buildingOf(project.id)
			if (site === undefined || gapTo(site, unit) > 1.5) {
				return job({_tag: 'Inspect', building: project.id, x: project.x, z: project.z})
			}
			inspectStorage(living(unit), site)
			if (complete(site)) return wait('The inspected project is already built.')
			const obstacle = Option.getOrUndefined(Array.head(propsOn(site)))
			if (obstacle !== undefined) return job({_tag: 'Clear', prop: obstacle.id, x: obstacle.x, z: obstacle.z})
			if (Sites.root.matches(site.site, 'Constructing')) return job({_tag: 'Construct', site: site.id})
			const need = Option.getOrUndefined(
				Array.findFirst(
					itemsIn(costOf(site.kind)),
					candidate => countOf(site.stock, candidate) < countOf(costOf(site.kind), candidate)
				)
			)
			if (need === undefined) return wait('Waiting for the supplied site to be ready.')
			const source = Option.getOrUndefined(
				nearest(
					unit,
					Array.filter(
						own.facts,
						fact =>
							fact.id !== site.id &&
							fact.kind === 'storage' &&
							fact.stage !== 'Missing' &&
							(fact.items === undefined || countOf(fact.items, need) > 0)
					)
				)
			)
			if (source === undefined) return wait(`No remembered supply of ${need}; inspect storage or gather resources.`)
			const count = Number.min(markOf(unit).cargo, countOf(costOf(site.kind), need) - countOf(site.stock, need))
			unit.claim = {count, from: source.id, item: need, site: site.id}
			return job({_tag: 'Pickup', building: source.id, count, item: need})
		}

		// The nearest thing a Builder digs or clears for an item round a place: ore on a field tile, a tree for wood, a rock or a stone tile for stone.
		function gatherAt(unit: Unit, item: ItemId, at: Point) {
			if (distance(unit, at) > markOf(unit).sight * daylightAt(state.tick)) return job({_tag: 'Scout', ...at})
			const prop = Option.getOrUndefined(
				nearest(
					unit,
					Array.filter(
						propsNear(at, NEAR),
						entry =>
							distance(unit, entry) <= markOf(unit).sight * daylightAt(state.tick) &&
							Array.contains(clearedFor(item), entry.kind)
					)
				)
			)
			if (prop !== undefined) {
				return job({_tag: 'Clear', prop: prop.id, x: prop.x, z: prop.z})
			}
			const tiles = Array.filter(
				Array.flatMap(Array.range(-NEAR, NEAR), dz =>
					Array.map(Array.range(-NEAR, NEAR), dx => ({x: Math.floor(at.x) + dx, z: Math.floor(at.z) + dz}))
				),
				tile =>
					Option.exists(materialAt(tile.x, tile.z), material => ORE_ITEM[material] === item) &&
					known(-unit.id, tile) &&
					!blocked(tile.x, tile.z)
			)
			return Option.match(
				nearest(
					unit,
					Array.map(tiles, tile => ({x: tile.x + 0.5, z: tile.z + 0.5}))
				),
				{
					onNone: () => wait(`no ${item} to gather within ${NEAR} tiles of (${Math.floor(at.x)}, ${Math.floor(at.z)})`),
					onSome: tile => job({_tag: 'Gather', item, x: Math.floor(tile.x), z: Math.floor(tile.z)})
				}
			)
		}

		// A Builder gathering digs until its cargo is full, or nothing is left round the place, then brings it to a store.
		function gather(unit: Unit, order: Extract<Standing, {_tag: 'Gather'}>) {
			if (Array.some(itemsIn(unit.cargo), item => item !== order.item) || spaceOf(unit) <= 0) return unload(unit)
			const found = gatherAt(unit, order.item, order)
			if (Option.isNone(found.job) && cargoOf(unit) > 0) return unload(unit)
			return found
		}

		function haul(unit: Unit, order: Extract<Standing, {_tag: 'Haul'}>) {
			const stop = Boolean.match(cargoOf(unit) > 0, {onFalse: () => order.from, onTrue: () => order.to})
			const remembered = Option.getOrUndefined(
				Array.findFirst(life.person(unit.id, state.tick).facts, fact => fact.id === stop)
			)
			if (remembered === undefined) return wait(`location of #${stop} unknown; observe it or obtain directions`)
			if (remembered.stage === 'Missing') return wait(`Last visit found #${stop} missing.`)
			if (cargoOf(unit) > 0) return job({_tag: 'Dropoff', building: stop})
			const source = buildingOf(order.from)
			if (source === undefined || gapTo(source, unit) > 1.5) {
				return job({_tag: 'Inspect', building: stop, x: remembered.x, z: remembered.z})
			}
			inspectStorage(living(unit), source)
			return Option.match(
				Option.orElse(Option.fromUndefinedOr(order.item), () =>
					Array.findFirst(itemsIn({...source.stock, ...source.output}), candidate => !Array.contains(FLUIDS, candidate))
				),
				{
					onNone: () => wait(`No accessible items observed at #${source.id}.`),
					onSome: item => {
						const available = countOf(source.stock, item) + countOf(source.output, item)
						if (available <= 0) return wait(`No ${item} observed at #${source.id}.`)
						return job({
							_tag: 'Pickup',
							building: source.id,
							count: Number.min(spaceOf(unit), Number.min(available, order.count ?? Infinity)),
							item
						})
					}
				}
			)
		}

		// The nearest ground the team has not seen that the unit can stand on, on rings round it.
		function frontier(unit: Unit) {
			const mover = MOVERS[moverOf(unit)]
			const sight = markOf(unit).sight
			return Array.findFirst(
				Array.flatMap(Array.range(1, 14), ring =>
					Array.map(Array.range(0, 23), turn => ({
						x: unit.x + Math.sin(((turn + (unit.id % 7)) / 24) * Math.PI * 2) * (sight + ring * 6),
						z: unit.z + Math.cos(((turn + (unit.id % 7)) / 24) * Math.PI * 2) * (sight + ring * 6)
					}))
				),
				at => !known(-unit.id, at) && standable(mover, ground(Math.floor(at.x), Math.floor(at.z)))
			)
		}

		function rememberedInspection(unit: Unit, building: number, recipe?: RecipeId) {
			return Option.match(
				Array.findFirst(
					life.person(unit.id, state.tick).facts,
					fact => fact.id === building && fact.stage !== 'Missing'
				),
				{
					onNone: () => wait('container location unknown'),
					onSome: fact =>
						job(
							Option.match(Option.fromUndefinedOr(recipe), {
								onNone: () => ({_tag: 'Inspect' as const, building: fact.id, x: fact.x, z: fact.z}),
								onSome: selected => ({
									_tag: 'Configure' as const,
									building: fact.id,
									recipe: selected,
									x: fact.x,
									z: fact.z
								})
							})
						)
				}
			)
		}

		// The next step of a unit's standing order.

		function next(unit: Unit) {
			const home = homeAt(unit.team)
			if (unit.upgrade) {
				if (Array.some(teamOf(unit.team)?.line ?? [], entry => entry.unit === unit.id)) {
					return job({_tag: 'Hold', x: home.x, z: home.z + 2.5})
				}
				return job({_tag: 'Refit'})
			}
			return Match.valueTags(unit.order, {
				Attack: () => wait('target not currently visible'),
				Auto: () => {
					if (cargoOf(unit) > 0 && unit.class !== 'builder') return unload(unit)
					if (unit.class === 'builder') return construct(unit.id)
					return park(unit)
				},
				Build: plan => job({_tag: 'Stake', ...Struct.omit(plan, ['_tag'])}),
				Configure: order => rememberedInspection(unit, order.building, order.recipe),
				Construct: () => construct(unit.id),
				Deposit: order => job({_tag: 'Dropoff', building: order.building}),
				Explore: () =>
					Option.match(frontier(unit), {
						onNone: () => wait('nothing unseen in reach'),
						onSome: to => job({_tag: 'Scout', x: to.x, z: to.z})
					}),
				Gather: order => gather(unit, order),
				Go: order => job({_tag: 'Hold', x: order.x + 0.5, z: order.z + 0.5}),
				Guard: order => job({_tag: 'Hold', x: order.x + 0.5, z: order.z + 0.5}),
				Haul: order => haul(unit, order),
				Inspect: order => rememberedInspection(unit, order.building),
				Investigate: order => job({_tag: 'Scout', x: order.x, z: order.z}),
				Loot: order => rememberedInspection(unit, order.building),
				Refit: () => job({_tag: 'Refit'}),
				Repair: order =>
					Option.match(
						Array.findFirst(life.person(unit.id, state.tick).facts, fact => fact.id === order.unit),
						{
							onNone: () => wait('No personally known location for that unit.'),
							onSome: fact => job({_tag: 'Repair', unit: order.unit, x: fact.x, z: fact.z})
						}
					)
			})
		}

		// Where a step takes a unit, and how near it must get.
		function inspectionTarget(unit: Unit, building: number, at: Point) {
			const remembered = Option.getOrUndefined(
				Array.findFirst(life.person(unit.id, state.tick).facts, fact => fact.id === building)
			)
			if (remembered?.form !== undefined) {
				const size = sizeOf(remembered.form)
				return beside(
					Option.some({kind: remembered.form, x: remembered.x - size.w / 2, z: remembered.z - size.d / 2}),
					unit
				)
			}
			const found = buildingOf(building)
			if (found !== undefined && gapTo(found, unit) <= 12 * daylightAt(state.tick)) {
				return beside(Option.some(found), unit)
			}
			if (distance(unit, at) > 12 * daylightAt(state.tick)) return Option.some({near: 0.5, to: at})
			return beside(MutableHashMap.get(buildings, building), unit)
		}

		function storageTarget(unit: Unit, building: number) {
			return Option.flatMap(
				Array.findFirst(life.person(unit.id, state.tick).facts, fact => fact.id === building),
				fact => inspectionTarget(unit, building, fact)
			)
		}

		// Whether a step can still be done: what it goes for is still there.
		function valid(unit: Unit, step: Job) {
			if (step._tag === 'Pickup' || step._tag === 'Dropoff') return true
			if (step._tag === 'Construct') {
				return Option.exists(Option.fromUndefinedOr(buildingOf(step.site)), site =>
					Sites.root.matches(site.site, 'Constructing')
				)
			}
			if (step._tag === 'Clear') {
				return (
					distance(unit, step) > markOf(unit).sight * daylightAt(state.tick) || !MutableHashSet.has(cleared, step.prop)
				)
			}
			if (step._tag === 'Gather') {
				return (
					distance(unit, step) > markOf(unit).sight * daylightAt(state.tick) ||
					Option.isSome(materialAt(step.x, step.z))
				)
			}
			if (step._tag === 'Refit') return unit.upgrade
			return true
		}

		// How long a step takes once there.
		function secondsOf(unit: Unit, step: Job) {
			const rates = markOf(unit)
			return Match.valueTags(step, {
				Clear: obstacle =>
					Boolean.match(
						Array.some(
							propsNear(obstacle, 0.5),
							entry => entry.id === obstacle.prop && Array.contains(BOULDERS, entry.kind)
						),
						{onFalse: () => rates.clear?.tree ?? 6, onTrue: () => rates.clear?.rock ?? 12}
					),
				Configure: () => 1,
				Construct: () => 1,
				Dropoff: () => 0.6,
				Gather: () => rates.gather ?? 2,
				Hold: () => Boolean.match(unit.order._tag === 'Auto', {onFalse: () => 5, onTrue: () => 2}),
				Inspect: () => 1,
				Pickup: () => 0.6,
				Refit: () => 0,
				Repair: () => 6,
				Scout: () => 0,
				Stake: () => 1
			})
		}
		function describe(unit: Unit, step: Job) {
			if (step._tag === 'Pickup') return `fetching ${step.count} ${step.item} from #${step.building}`
			if (step._tag === 'Dropoff') return `bringing ${itemsText(unit.cargo)} to #${step.building}`
			if (step._tag === 'Construct') return `building #${step.site}`
			if (step._tag === 'Clear') return 'clearing a tree or rock'
			if (step._tag === 'Gather') return `digging ${step.item}`
			if (step._tag === 'Repair') return `repairing #${step.unit}`
			if (step._tag === 'Inspect') return `inspecting #${step.building}`
			if (step._tag === 'Configure') return `configuring #${step.building}`
			if (step._tag === 'Stake') return `staking ${step.kind} at ${place2(step)}`
			if (step._tag === 'Refit') return 'going Home to be refitted'
			if (step._tag === 'Scout') return 'exploring'
			if (unit.order._tag === 'Guard') return 'guarding'
			if (unit.order._tag === 'Go') return 'waiting where it was sent'
			return 'waiting by Home'
		}

		// A finished site: its items are used up, it takes its place in the world, and a road, ramp or bridge changes the ground.
		function built(id: number) {
			const site = buildingOf(id)
			if (site === undefined) return
			revision.buildings += 1
			if (site.kind === 'road') setEdit(site.x, site.z, {_tag: 'Road'})
			if (site.kind === 'bridge') {
				const tile = ground(site.x, site.z)
				setEdit(site.x, site.z, {_tag: 'Bridge', level: Number.max(tile.surface, lowest(tile.corners)) + 0.3})
			}
			if (site.kind === 'ramp') {
				const low = lowest(ground(site.x, site.z).corners)
				const corners = Array.map(CORNERS, corner => low + riseOf(site.dir, corner))
				setEdit(site.x, site.z, {
					_tag: 'Ramp',
					corners: [corners[0] ?? low, corners[1] ?? low, corners[2] ?? low, corners[3] ?? low]
				})
			}
			if (Schema.is(StructureKind)(site.kind) && Array.contains(['road', 'ramp', 'bridge'], site.kind)) return
			if (gapTo(site, homeAt(site.team)) <= HOME_SIGHT * life.visibility(homeAt(site.team), state.tick)) {
				notify(site.team, `${buildingName(site)} at (${site.x}, ${site.z}) is built.`)
			}
		}

		function blueprintProblem(
			team: number,
			plan: Extract<Standing, {_tag: 'Build'}> | Extract<Command, {_tag: 'Build'}> | Extract<Job, {_tag: 'Stake'}>
		) {
			if (plan.kind === 'home') return 'Each team has one Core.'
			if (!unlocked(team, tierOf(plan.kind))) {
				return `${plan.kind} unlocks with ${tierOf(plan.kind)} (${GATES[tierOf(plan.kind)].name})`
			}
			if (plan.to !== undefined) {
				if (plan.to.x !== plan.x && plan.to.z !== plan.z) return 'A construction line must be straight along x or z.'
				const length = Number.max(Math.abs(plan.to.x - plan.x), Math.abs(plan.to.z - plan.z))
				if (length > 59) return 'A construction proposal contains at most 60 tiles.'
				if (Schema.is(BuildingKind)(plan.kind) && length > 0) return 'Only structures are laid in a line.'
			}
			return ''
		}

		function missingStorage(id: number, building: number) {
			const unit = unitOf(id)
			if (unit === undefined) return
			const remembered = Option.getOrUndefined(
				Array.findFirst(life.person(unit.id, state.tick).facts, fact => fact.id === building)
			)
			if (remembered === undefined) return
			life.inspect(
				living(unit),
				{
					...Struct.omit(remembered, ['tick', 'source']),
					items: {},
					stage: 'Missing',
					text: `Visited the remembered location of #${building}; no container remains.`
				},
				state.tick
			)
			release(unit.id)
			life.person(unit.id, state.tick).next = state.tick
			if (Array.contains(['Inspect', 'Loot', 'Deposit', 'Configure'], unit.order._tag)) {
				unit.order = {_tag: 'Go', x: Math.floor(unit.x), z: Math.floor(unit.z)}
			}
		}

		// A finished pickup: the items move into the cargo bed, and a claim on them shrinks to what came.
		function pickedUp(id: number, step: Extract<Job, {_tag: 'Pickup'}>) {
			const unit = unitOf(id)
			if (unit === undefined) return
			const container = buildingOf(step.building)
			if (container === undefined) return missingStorage(unit.id, step.building)
			if (gapTo(container, unit) > 1.5) return
			const got = take(step.building, step.item, Number.min(step.count, spaceOf(unit)))
			unit.cargo = withItem(unit.cargo, step.item, got)
			const inspected = buildingOf(step.building)
			if (inspected !== undefined) inspectStorage(living(unit), inspected)
			life.event(living(unit), state.tick, 'action', `Took ${got} ${step.item} from #${step.building}.`, step.building)
			if (unit.claim !== undefined && unit.claim.from === step.building) {
				unit.claim = {count: got, item: unit.claim.item, site: unit.claim.site}
			}
		}

		// A finished dropoff: the cargo goes in, a claim delivered there ends, and a counted haul counts down.
		function droppedOff(id: number, building: number) {
			const unit = unitOf(id)
			const container = buildingOf(building)
			if (unit === undefined) return
			if (container === undefined) return missingStorage(unit.id, building)
			if (gapTo(container, unit) > 1.5) return
			const requested = Option.getOrUndefined(Option.filter(Option.some(unit.order), order => order._tag === 'Haul'))
			const delivered = Array.reduce(itemsIn(unit.cargo), 0, (sum, item) => {
				const given = put(building, item, countOf(unit.cargo, item))
				unit.cargo = withItem(unit.cargo, item, -given)
				return (
					sum +
					Boolean.match(
						requested === undefined ||
							requested._tag !== 'Haul' ||
							requested.item === undefined ||
							requested.item === item,
						{onFalse: () => 0, onTrue: () => given}
					)
				)
			})
			inspectStorage(living(unit), container)
			life.event(living(unit), state.tick, 'action', `Delivered ${delivered} items into #${building}.`, building)
			if (unit.claim !== undefined && unit.claim.site === building) {
				unit.claim = undefined
			}
			if (unit.order._tag === 'Haul' && unit.order.count !== undefined) {
				const left = unit.order.count - delivered
				unit.order = {...unit.order, count: left}
				if (left <= 0) unit.order = {_tag: 'Auto'}
			}
			if (unit.order._tag === 'Deposit') unit.order = {_tag: 'Go', x: Math.floor(unit.x), z: Math.floor(unit.z)}
		}

		// A finished clearing: the prop goes, and its wood or stone fills the cargo bed.
		function clearedBy(id: number, step: Extract<Job, {_tag: 'Clear'}>) {
			const unit = unitOf(id)
			const prop = Option.getOrUndefined(
				Array.findFirst(propsNear({x: step.x, z: step.z}, 0.5), entry => entry.id === step.prop)
			)
			if (unit === undefined || prop === undefined) return
			clearProp(prop.id, prop)
			const got = Number.min(yieldOf(prop), spaceOf(unit))
			unit.cargo = withItem(unit.cargo, clearedItem(prop.kind), got)
			life.event(
				living(unit),
				state.tick,
				'action',
				`Cleared ${prop.kind}; collected ${got} ${clearedItem(prop.kind)}.`
			)
		}

		// A site's construction after an event.
		const advanceSite = Effect.fnUntraced(function* (id: number, event: SiteEvent) {
			const site = buildingOf(id)
			if (site === undefined) return
			site.site = (yield* Machine.plan(Sites, site.site, event)).next
		})

		// A second of a Builder's work on a site, which is built once none is left.
		const raise = Effect.fnUntraced(function* (id: number, actor: Unit) {
			yield* advanceSite(id, {_tag: 'Work', seconds: 1})
			if (Option.exists(Option.fromUndefinedOr(buildingOf(id)), complete)) {
				built(id)
				life.event(living(actor), state.tick, 'action', `Completed construction of #${id}.`, id)
			}
		})

		function minedTiles(miner: Building) {
			return Array.flatMap(Array.range(miner.z - 1, miner.z + 2), z =>
				Array.map(Array.range(miner.x - 1, miner.x + 2), x => ({x, z}))
			)
		}

		// Whether a team may build on a tile: seen, dry, flat enough to stand on, and free.
		function buildable(kind: Kind, x: number, z: number) {
			const tile = ground(x, z)
			if (MutableHashMap.has(footprint, tileKey(x, z))) return 'a tile already built on'
			if (kind === 'pump' && !Array.contains(SWIMMABLE, tile.liquid)) return 'a pump stands on water'
			if (kind === 'pump') return ''
			if (kind === 'bridge' && tile.liquid === LIQUID.none) return 'a bridge crosses water'
			if (kind === 'bridge') return ''
			if (tile.liquid !== LIQUID.none && tile.liquid !== LIQUID.ice) return 'water or lava'
			if (!standable(MOVERS.legs, tile)) return 'ground too steep'
			if (
				Array.some(
					propsNear({x: x + 0.5, z: z + 0.5}, 0.5),
					prop => prop.kind === 'ruin' && Math.floor(prop.x) === x && Math.floor(prop.z) === z
				)
			) {
				return 'a ruin'
			}
			return ''
		}

		function occupy(building: Building) {
			const size = sizeOf(building.kind)
			for (const dz of Array.range(0, size.d - 1)) {
				for (const dx of Array.range(0, size.w - 1)) {
					MutableHashMap.set(footprint, tileKey(building.x + dx, building.z + dz), building.id)
				}
			}
		}

		function place(team: number, kind: Kind, at: Point, dir: Direction) {
			const size = sizeOf(kind)
			const problem = Option.getOrUndefined(
				Array.findFirst(
					Array.flatMap(Array.range(0, size.d - 1), dz =>
						Array.map(Array.range(0, size.w - 1), dx => ({x: at.x + dx, z: at.z + dz}))
					),
					tile => Option.liftPredicate(buildable(kind, tile.x, tile.z), reason => reason !== '')
				)
			)
			if (problem !== undefined) return {id: 0, reason: problem}
			if (
				(kind === 'miner_mk1' || kind === 'miner_mk2' || kind === 'miner_mk3') &&
				!Array.some(minedTiles({...newBuilding(0, team, kind, at, dir, start.clearing)}), tile =>
					Option.isSome(materialAt(tile.x, tile.z))
				)
			) {
				return {id: 0, reason: 'a miner stands on an ore field'}
			}
			const id = nextId()
			const building = newBuilding(id, team, kind, at, dir, start.clearing)
			// Grass, shrubs and pebbles go at once; trees and rocks wait for a Builder.
			for (const prop of Array.filter(
				propsNear(centreOf(building), Number.max(size.w, size.d)),
				entry =>
					!Record.has(SOLID, entry.kind) &&
					entry.x >= at.x &&
					entry.x < at.x + size.w &&
					entry.z >= at.z &&
					entry.z < at.z + size.d
			)) {
				clearProp(prop.id, prop)
			}
			MutableHashMap.set(buildings, id, building)
			occupy(building)
			revision.buildings += 1
			return {id, reason: ''}
		}

		function configure(id: number, recipe: RecipeId) {
			const machine = buildingOf(id)
			if (machine === undefined) return
			// A batch under way is undone: its inputs go back.
			const running = Option.getOrUndefined(recipeOf(machine))
			if (running !== undefined && machine.progress >= 0) {
				for (const item of itemsIn(running.inputs)) {
					machine.stock = withItem(machine.stock, item, countOf(running.inputs, item))
				}
			}
			machine.recipe = recipe
			machine.progress = -1
			revision.buildings += 1
		}

		// What a finished step does to the world.
		function finish(id: number, step: Job) {
			const unit = unitOf(id)
			if (unit === undefined) return Effect.void
			return Match.valueTags(step, {
				Clear: clear => Effect.sync(() => clearedBy(id, clear)),
				Configure: setup =>
					Effect.sync(() => {
						const machine = buildingOf(setup.building)
						if (machine === undefined) missingStorage(unit.id, setup.building)
						if (
							machine !== undefined &&
							gapTo(machine, unit) <= 1.5 &&
							RECIPES[setup.recipe].building === machine.kind &&
							unlocked(unit.team, RECIPES[setup.recipe].tier)
						) {
							configure(machine.id, setup.recipe)
							life.event(
								living(unit),
								state.tick,
								'action',
								`Configured #${machine.id} for ${setup.recipe}.`,
								machine.id
							)
						}
						unit.order = {_tag: 'Auto'}
					}),
				Construct: raising => raise(raising.site, unit),
				Dropoff: dropoff => Effect.sync(() => droppedOff(id, dropoff.building)),
				Gather: dig =>
					Effect.sync(() => {
						setAmount(dig.x, dig.z, oreAt(dig.x, dig.z) - 1)
						unit.cargo = withItem(unit.cargo, dig.item, 1)
						life.event(living(unit), state.tick, 'action', `Gathered 1 ${dig.item} at ${place2(dig)}.`)
					}),
				Hold: () => Effect.void,
				Inspect: inspected =>
					Effect.sync(() => {
						const container = buildingOf(inspected.building)
						if (container === undefined) missingStorage(unit.id, inspected.building)
						if (container !== undefined && gapTo(container, unit) <= 1.5) {
							inspectStorage(living(unit), container)
							if (unit.order._tag === 'Loot') {
								for (const item of Array.filter(
									itemsIn({...container.stock, ...container.output}),
									candidate => !Array.contains(FLUIDS, candidate)
								)) {
									pickedUp(id, {_tag: 'Pickup', building: container.id, count: spaceOf(unit), item})
								}
							}
						}
						if (unit.order._tag === 'Inspect' || unit.order._tag === 'Loot') {
							unit.order = {_tag: 'Go', x: Math.floor(unit.x), z: Math.floor(unit.z)}
						}
						life.person(id, state.tick).next = state.tick
					}),
				Pickup: pickup => Effect.sync(() => pickedUp(id, pickup)),
				Refit: () =>
					Effect.sync(() => {
						const team = teamOf(unit.team)
						const problem = refitProblem(unit)
						if (team === undefined || problem !== '') {
							unit.upgrade = false
							unit.order = {_tag: 'Go', x: Math.floor(unit.x), z: Math.floor(unit.z)}
							life.event(living(unit), state.tick, 'action', `Refit refused: ${problem || 'no workshop'}.`)
							return
						}
						if (!Array.some(team.line, entry => entry.unit === id)) {
							team.line = [...team.line, {class: unit.class, mark: unit.mark + 1, unit: id}]
						}
					}),
				Repair: repair =>
					Effect.sync(() => {
						const other = unitOf(repair.unit)
						unit.order = {_tag: 'Go', x: Math.floor(unit.x), z: Math.floor(unit.z)}
						if (other === undefined || distance(unit, other) > 1.5 || other.health > 0 || unit.class !== 'builder') {
							life.event(
								living(unit),
								state.tick,
								'action',
								`Visited the last observed location of #${repair.unit}; no repair was possible here.`,
								repair.unit
							)
							return
						}
						other.health = markOf(other).health * 0.4
						life.person(other.id, state.tick).health = 0.4
						life.person(other.id, state.tick).next = state.tick
						life.event(living(unit), state.tick, 'action', `Repaired #${other.id}.`, other.id)
						life.event(living(other), state.tick, 'action', `Repaired by #${unit.id}.`, unit.id)
					}),
				Scout: scout =>
					Effect.sync(() =>
						life.event(living(unit), state.tick, 'action', `Reached exploration destination ${place2(scout)}.`)
					),
				Stake: blueprint =>
					Effect.sync(() => {
						const problem = blueprintProblem(unit.team, blueprint)
						if (unit.class !== 'builder' || problem !== '') {
							life.event(
								living(unit),
								state.tick,
								'action',
								`Construction proposal refused: ${problem || 'only Builders stake sites'}.`
							)
							unit.order = {_tag: 'Go', x: Math.floor(unit.x), z: Math.floor(unit.z)}
							return
						}
						lookRound(-id, unit, markOf(unit).sight * daylightAt(state.tick))
						const placed = place(unit.team, blueprint.kind, blueprint, blueprint.dir ?? 'east')
						const site = buildingOf(placed.id)
						if (site !== undefined) {
							const own = life.person(id, state.tick)
							own.projects = Array.dedupe([...(own.projects ?? []), site.id])
							life.inspect(
								living(unit),
								{
									form: site.kind,
									id: site.id,
									items: {},
									kind: 'storage',
									stage: site.site.state.path,
									text: `Staked ${site.kind}; initially empty construction stock.`,
									...centreOf(site)
								},
								state.tick
							)
						}
						life.event(
							living(unit),
							state.tick,
							'action',
							Boolean.match(placed.id > 0, {
								onFalse: () => `Construction proposal refused here: ${placed.reason}.`,
								onTrue: () => `Staked ${blueprint.kind} #${placed.id}.`
							}),
							Option.getOrUndefined(Option.filter(Option.some(placed.id), found => found > 0))
						)
						if (blueprint.to !== undefined && (blueprint.to.x !== blueprint.x || blueprint.to.z !== blueprint.z)) {
							const direction = lineTiles(blueprint, blueprint.to).dir
							unit.order = {
								_tag: 'Build',
								...Struct.omit(blueprint, ['_tag']),
								x: blueprint.x + STEP[direction].x,
								z: blueprint.z + STEP[direction].z
							}
						} else {
							unit.order = {_tag: 'Auto'}
						}
					})
			})
		}

		// A unit's step after an event; a finished step does its work and the unit chooses again.
		const send = Effect.fnUntraced(function* (id: number, event: TaskEvent) {
			const unit = unitOf(id)
			if (unit === undefined) return
			unit.task = (yield* Machine.plan(Tasks, unit.task, event)).next
			if (unit.task.state.path !== 'Done') return
			yield* finish(id, unit.task.state.value.job)
			unit.task = (yield* Machine.plan(Tasks, unit.task, {_tag: 'Reset'})).next
		})

		// A unit choosing its next step: the step it plans, or why it has none.
		function choose(id: number) {
			const unit = unitOf(id)
			if (unit === undefined) return Effect.void
			const plan = next(unit)
			return Option.match(plan.job, {
				onNone: () => send(id, {_tag: 'Block', reason: plan.reason, until: state.tick + 40}),
				onSome: step => {
					unit.doing = describe(unit, step)
					return send(id, {_tag: 'Plan', job: step})
				}
			})
		}

		// The next bit of a unit's step: waiting out being stuck, choosing a step, working at it or going there.
		function pursue(id: number) {
			const unit = unitOf(id)
			if (unit === undefined) return Effect.void
			const task = unit.task.state
			if (task.path === 'Stuck') {
				unit.doing = task.value.reason
				if (state.tick >= task.value.until) return send(id, {_tag: 'Retry'})
				return Effect.void
			}
			if (task.path === 'Planning' || task.path === 'Done') return choose(id)
			if (!valid(unit, task.value.job)) {
				release(id)
				return send(id, {_tag: 'Reset'})
			}
			unit.doing = describe(unit, task.value.job)
			if (task.path === 'Working') {
				unit.act = 'work'
				return send(id, {_tag: 'Work', seconds: TICK})
			}
			const target = Option.getOrUndefined(
				Match.valueTags(task.value.job, {
					Clear: obstacle => Option.some({near: 0.9, to: {x: obstacle.x, z: obstacle.z}}),
					Configure: setup => inspectionTarget(unit, setup.building, setup),
					Construct: site => beside(MutableHashMap.get(buildings, site.site), unit),
					Dropoff: drop => storageTarget(unit, drop.building),
					Gather: dig => Option.some({near: 0.4, to: {x: dig.x + 0.5, z: dig.z + 0.5}}),
					Hold: hold => Option.some({near: 0, to: {x: hold.x, z: hold.z}}),
					Inspect: inspect => inspectionTarget(unit, inspect.building, inspect),
					Pickup: pickup => storageTarget(unit, pickup.building),
					Refit: () => Option.some({near: 2.5, to: homeAt(unit.team)}),
					Repair: repair => Option.some({near: 1, to: {x: repair.x ?? unit.x, z: repair.z ?? unit.z}}),
					Scout: scout => Option.some({near: 1, to: {x: scout.x, z: scout.z}}),
					Stake: stake => Option.some({near: 1.5, to: {x: stake.x + 0.5, z: stake.z + 0.5}})
				})
			)
			if (target === undefined) {
				release(id)
				return send(id, {_tag: 'Reset'})
			}
			if (unit.lost) {
				unit.lost = false
				release(id)
				return send(id, {_tag: 'Block', reason: 'cannot reach where it was going', until: state.tick + 60})
			}
			if (goTo(id, target.to, target.near)) return send(id, {_tag: 'Arrive', seconds: secondsOf(unit, task.value.job)})
			return Effect.void
		}

		// One tick of a unit: down, fighting, fleeing and being repaired come first; then the next bit of its step.
		function behave(id: number) {
			const unit = unitOf(id)
			if (unit === undefined) return Effect.void
			unit.act = 'idle'
			if (unit.health <= 0) {
				unit.act = 'die'
				unit.doing = 'down, waiting for a Builder'
				unit.path = []
				return Effect.void
			}
			const own = life.person(id, state.tick)
			if (own.intent === 'rest') {
				unit.doing = 'resting and observing'
				return Effect.void
			}
			if (own.intent === 'attack' && own.foe !== undefined) {
				if (!attack(living(unit), own.foe, 4 * (markOf(unit).damage ?? 0.5))) {
					own.intent = 'continue'
					own.foe = undefined
					own.next = state.tick
					unit.doing = 'pursuit ended; awaiting a local decision'
					life.event(living(unit), state.tick, 'action', 'Stopped the pursuit; no active target is visible.')
				}
				return Effect.void
			}
			if (own.intent === 'explore' && own.target !== undefined) {
				const destination = own.target
				if (goTo(id, destination, 0.5) || unit.lost) {
					life.event(
						living(unit),
						state.tick,
						'action',
						Boolean.match(unit.lost, {
							onFalse: () => `Reached ${place2(destination)}.`,
							onTrue: () => `No route to ${place2(destination)} from here.`
						})
					)
					own.target = undefined
					own.intent = 'continue'
					own.next = state.tick
					unit.lost = false
				}
				return Effect.void
			}
			if (unit.order._tag === 'Attack') {
				unit.doing = 'target not currently visible'
				attack(living(unit), unit.order.target, 4 * (markOf(unit).damage ?? 0.5))
				return Effect.void
			}
			return pursue(id)
		}

		/* ───────── buildings: sites, power, production ───────── */

		function vacate(building: Building) {
			const size = sizeOf(building.kind)
			for (const dz of Array.range(0, size.d - 1)) {
				for (const dx of Array.range(0, size.w - 1)) {
					const key = tileKey(building.x + dx, building.z + dz)
					if (Option.contains(MutableHashMap.get(footprint, key), building.id)) MutableHashMap.remove(footprint, key)
				}
			}
		}

		// Sites move on once their footprint is clear and once their items are all there.
		const sites = Effect.fnUntraced(function* () {
			for (const site of Array.filter(allBuildings(), building => !complete(building))) {
				if (site.site.state.path === 'Clearing' && Array.isArrayEmpty(propsOn(site))) {
					yield* advanceSite(site.id, {_tag: 'Cleared'})
				}
				if (site.site.state.path === 'Supplying' && covers(site.stock, costOf(site.kind))) {
					for (const item of itemsIn(costOf(site.kind))) {
						site.stock = withItem(site.stock, item, -countOf(costOf(site.kind), item))
					}
					yield* advanceSite(site.id, {_tag: 'Supplied', seconds: buildSeconds(site.kind)})
					revision.buildings += 1
				}
			}
		})

		// The team's power networks: poles wired to poles in reach, each with the generators and machines in reach of its poles.
		function rewire() {
			grid.at = revision.buildings
			MutableHashMap.clear(grid.of)
			grid.nets = Array.flatMap(allTeams(), team => {
				const groups = Array.reduce(
					Array.filter(
						buildingsOf(team.id),
						building => (building.kind === 'pole' || building.kind === 'pylon') && complete(building)
					),
					Array.empty<Building[]>(),
					(found, pole: Building) => {
						const joined = Array.filter(found, group =>
							Array.some(group, other => distance(other, pole) <= Number.max(reachOf(other).link, reachOf(pole).link))
						)
						return [...Array.filter(found, group => !Array.contains(joined, group)), [pole, ...Array.flatten(joined)]]
					}
				)
				const powered = Array.filter(
					buildingsOf(team.id),
					building => Schema.is(BuildingKind)(building.kind) && BUILDINGS[building.kind].mw !== 0 && complete(building)
				)
				return Array.map(groups, group => {
					const members = Array.filter(powered, building =>
						Array.some(group, pole => gapTo(building, {x: pole.x + 0.5, z: pole.z + 0.5}) <= reachOf(pole).reach)
					)
					return {
						consumers: Array.map(
							Array.filter(
								members,
								building => Schema.is(BuildingKind)(building.kind) && BUILDINGS[building.kind].mw > 0
							),
							building => building.id
						),
						generators: Array.map(
							Array.filter(
								members,
								building => Schema.is(BuildingKind)(building.kind) && BUILDINGS[building.kind].mw < 0
							),
							building => building.id
						),
						ratio: 0
					}
				})
			})
			Array.forEach(grid.nets, (net, index) => {
				for (const id of [...net.consumers, ...net.generators]) MutableHashMap.set(grid.of, id, index)
			})
		}

		// How fast a building that draws power runs: its network's supply over demand, at most 1.
		function powerOf(building: Building) {
			if (!Schema.is(BuildingKind)(building.kind) || BUILDINGS[building.kind].mw <= 0) return 1
			return Option.getOrElse(
				Option.flatMap(MutableHashMap.get(grid.of, building.id), index =>
					Option.map(Array.get(grid.nets, index), net => net.ratio)
				),
				() => 0
			)
		}

		// Whether a machine wants power this tick: it runs a batch, or a miner has room in its buffer.
		function drawing(building: Building) {
			if (building.kind === 'pump') return true
			if (building.kind === 'miner_mk2' || building.kind === 'miner_mk3') return totalOf(building.output) < BUFFER
			return building.progress >= 0
		}

		function fuelled(generator: Building) {
			return (
				(waterOf(generator.kind) <= 0 || countOf(generator.stock, 'water') > 0) &&
				(generator.fuel > 0 || Array.some(itemsIn(generator.stock), item => item !== 'water'))
			)
		}

		// Each network shares what its fuelled generators give among the machines that want it; generators burn in proportion to the load.
		function power() {
			if (grid.at !== revision.buildings) rewire()
			for (const net of grid.nets) {
				const generators = Array.filter(
					Array.getSomes(Array.map(net.generators, id => Option.fromUndefinedOr(buildingOf(id)))),
					fuelled
				)
				const consumers = Array.filter(
					Array.getSomes(Array.map(net.consumers, id => Option.fromUndefinedOr(buildingOf(id)))),
					drawing
				)
				const supply = Number.sumAll(Array.map(generators, generator => Math.abs(mwOf(generator.kind))))
				const demand = Number.sumAll(Array.map(consumers, consumer => mwOf(consumer.kind)))
				net.ratio = 1
				if (demand > 0) net.ratio = Number.min(1, supply / demand)
				// The share of the generators' output drawn, 0 with none fuelled.
				const load = Number.min(demand, supply) / Number.max(supply, 1e-9)
				for (const generator of generators) {
					generator.fuel -= Math.abs(mwOf(generator.kind)) * load * TICK
					if (waterOf(generator.kind) > 0) {
						// Water drains by the tick's share, so a generator holds a fraction of a unit between pipe deliveries.
						generator.stock = withItem(generator.stock, 'water', -waterOf(generator.kind) * load * TICK)
					}
					const burnt = Option.getOrUndefined(Array.findFirst(itemsIn(generator.stock), item => item !== 'water'))
					if (generator.fuel <= 0 && burnt !== undefined) {
						generator.stock = withItem(generator.stock, burnt, -1)
						generator.fuel += countOf(fuelsOf(generator.kind), burnt)
					}
				}
			}
		}

		// The ore tiles a miner digs: under it and the ring round it.

		function mine(id: number) {
			const miner = buildingOf(id)
			if (miner === undefined) return
			if (miner.kind !== 'miner_mk1' && miner.kind !== 'miner_mk2' && miner.kind !== 'miner_mk3') return
			if (totalOf(miner.output) >= BUFFER) return
			miner.progress = Number.max(0, miner.progress) + (BUILDINGS[miner.kind].rate ?? 0) * powerOf(miner) * TICK
			if (miner.progress < 1) return
			miner.progress -= 1
			const found = Option.getOrUndefined(
				Array.findFirst(minedTiles(miner), tile =>
					Option.map(materialAt(tile.x, tile.z), material => ({material, tile}))
				)
			)
			if (found === undefined) {
				miner.progress = -1
				return
			}
			setAmount(found.tile.x, found.tile.z, oreAt(found.tile.x, found.tile.z) - 1)
			miner.output = withItem(miner.output, ORE_ITEM[found.material], 1)
		}

		// A machine starts a batch once its inputs are in and its output has room, takes the inputs then, and puts out the batch when it is done.
		function make(id: number) {
			const machine = buildingOf(id)
			const recipe = Option.getOrUndefined(Option.flatMap(Option.fromUndefinedOr(machine), recipeOf))
			if (machine === undefined || recipe === undefined) return
			if (machine.progress < 0) {
				if (totalOf(machine.output) + totalOf(recipe.outputs) > BUFFER || !covers(machine.stock, recipe.inputs)) return
				for (const item of itemsIn(recipe.inputs)) {
					machine.stock = withItem(machine.stock, item, -countOf(recipe.inputs, item))
				}
				machine.progress = 0
			}
			machine.progress += TICK * powerOf(machine)
			if (machine.progress < recipe.seconds) return
			machine.progress = -1
			for (const item of itemsIn(recipe.outputs)) {
				machine.output = withItem(machine.output, item, countOf(recipe.outputs, item))
			}
		}

		// The tile a belt hands its item on to.
		function ahead(belt: Building, dir: Direction = belt.dir) {
			return {x: belt.x + STEP[dir].x, z: belt.z + STEP[dir].z}
		}

		// Where a belt puts its item: ahead, or for a splitter left and right in turn.
		function outOf(belt: Building) {
			if (belt.kind !== 'splitter') return ahead(belt)
			return ahead(belt, turned(belt.dir, (belt.cursor % 2) * 2 - 1))
		}

		function beltAt(x: number, z: number) {
			return Option.filter(
				Option.flatMap(MutableHashMap.get(footprint, tileKey(x, z)), id => MutableHashMap.get(buildings, id)),
				building =>
					Schema.is(StructureKind)(building.kind) && Array.contains(BELTS, building.kind) && complete(building)
			)
		}

		function buildingAt(x: number, z: number) {
			return Option.filter(
				Option.flatMap(MutableHashMap.get(footprint, tileKey(x, z)), id => MutableHashMap.get(buildings, id)),
				building => Schema.is(BuildingKind)(building.kind) && complete(building)
			)
		}

		// A belt's item onto the belt or into the building ahead; one a full building turns away goes back on the belt.
		function handOn(id: number, item: ItemId) {
			const belt = buildingOf(id)
			if (belt === undefined) return
			const to = outOf(belt)
			const onto = Option.getOrUndefined(beltAt(to.x, to.z))
			const into = Option.getOrUndefined(buildingAt(to.x, to.z))
			if (onto !== undefined) {
				onto.stock = withItem(onto.stock, item, 1)
				onto.progress = 0
			}
			if (onto === undefined && (into === undefined || put(into.id, item, 1) === 0)) {
				belt.stock = withItem(belt.stock, item, 1)
				return
			}
			belt.progress = 0
			belt.cursor += 1
		}

		// Belts move together: from the items where they lie at the tick's start, every item whose way on is free (or frees up this tick) goes on a tile, at its belt's rate; a belt ending at a building puts its item in, a machine puts its output on a belt leading away from it.
		function belts() {
			const all = Array.filter(
				allBuildings(),
				building =>
					Schema.is(StructureKind)(building.kind) && Array.contains(BELTS, building.kind) && complete(building)
			)
			for (const belt of all) {
				belt.progress = Number.min(1, Number.max(0, belt.progress) + rateOf(belt.kind) * TICK)
			}
			const moving = MutableHashMap.empty<number, boolean>()
			// Whether a belt's item goes on this tick: onto a building with room, an empty belt, a belt of the same loop, or a belt whose own item goes on.
			function moves(belt: Building, trail: number[]) {
				const settled = Option.getOrUndefined(MutableHashMap.get(moving, belt.id))
				if (settled !== undefined) return settled
				const item = Option.getOrUndefined(Array.head(itemsIn(belt.stock)))
				if (item === undefined || belt.progress < 1) return false
				const to = outOf(belt)
				const onto = Option.getOrUndefined(beltAt(to.x, to.z))
				if (onto === undefined) return Option.exists(buildingAt(to.x, to.z), building => roomFor(building, item) > 0)
				MutableHashMap.set(
					moving,
					belt.id,
					Array.isArrayEmpty(itemsIn(onto.stock)) || Array.contains(trail, onto.id) || moves(onto, [...trail, belt.id])
				)
				return Option.getOrElse(MutableHashMap.get(moving, belt.id), () => false)
			}
			const items = Array.map(
				Array.filter(all, belt => moves(belt, [])),
				belt => ({belt, item: Option.getOrThrow(Array.head(itemsIn(belt.stock)))})
			)
			// Each belt gives up only the item it hands on: two belts feeding one keep both items there, and a building already full sends its item back.
			for (const entry of items) {
				entry.belt.stock = withItem(entry.belt.stock, entry.item, -1)
			}
			for (const entry of items) handOn(entry.belt.id, entry.item)
			// Machines and miners put their output on the empty belts that start beside them and run away from them.
			for (const belt of Array.filter(all, entry => Array.isArrayEmpty(itemsIn(entry.stock)))) {
				const behind = ahead(belt, turned(belt.dir, 2))
				const source = Option.getOrUndefined(buildingAt(behind.x, behind.z))
				const item = Option.getOrUndefined(Array.head(itemsIn(source?.output ?? {})))
				if (source !== undefined && item !== undefined) {
					source.output = withItem(source.output, item, -1)
					belt.stock = {[item]: 1}
					belt.progress = 0
				}
			}
		}

		// Pipe networks: pipes touching pipes, with the pumps and fluid buildings touching them; one fluid a network.
		function replumb() {
			pipes.at = revision.buildings
			MutableHashMap.clear(pipes.of)
			const groups = Array.reduce(
				Array.filter(allBuildings(), building => building.kind === 'pipe' && complete(building)),
				Array.empty<Building[]>(),
				(found, conduit: Building) => {
					const joined = Array.filter(found, group =>
						Array.some(group, other => Math.abs(other.x - conduit.x) + Math.abs(other.z - conduit.z) === 1)
					)
					return [...Array.filter(found, group => !Array.contains(joined, group)), [conduit, ...Array.flatten(joined)]]
				}
			)
			const previous = pipes.nets
			pipes.nets = Array.map(groups, group => {
				const members = Array.dedupe(
					Array.flatMap(group, conduit =>
						Array.getSomes(
							Array.map(DIRECTIONS, dir => {
								const at = ahead(conduit, dir)
								return Option.map(
									Option.filter(buildingAt(at.x, at.z), building =>
										Array.contains(['pump', 'refinery', 'steam_generator', 'core_generator'], building.kind)
									),
									building => building.id
								)
							})
						)
					)
				)
				const ids = Array.map(group, conduit => conduit.id)
				const before = inherited(previous, ids)
				return {
					fluid: before.fluid,
					members,
					pipes: ids,
					room: group.length * 10 + members.length * 50,
					stock: Number.min(before.stock, group.length * 10 + members.length * 50)
				}
			})
			Array.forEach(pipes.nets, (net, index) => {
				for (const id of net.members) {
					MutableHashMap.set(pipes.of, id, [...Option.getOrElse(MutableHashMap.get(pipes.of, id), () => []), index])
				}
			})
		}

		// A building on a pipe network: a pump only fills it with water, while it holds water or nothing; a machine takes the fluid it uses from it and puts the fluids it makes into it, if it holds that fluid or none.
		function exchange(at: number, id: number) {
			const net = pipes.nets[at]
			const building = buildingOf(id)
			if (net === undefined || building === undefined) return
			if (building.kind === 'pump') {
				if (!Option.exists(net.fluid, fluid => fluid !== 'water')) {
					net.fluid = Option.some('water')
					net.stock = Number.min(net.room, net.stock + 12 * TICK * powerOf(building))
				}
				return
			}
			const uses = Array.dedupe([
				...Option.match(recipeOf(building), {onNone: () => [], onSome: recipe => itemsIn(recipe.inputs)}),
				...Array.filter(['water' as const], () => waterOf(building.kind) > 0)
			])
			const taken = Option.getOrUndefined(
				Option.filter(net.fluid, fluid => Array.contains(uses, fluid) && Array.contains(FLUIDS, fluid))
			)
			if (taken !== undefined) {
				const moved = Math.floor(Number.min(Number.max(0, 20 - countOf(building.stock, taken)), net.stock))
				building.stock = withItem(building.stock, taken, moved)
				net.stock -= moved
			}
			for (const fluid of Array.filter(
				itemsIn(building.output),
				item => Array.contains(FLUIDS, item) && !Array.contains(uses, item)
			)) {
				if (!Option.exists(net.fluid, held => held !== fluid)) {
					const moved = Number.min(countOf(building.output, fluid), Math.floor(net.room - net.stock))
					net.fluid = Option.some(fluid)
					net.stock += moved
					building.output = withItem(building.output, fluid, -moved)
				}
			}
		}

		// Each pipe network's buildings exchange their fluids with it; an emptied network holds no fluid.
		function fluids() {
			if (pipes.at !== revision.buildings) replumb()
			Array.forEach(pipes.nets, (_, at) => {
				const net = pipes.nets[at]
				if (net === undefined) return
				for (const id of net.members) exchange(at, id)
				if (net.stock <= 0) net.fluid = Option.none()
			})
		}

		// Home's bench works its queue a recipe at a time, taking each batch's inputs from Home when it starts.
		function bench(id: number) {
			const team = teamOf(id)
			if (team === undefined) return
			const home = homeOf(id)
			const head = Option.getOrUndefined(Array.head(team.bench))
			if (home === undefined || head === undefined) {
				team.benchProgress = -1
				return
			}
			const recipe = RECIPES[head.recipe]
			if (team.benchProgress < 0) {
				if (!covers(home.stock, recipe.inputs)) return
				for (const item of itemsIn(recipe.inputs)) {
					home.stock = withItem(home.stock, item, -countOf(recipe.inputs, item))
				}
				team.benchProgress = 0
			}
			team.benchProgress += TICK
			if (team.benchProgress < recipe.seconds) return
			team.benchProgress = -1
			for (const item of itemsIn(recipe.outputs)) {
				home.stock = withItem(home.stock, item, countOf(recipe.outputs, item))
			}
			team.bench = Array.drop(team.bench, 1)
			if (head.left > 1) team.bench = [{...head, left: head.left - 1}, ...team.bench]
			if (Array.isReadonlyArrayEmpty(team.bench)) notify(id, `Home's bench finished its queue and is idle.`)
		}

		// Home's line makes or refits one unit at a time, taking its items when it starts.
		function presentForRefit(id: number, home: Building) {
			const candidate = unitOf(id)
			return candidate !== undefined && candidate.health > 0 && candidate.upgrade && gapTo(home, candidate) <= 2.5
		}

		function withdrawRefit(id: number, head: Team['line'][number]) {
			if (head.unit === undefined) return false
			const team = teamOf(id)
			const home = homeOf(id)
			if (team === undefined || home === undefined) return false
			const candidate = unitOf(head.unit)
			const spec = Option.getOrUndefined(Array.get(UNITS[head.class].marks, head.mark))
			if (
				candidate !== undefined &&
				candidate.upgrade &&
				candidate.health > 0 &&
				spec !== undefined &&
				unlocked(team.id, spec.tier)
			) {
				return false
			}
			if (spec !== undefined && team.lineProgress >= 0) {
				for (const item of itemsIn(spec.cost)) home.stock = withItem(home.stock, item, countOf(spec.cost, item))
			}
			team.line = Array.drop(team.line, 1)
			team.lineProgress = -1
			return true
		}

		function finishLine(id: number, home: Building, head: Team['line'][number]) {
			const unit = unitOf(head.unit ?? -1)
			if (unit === undefined) {
				const at = centreOf(home)
				const made = nextId()
				MutableHashMap.set(
					units,
					made,
					newUnit(made, id, head.class, head.mark, {x: at.x, z: at.z + 2.5}, start.planning)
				)
				notify(id, `Home made #${made} ${head.class} mk${head.mark + 1}.`)
				recordBirth(made)
				return
			}
			unit.mark = head.mark
			unit.health = markOf(unit).health
			unit.upgrade = false
			if (unit.order._tag === 'Refit') unit.order = {_tag: 'Auto'}
			release(unit.id)
			unit.task = start.planning
			notify(id, `${unitName(unit)} is refitted.`)
		}

		function line(id: number) {
			const team = teamOf(id)
			if (team === undefined) return
			const home = homeOf(id)
			const head = Option.getOrUndefined(Array.head(team.line))
			if (home === undefined || head === undefined) {
				team.lineProgress = -1
				return
			}
			if (withdrawRefit(id, head)) return
			const spec = Option.getOrUndefined(Array.get(UNITS[head.class].marks, head.mark))
			if (spec === undefined) {
				team.line = Array.drop(team.line, 1)
				team.lineProgress = -1
				return
			}
			if (head.unit !== undefined && !presentForRefit(head.unit, home)) return
			if (team.lineProgress < 0) {
				if (!covers(home.stock, spec.cost)) return
				for (const item of itemsIn(spec.cost)) {
					home.stock = withItem(home.stock, item, -countOf(spec.cost, item))
				}
				team.lineProgress = 0
			}
			team.lineProgress += TICK
			if (team.lineProgress < spec.seconds) return
			team.lineProgress = -1
			team.line = Array.drop(team.line, 1)
			revision.teams += 1
			finishLine(id, home, head)
		}

		function emit(building: Building) {
			if (
				(Array.contains(MAKERS, building.kind) && building.progress > 0) ||
				((building.kind === 'burner_generator' || building.kind === 'steam_generator') && building.fuel > 0)
			) {
				life.pollute(centreOf(building), 0.025, state.tick)
			}
		}

		/* ───────── one tick ───────── */

		const tick = Effect.fnUntraced(function* () {
			state.tick += 1
			state.searches = 0
			MutableList.clear(shots)
			for (const unit of allUnits()) yield* behave(unit.id)
			for (const id of Array.fromIterable(dirtyWild)) yield* transitionWild(id)
			MutableHashSet.clear(dirtyWild)
			for (const body of [...allEnemies(), ...Array.fromIterable(MutableHashMap.values(mobs))]) wildStep(body.id)
			separate()
			if (state.tick % 10 === 0) {
				explore()
				if (state.tick % 40 === 0) perceive()
			}
			if (state.tick % 20 === 0) {
				wildlife()
				life.weather(state.tick)
			}
			yield* sites()
			power()
			for (const building of Array.filter(allBuildings(), complete)) {
				mine(building.id)
				if (Schema.is(BuildingKind)(building.kind) && Array.contains(MAKERS, building.kind)) make(building.id)
				if (state.tick % TICK_HZ === 0) emit(building)
			}
			belts()
			fluids()
			for (const team of allTeams()) {
				bench(team.id)
				line(team.id)
			}
		})

		/* ───────── commands: what each team's model asks for, at a round's start ───────── */

		function commandBuild(team: Team, command: Extract<Command, {_tag: 'Build'}>) {
			const problem = blueprintProblem(team.id, command)
			if (problem !== '') return outcome(command, false, problem)
			const builder = Option.getOrUndefined(
				Array.head(
					Array.filter(
						unitsOf(team.id),
						unit => unit.class === 'builder' && (command.units === undefined || Array.contains(command.units, unit.id))
					)
				)
			)
			if (builder === undefined) return outcome(command, false, 'No registered Builder selected.')
			if (connected(builder)) {
				life.send(
					living(builder),
					team.home,
					state.tick,
					`Construction proposal: ${command.kind} at ${place2(command)}. Choose whether to read and accept it.`,
					{_tag: 'Build', ...Struct.omit(command, ['_tag', 'units'])}
				)
			}
			return outcome(
				command,
				true,
				`Blueprint transmission attempted to #${builder.id}; no physical site exists until an individual accepts, visits and stakes it. Ground and resource suitability are not remotely verified.`
			)
		}

		function commandOrder(team: Team, command: Extract<Command, {_tag: 'Order'}>) {
			const chosen = Array.filter(
				Array.getSomes(Array.map(command.units, id => Option.fromUndefinedOr(unitOf(id)))),
				unit => unit.team === team.id
			)
			if (chosen.length < command.units.length) return outcome(command, false, 'no such unit in your team')
			if (
				Array.contains(['Build', 'Construct', 'Repair', 'Gather'], command.order._tag) &&
				Array.some(chosen, unit => unit.class !== 'builder')
			) {
				return outcome(command, false, 'Only Builders construct, gather or repair.')
			}
			if (Array.some(command.facts ?? [], id => !Array.some(life.core(team.id).facts, fact => fact.id === id))) {
				return outcome(command, false, 'Only personally known observations can be forwarded.')
			}
			const problem = pipe(
				Match.value(command.order),
				Match.when({_tag: 'Build'}, order => blueprintProblem(team.id, order)),
				Match.when({_tag: 'Gather'}, order => {
					if (!Array.contains(['wood', 'stone', ...Record.values(ORE_ITEM)], order.item)) {
						return `${order.item} is not gathered by hand`
					}
					return ''
				}),
				Match.when({_tag: 'Haul'}, order => {
					if (Array.some(chosen, unit => markOf(unit).cargo === 0)) return 'Only Builders and Haulers carry.'
					if (Option.exists(Option.fromUndefinedOr(order.item), item => Array.contains(FLUIDS, item))) {
						return 'Fluids move in pipes.'
					}
					return ''
				}),
				Match.orElse(() => '')
			)
			if (problem !== '') return outcome(command, false, problem)
			for (const unit of chosen) {
				if (connected(unit)) {
					life.send(
						living(unit),
						team.home,
						state.tick,
						`Requested ${orderText(command.order)}. Choose whether to read and follow it.`,
						command.order,
						[],
						Array.filter(life.core(team.id).facts, fact => Array.contains(command.facts ?? [], fact.id))
					)
				}
			}
			return outcome(
				command,
				true,
				`${Array.join(
					Array.map(chosen, unit => `#${unit.id}`),
					', '
				)}: transmission attempted; delivery depends on coverage, not proof of reading or compliance`
			)
		}

		function commandRecipe(team: Team, command: Extract<Command, {_tag: 'Recipe'}>) {
			if (
				!Array.some(
					life.core(team.id).facts,
					fact =>
						fact.id === command.building &&
						distance(fact, homeAt(team.id)) <= HOME_SIGHT * life.visibility(homeAt(team.id), state.tick)
				)
			) {
				const builder = Option.getOrUndefined(Array.head(unitsOf(team.id)))
				if (builder === undefined) return outcome(command, false, 'No registered individual can receive a proposal.')
				return outcome(
					command,
					true,
					commandOrder(team, {
						_tag: 'Order',
						facts: Array.map(
							Array.filter(life.core(team.id).facts, fact => fact.id === command.building),
							fact => fact.id
						),
						order: {_tag: 'Configure', building: command.building, recipe: command.recipe},
						units: [builder.id]
					}).text
				)
			}
			const machine = buildingOf(command.building)
			const recipe = RECIPES[command.recipe]
			if (machine === undefined || machine.team !== team.id) {
				return outcome(command, false, 'no such building in your team')
			}
			if (recipe.building !== machine.kind) {
				return outcome(command, false, `${command.recipe} runs in a ${recipe.building}, not a ${machine.kind}`)
			}
			if (!unlocked(team.id, recipe.tier)) {
				return outcome(command, false, `${command.recipe} unlocks with ${recipe.tier}`)
			}
			configure(machine.id, command.recipe)
			return outcome(
				command,
				true,
				`${buildingName(machine)} now makes ${itemsText(recipe.outputs)} from ${itemsText(recipe.inputs)} every ${recipe.seconds} s`
			)
		}

		function commandCraft(id: number, command: Extract<Command, {_tag: 'Craft'}>) {
			const team = teamOf(id)
			const recipe = RECIPES[command.recipe]
			if (team === undefined) return outcome(command, false, 'no such team')
			if (recipe.building !== 'home') {
				return outcome(
					command,
					false,
					`${command.recipe} runs in a ${recipe.building}; Home's bench makes only bench_ recipes`
				)
			}
			if (!unlocked(id, recipe.tier)) return outcome(command, false, `${command.recipe} unlocks with ${recipe.tier}`)
			team.bench = [...team.bench, {left: command.count, recipe: command.recipe}]
			return outcome(command, true, `Home's bench queued ${command.recipe} × ${command.count}`)
		}

		function commandUpgrade(team: Team, command: Extract<Command, {_tag: 'Upgrade'}>) {
			const unit = unitOf(command.unit)
			if (unit === undefined || unit.team !== team.id) return outcome(command, false, 'no such unit in your team')
			const problem = refitProblem(unit)
			if (problem !== '') return outcome(command, false, problem)
			return outcome(command, true, commandOrder(team, {_tag: 'Order', order: {_tag: 'Refit'}, units: [unit.id]}).text)
		}

		// The building a milestone is paid from: Home, or the team's built Beacon.
		function payerOf(team: number, at: 'beacon' | 'home') {
			if (at === 'home') return homeOf(team)
			return Option.getOrUndefined(
				Array.findFirst(
					buildingsOf(team),
					building =>
						building.kind === 'beacon' &&
						complete(building) &&
						gapTo(building, homeAt(team)) <= HOME_SIGHT * life.visibility(homeAt(team), state.tick)
				)
			)
		}

		// The next milestone: a tier is paid from Home's stock, a phase or a Signal cycle from the Beacon's.
		function commandAdvance(id: number, command: Extract<Command, {_tag: 'Advance'}>) {
			const team = teamOf(id)
			if (team === undefined) return outcome(command, false, 'no such team')
			const gate = Option.getOrUndefined(nextGate(team))
			const milestone = Option.match(Option.fromUndefinedOr(gate), {
				onNone: () => ({at: 'beacon' as const, cost: cycleCost(team.cycles + 1)}),
				onSome: entry => ({at: GATES[entry].at, cost: GATES[entry].cost})
			})
			const store = payerOf(id, milestone.at)
			if (store === undefined) {
				return outcome(command, false, 'No locally accessible payment site; arrange one near the Core.')
			}
			if (!covers(store.stock, milestone.cost)) {
				const short = Array.filter(
					itemsIn(milestone.cost),
					item => countOf(store.stock, item) < countOf(milestone.cost, item)
				)
				return outcome(
					command,
					false,
					`${PAYERS[milestone.at]} lacks ${Array.join(
						Array.map(short, item => `${countOf(milestone.cost, item) - countOf(store.stock, item)} ${item}`),
						', '
					)}`
				)
			}
			for (const item of itemsIn(milestone.cost)) {
				store.stock = withItem(store.stock, item, -countOf(milestone.cost, item))
			}
			revision.teams += 1
			mark('milestone', id)
			if (gate === undefined) {
				team.cycles += 1
				return outcome(command, true, `Signal cycle ${team.cycles} sent`)
			}
			team.gates = [...team.gates, gate]
			return outcome(command, true, `${GATES[gate].name} done; it unlocks everything of tier ${gate}`)
		}

		// What taking a building down gives back: a built one's cost, a site's delivered items.
		function refundOf(building: Building) {
			if (complete(building) || Sites.root.matches(building.site, 'Constructing')) return costOf(building.kind)
			return building.stock
		}

		// A taken-down building's refund at Home, and a built one's solid stock and output with it.
		function refund(team: number, building: Building, back: Items) {
			const home = homeOf(team)
			if (home === undefined) return
			for (const item of itemsIn(back)) {
				home.stock = withItem(home.stock, item, countOf(back, item))
			}
			for (const item of itemsIn({...building.output, ...building.stock})) {
				if (complete(building) && !Array.contains(FLUIDS, item)) {
					home.stock = withItem(home.stock, item, countOf(building.output, item) + countOf(building.stock, item))
				}
			}
		}

		function commandCancel(team: Team, command: Extract<Command, {_tag: 'Cancel'}>) {
			const building = buildingOf(command.building)
			if (
				building === undefined ||
				building.team !== team.id ||
				gapTo(building, homeAt(team.id)) > HOME_SIGHT * life.visibility(homeAt(team.id), state.tick)
			) {
				return outcome(command, false, 'No locally accessible building of yours to dismantle.')
			}
			if (building.kind === 'home') return outcome(command, false, 'Home stays')
			// A built road, ramp or bridge is part of the ground now.
			if (complete(building) && Array.contains(['road', 'ramp', 'bridge'], building.kind)) {
				return outcome(command, false, 'a built road, ramp or bridge stays')
			}
			const back = refundOf(building)
			refund(team.id, building, back)
			vacate(building)
			MutableHashMap.remove(buildings, building.id)
			revision.buildings += 1
			return outcome(command, true, `${buildingName(building)} taken down; ${itemsText(back)} back at Home`)
		}

		function commandMessage(team: Team, command: Extract<Command, {_tag: 'Message'}>) {
			if (!Array.contains(life.core(team.id).contacts, command.team)) {
				return outcome(command, false, 'you can only message a team you have met')
			}
			const recipient = life.core(command.team)
			recipient.contacts = Array.dedupe([
				...recipient.contacts,
				team.id,
				...Array.filter(command.ids ?? [], id => Array.contains(life.core(team.id).contacts, id))
			])
			notify(command.team, `Message from team ${team.id} (${nameOf(team.id)}): ${command.text}`)
			mark('message', team.id, Option.some(command.team))
			return outcome(command, true, `sent to team ${command.team}`)
		}

		function apply(teamId: number, given: Command) {
			const team = teamOf(teamId)
			if (team === undefined) return outcome(given, false, 'no such team')
			return Match.valueTags(given, {
				Advance: command => commandAdvance(teamId, command),
				Build: command => commandBuild(team, command),
				Cancel: command => commandCancel(team, command),
				Catalog: command => {
					const catalog = {
						buildings: BUILDINGS,
						milestones: GATES,
						recipes: RECIPES,
						structures: STRUCTURES,
						units: UNITS
					}
					return outcome(command, true, JSON.stringify(catalog[command.section]))
				},
				Craft: command => commandCraft(teamId, command),
				Inspect: command => {
					const building = buildingOf(command.building)
					if (
						building === undefined ||
						distance(homeAt(teamId), centreOf(building)) > HOME_SIGHT * life.visibility(homeAt(teamId), state.tick)
					) {
						return outcome(command, false, 'The Core cannot open that storage remotely; send a unit to inspect it.')
					}
					const knowledge = life.core(teamId)
					const fact = {
						id: building.id,
						kind: 'storage',
						...centreOf(building),
						items: Record.fromEntries(
							Array.map(Array.dedupe([...itemsIn(building.stock), ...itemsIn(building.output)]), item => [
								item,
								countOf(building.stock, item) + countOf(building.output, item)
							])
						),
						source: team.home,
						text: `Inspected #${building.id}: stock ${itemsText(building.stock)}; output ${itemsText(building.output)}.`,
						tick: state.tick
					}
					knowledge.facts = [...Array.filter(knowledge.facts, remembered => remembered.id !== building.id), fact]
					return outcome(command, true, fact.text)
				},
				Make: command => {
					team.line = [...team.line, {class: command.unit, mark: 0}]
					return outcome(
						command,
						true,
						`Home's line queued a ${command.unit} mk1 (${itemsText(UNITS[command.unit].marks[0].cost)})`
					)
				},
				Message: command => commandMessage(team, command),
				Order: command => commandOrder(team, command),
				Ping: command => {
					const unit = unitOf(command.unit)
					if (unit === undefined || unit.team !== teamId || !connected(unit)) {
						return outcome(command, false, 'No location response; cause unknown.')
					}
					const knowledge = life.core(teamId)
					const fact = {
						id: unit.id,
						kind: kindOf(unit),
						source: team.home,
						text: `Radio position ping for #${unit.id}; condition unknown.`,
						tick: state.tick,
						x: unit.x,
						z: unit.z
					}
					knowledge.facts = [...Array.filter(knowledge.facts, remembered => remembered.id !== unit.id), fact]
					life.event(living(unit), state.tick, 'ping', 'Radio answered a location ping, independently of conversation.')
					return outcome(command, true, `#${unit.id} at ${place2(unit)}. This does not establish life or health.`)
				},
				Recall: command => outcome(command, false, 'Conversation retrieval is handled by the durable archive.'),
				Recipe: command => commandRecipe(team, command),
				Tell: command => {
					if (Array.some(command.facts ?? [], id => !Array.some(life.core(teamId).facts, fact => fact.id === id))) {
						return outcome(command, false, 'Only personally known observations can be forwarded.')
					}
					if (Array.some(command.ids ?? [], id => !Array.contains(life.core(teamId).contacts, id))) {
						return outcome(command, false, 'Cannot disclose an unknown communication address.')
					}
					for (const id of command.units) {
						const unit = unitOf(id)
						if (unit !== undefined && unit.team === teamId && connected(unit)) {
							life.send(
								living(unit),
								team.home,
								state.tick,
								command.text,
								undefined,
								command.ids ?? [],
								Array.filter(life.core(teamId).facts, fact => Array.contains(command.facts ?? [], fact.id))
							)
						}
					}
					return outcome(command, true, 'Transmission attempted; no reply or compliance is implied.')
				},
				Upgrade: command => commandUpgrade(team, command)
			})
		}

		/* ───────── what a team's model sees ───────── */

		function siteText(building: Building) {
			if (building.site.state.path === 'Complete') return ''
			if (building.site.state.path === 'Clearing') return ` SITE clearing ${propsOn(building).length} trees/rocks`
			if (building.site.state.path === 'Supplying') {
				return ` SITE has ${itemsText(building.stock)} of ${itemsText(costOf(building.kind))}`
			}
			return ` SITE building, ${Math.ceil(building.site.state.value.left)} s of work left`
		}

		function runText(building: Building) {
			if (!complete(building) || !Array.contains(MAKERS, building.kind)) return ''
			if (building.progress >= 0) return ' running'
			if (building.recipe === undefined) return ' idle: no recipe'
			return ' waiting for inputs or output room'
		}

		function powerText(building: Building) {
			if (!complete(building) || !Schema.is(BuildingKind)(building.kind) || BUILDINGS[building.kind].mw <= 0) return ''
			return ` power ${Number.round(powerOf(building) * 100, 0)}%`
		}

		function fuelText(building: Building) {
			if (
				!complete(building) ||
				!Schema.is(BuildingKind)(building.kind) ||
				BUILDINGS[building.kind].fuels === undefined
			) {
				return ''
			}
			if (fuelled(building)) return ' fuelled'
			return ' NO FUEL'
		}

		function buildingLine(building: Building) {
			return `#${building.id} ${building.kind} at ${place2(building)}${Array.join(
				[
					Boolean.match(Schema.is(StructureKind)(building.kind) && Array.contains(BELTS, building.kind), {
						onFalse: () => '',
						onTrue: () => ` ${building.dir}`
					}),
					siteText(building),
					Option.match(Option.fromUndefinedOr(building.recipe), {onNone: () => '', onSome: id => ` recipe ${id}`}),
					runText(building),
					powerText(building),
					fuelText(building),
					Boolean.match(complete(building) && Array.isArrayNonEmpty(itemsIn(building.stock)), {
						onFalse: () => '',
						onTrue: () => ` holds ${itemsText(building.stock)}`
					}),
					Boolean.match(Array.isArrayNonEmpty(itemsIn(building.output)), {
						onFalse: () => '',
						onTrue: () => ` output ${itemsText(building.output)}`
					})
				],
				''
			)}`
		}

		function observe(teamId: number) {
			const team = teamOf(teamId)
			if (team === undefined) return {notices: [], text: ''}
			const at = homeAt(teamId)
			const knowledge = life.core(teamId)
			for (const fact of resourcesAt(at, HOME_SIGHT * life.visibility(at, state.tick), team.home)) {
				knowledge.facts = [...Array.filter(knowledge.facts, remembered => remembered.id !== fact.id), fact]
			}
			for (const building of Array.filter(
				allBuildings(),
				candidate => gapTo(candidate, at) <= HOME_SIGHT * life.visibility(at, state.tick)
			)) {
				if (!Array.some(knowledge.facts, fact => fact.id === building.id)) {
					knowledge.facts = [
						...knowledge.facts,
						{
							form: building.kind,
							id: building.id,
							kind: 'storage',
							source: team.home,
							text: `Visible ${building.kind}; contents unknown until opened.`,
							tick: state.tick,
							...centreOf(building)
						}
					]
				}
			}
			for (const body of Array.filter(
				entities(),
				candidate => distance(candidate, at) <= HOME_SIGHT * life.visibility(at, state.tick)
			)) {
				if (body.team !== undefined && body.team !== teamId) {
					knowledge.contacts = Array.dedupe([...knowledge.contacts, body.team])
				}
				knowledge.facts = [
					...Array.filter(knowledge.facts, fact => fact.id !== body.id),
					{
						id: body.id,
						kind: body.kind,
						source: team.home,
						text: `Visible here: #${body.id} ${body.kind}, ${body.act}.`,
						tick: state.tick,
						x: body.x,
						z: body.z
					}
				]
			}
			const notices = team.inbox
			team.inbox = []
			const outcomes = team.outcomes
			team.outcomes = []
			const milestone = Option.match(nextGate(team), {
				onNone: () => `Signal cycle ${team.cycles + 1}`,
				onSome: gate => `${gate} ${GATES[gate].name}, paid at ${PAYERS[GATES[gate].at]}: ${itemsText(GATES[gate].cost)}`
			})
			return {
				notices,
				text: Array.join(
					[
						`Tick ${state.tick}. Your Core is #${team.home} at ${place2(at)}. Daylight ${Number.round(daylightAt(state.tick) * 100, 0)}%.`,
						`Next: ${milestone}. Home production queues: ${JSON.stringify({bench: team.bench, line: team.line})}.`,
						...Array.filter(
							[
								`Known communication addresses: ${Array.join(
									Array.map(knowledge.contacts, id => `${id}`),
									', '
								)}. You can pass known addresses in a message.`
							],
							() => Array.isReadonlyArrayNonEmpty(knowledge.contacts)
						),
						...Array.map(
							outcomes,
							result =>
								`${result.command._tag}: ${Boolean.match(result.ok, {onFalse: () => 'refused', onTrue: () => 'ok'})}: ${result.text}`
						),
						'Knowledge is last observed or reported, not live telemetry. Source and tick identify who learned it and when:',
						...Array.map(
							Array.reverse(Array.sortWith(knowledge.facts, fact => fact.tick, Number.Order)),
							fact =>
								`#${fact.id} at ${place2(fact)} [observed tick ${fact.tick}, source #${fact.source}; ${
									Array.join(
										Array.map(fact.via ?? [], relay => `reported by #${relay.from} at tick ${relay.tick}`),
										'; '
									) || 'direct observation'
								}]: ${fact.text}`
						)
					],
					'\n'
				)
			}
		}

		/* ───────── views: frames for spectators ───────── */

		function unitView(unit: Unit) {
			return {
				act: unit.act,
				aim: unit.aim,
				cargo: Option.getOrUndefined(Array.head(itemsIn(unit.cargo))),
				doing: unit.doing,
				health: unit.health / markOf(unit).health,
				id: unit.id,
				kind: kindOf(unit),
				load: cargoOf(unit) / Number.max(1, markOf(unit).cargo),
				team: unit.team,
				x: unit.x,
				yaw: unit.yaw,
				z: unit.z
			} satisfies UnitView
		}

		function mobView(mob: Mob) {
			return {
				act: mob.act,
				doing: mob.doing,
				health: life.person(mob.id, state.tick).health,
				id: mob.id,
				kind: mob.kind,
				load: 0,
				x: mob.x,
				yaw: mob.yaw,
				z: mob.z
			} satisfies UnitView
		}

		function enemyView(enemy: Enemy) {
			return {
				act: enemy.act,
				doing: enemy.doing,
				health: Number.max(0, enemy.health / 60),
				id: enemy.id,
				kind: enemy.kind,
				load: 0,
				x: enemy.x,
				yaw: enemy.yaw,
				z: enemy.z
			} satisfies UnitView
		}

		function buildingView(building: Building) {
			const size = sizeOf(building.kind)
			return {
				built: builtOf(building),
				d: size.d,
				dir: building.dir,
				id: building.id,
				// A structure shows the item riding on it.
				item: Option.getOrUndefined(
					Array.head(Array.filter(itemsIn(building.stock), () => Schema.is(StructureKind)(building.kind)))
				),
				kind: building.kind,
				recipe: building.recipe,
				status: buildingLine(building),
				team: building.team,
				w: size.w,
				x: building.x,
				z: building.z
			} satisfies BuildingView
		}

		function teamView(team: Team) {
			return {
				buildings: Array.countBy(
					buildingsOf(team.id),
					building => Schema.is(BuildingKind)(building.kind) && complete(building)
				),
				color: TEAMS[team.id]?.color ?? '#888888',
				contacts: life.core(team.id).contacts,
				cycles: team.cycles,
				gate: Option.match(nextGate(team), {
					onNone: () => `Signal cycle ${team.cycles + 1}`,
					onSome: id => GATES[id].name
				}),
				gates: team.gates.length,
				home: homeAt(team.id),
				id: team.id,
				model: TEAMS[team.id]?.model ?? '',
				name: nameOf(team.id),
				status: Option.getOrElse(MutableHashMap.get(status, team.id), () => 'waiting' as const),
				units: unitsOf(team.id).length
			} satisfies TeamView
		}

		const traceCache = {
			at: -1,
			keys: MutableHashSet.empty<number>(),
			values: Array.empty<NonNullable<Frame['traces']>[number]>()
		}
		function traceFrame(connection: {
			sent: boolean
			tracesAt: number
			traces: MutableHashMap.MutableHashMap<number, string>
		}) {
			const at = Math.floor(state.tick / TICK_HZ)
			if (connection.sent && connection.tracesAt === at) return undefined
			if (traceCache.at !== at) {
				traceCache.at = at
				traceCache.values = Array.filter(
					Array.map(life.traces(state.tick), trace => ({
						fresh: Number.round(trace.fresh, 2),
						smog: Number.round(trace.smog, 2),
						wear: Number.round(trace.wear, 2),
						x: trace.x,
						yaw: Number.round(trace.yaw, 1),
						z: trace.z
					})),
					trace => trace.fresh > 0 || trace.smog > 0 || trace.wear > 0
				)
				MutableHashSet.clear(traceCache.keys)
				for (const trace of traceCache.values) MutableHashSet.add(traceCache.keys, tileKey(trace.x, trace.z))
			}
			const changes = MutableList.make<NonNullable<Frame['traces']>[number]>()
			for (const trace of traceCache.values) {
				const key = tileKey(trace.x, trace.z)
				const signature = `${trace.fresh}:${trace.smog}:${trace.wear}:${trace.yaw}`
				if (!Option.contains(MutableHashMap.get(connection.traces, key), signature)) {
					MutableHashMap.set(connection.traces, key, signature)
					MutableList.append(changes, trace)
				}
			}
			for (const key of Array.fromIterable(MutableHashMap.keys(connection.traces))) {
				if (!MutableHashSet.has(traceCache.keys, key)) {
					MutableHashMap.remove(connection.traces, key)
					MutableList.append(changes, {...tileOf(key), fresh: 0, smog: 0, wear: 0, yaw: 0})
				}
			}
			return MutableList.toArray(changes)
		}

		// A spectator: the revisions of the tiles, props, buildings, teams and zones it has, and the version of each explored chunk it was sent.
		const connections = MutableHashMap.empty<
			number,
			{
				buildings: number
				explored: MutableHashMap.MutableHashMap<number, number>
				props: number
				sent: boolean
				teams: string
				tracesAt: number
				traces: MutableHashMap.MutableHashMap<number, string>
				tiles: number
				zones: number
			}
		>()
		const counter = {connection: 0}

		function overlayChange(key: number) {
			const tile = tileOf(key)
			return {
				amount: Option.getOrUndefined(MutableHashMap.get(amounts, key)),
				edit: Option.getOrUndefined(MutableHashMap.get(edits, key)),
				x: tile.x,
				z: tile.z
			} satisfies TileChange
		}

		function frame(id: number, at: number) {
			const connection = Option.getOrUndefined(MutableHashMap.get(connections, id))
			if (connection === undefined) return Option.none()
			const first = !connection.sent
			const oldest = Option.getOrElse(
				Option.map(Array.head(MutableList.toArray(log)), entry => entry.revision),
				() => revision.tiles + 1
			)
			// A spectator further behind than the log goes back gets every change again.
			const changes = Array.map(
				Array.dedupe(
					Boolean.match(first || connection.tiles < oldest - 1, {
						onFalse: () =>
							Array.map(
								Array.filter(MutableList.toArray(log), entry => entry.revision > connection.tiles),
								entry => entry.key
							),
						onTrue: () => [
							...Array.fromIterable(MutableHashMap.keys(amounts)),
							...Array.fromIterable(MutableHashMap.keys(edits))
						]
					})
				),
				overlayChange
			)
			const oldestProp = Option.getOrElse(
				Option.map(Array.head(MutableList.toArray(clearedLog)), entry => entry.revision),
				() => revision.props + 1
			)
			const props = Boolean.match(first || connection.props < oldestProp - 1, {
				onFalse: () =>
					Array.map(
						Array.filter(MutableList.toArray(clearedLog), entry => entry.revision > connection.props),
						entry => entry.id
					),
				onTrue: () => Array.fromIterable(cleared)
			})
			const newChunks = Array.flatMap(Array.fromIterable(seen), entry => {
				if (Option.getOrElse(MutableHashMap.get(connection.explored, entry[0]), () => -1) >= entry[1].version) return []
				MutableHashMap.set(connection.explored, entry[0], entry[1].version)
				return [{bits: Uint8Array.from(entry[1].bits), ...chunkFrom(entry[0])} satisfies Explored]
			})
			const teamViews = Array.map(allTeams(), teamView)
			const teamsText = JSON.stringify(teamViews)
			// Belts change every tick their items move: buildings go out when they change, and at least twice a second while belts run.
			const beltsRun = Array.some(
				allBuildings(),
				building => Schema.is(StructureKind)(building.kind) && Array.contains(BELTS, building.kind)
			)

			const result = {
				at,
				buildings: Boolean.match(
					first || connection.buildings !== revision.buildings || (beltsRun && state.tick % 10 === 0),
					{onFalse: () => undefined, onTrue: () => Array.map(allBuildings(), buildingView)}
				),
				changes,
				cleared: props,
				environment: life.environment(state.tick),
				explored: newChunks,
				shots: MutableList.toArray(shots),
				teams: Boolean.match(first || connection.teams !== teamsText, {
					onFalse: () => undefined,
					onTrue: () => teamViews
				}),
				tick: state.tick,
				traces: traceFrame(connection),
				units: [
					...Array.map(allUnits(), unitView),
					...Array.map(allEnemies(), enemyView),
					...Array.map(Array.fromIterable(MutableHashMap.values(mobs)), mobView)
				],
				world: Boolean.match(first, {onFalse: () => undefined, onTrue: () => ({generator: GENERATOR, seed})}),
				zones: Boolean.match(first || connection.zones !== revision.zones, {
					onFalse: () => undefined,
					onTrue: () =>
						Array.map(Array.fromIterable(visited), entry => ({...chunkFrom(entry[0]), teams: entry[1]}) satisfies Zone)
				})
			}
			connection.sent = true
			connection.tiles = revision.tiles
			connection.props = revision.props
			connection.buildings = revision.buildings
			connection.teams = teamsText
			connection.tracesAt = Math.floor(state.tick / TICK_HZ)
			connection.zones = revision.zones
			return Option.some(result)
		}

		/* ───────── saves ───────── */

		function restoreSight(owner: number, surveyed: readonly Explored[]) {
			for (const chunk of surveyed) {
				MutableHashMap.set(exploredOf(owner), chunkKey(chunk.cx, chunk.cz), {
					bits: Uint8Array.from(chunk.bits),
					version: 0
				})
				const all = bitsOf(seen, chunkKey(chunk.cx, chunk.cz))
				all.bits = Uint8Array.from(all.bits, (byte, index) => byte | (chunk.bits[index] ?? 0))
			}
		}

		const restore = Effect.fnUntraced(function* (previous: Saved) {
			state.draws = previous.draws
			state.nextId = previous.nextId
			state.tick = previous.tick
			state.wildId = previous.wildId
			Array.forEach(previous.amounts, entry => MutableHashMap.set(amounts, tileKey(entry[0], entry[1]), entry[2]))
			Array.forEach(previous.edits, entry => MutableHashMap.set(edits, tileKey(entry.x, entry.z), entry.edit))
			Array.forEach(previous.cleared, id => MutableHashSet.add(cleared, id))
			Array.forEach(previous.jams, entry => MutableHashMap.set(jams, entry[0], entry[1]))
			Array.forEach(previous.sides, entry => MutableHashMap.set(sides, entry[0], {side: entry[1], way: entry[2]}))
			Array.forEach(previous.stalls, entry =>
				MutableHashMap.set(stalls, entry[0], {best: entry[1], since: entry[2], to: entry[3]})
			)
			Array.forEach(previous.patches, entry => MutableHashMap.set(patches, entry[0], [...entry[1]]))
			// Each saved network as one of its pipes: the first replumb hands its fluid to the network that pipe is in.
			pipes.nets = Array.map(previous.pipes, entry => ({
				fluid: Option.some(entry[1]),
				members: Array.empty<number>(),
				pipes: [entry[0]],
				room: 0,
				stock: entry[2]
			}))
			Array.forEach(previous.visited, entry => MutableHashMap.set(visited, entry[0], entry[1]))
			for (const unit of previous.units) {
				MutableHashMap.set(units, unit.id, {
					...unit,
					path: [...unit.path],
					task: yield* Machine.decodeSnapshot(Tasks, unit.task)
				})
			}
			for (const building of previous.buildings) {
				const site = yield* Machine.decodeSnapshot(Sites, building.site)
				const stock = Boolean.match(previous.rules === undefined && site.state.path === 'Constructing', {
					onFalse: () => building.stock,
					onTrue: () =>
						Array.reduce(itemsIn(costOf(building.kind)), building.stock, (items, item) =>
							withItem(items, item, -Number.min(countOf(items, item), countOf(costOf(building.kind), item)))
						)
				})
				MutableHashMap.set(buildings, building.id, {...building, site, stock})
			}
			Array.forEach(allBuildings(), occupy)
			for (const enemy of previous.enemies) {
				MutableHashMap.set(enemies, enemy.id, {
					...enemy,
					task: yield* Option.match(Option.fromUndefinedOr(enemy.task), {
						onNone: () => Effect.succeed(start.creature),
						onSome: task => Machine.decodeSnapshot(Creatures, task)
					})
				})
			}
			for (const mob of previous.mobs) {
				MutableHashMap.set(mobs, mob.id, {
					...mob,
					task: yield* Option.match(Option.fromUndefinedOr(mob.task), {
						onNone: () => Effect.succeed(start.creature),
						onSome: task => Machine.decodeSnapshot(Creatures, task)
					})
				})
			}
			for (const team of previous.teams) {
				MutableList.append(teams, {
					bench: [...team.bench],
					benchProgress: team.benchProgress,
					cycles: team.cycles,
					gates: [...team.gates],
					home: team.home,
					id: team.id,
					inbox: [
						...team.inbox,
						...Option.toArray(
							Option.map(
								Option.filter(Option.fromUndefinedOr(team.note), () => previous.life === undefined),
								note =>
									`Previous Core continuation checkpoint, retained from the earlier release. Treat its statements as remembered claims, not new observations: ${note}`
							)
						)
					],
					line: [...team.line],
					lineProgress: team.lineProgress,
					outcomes: [...team.outcomes]
				})
				if (previous.life === undefined) life.core(team.id).contacts = [...(team.contacts ?? [])]
				restoreSight(team.id, team.explored)
			}
			if (previous.life === undefined) {
				Array.forEach(entities(), body =>
					life.event(
						body,
						state.tick,
						'observe',
						'Individual recording begins from the previous release. Earlier individual decisions were not recorded; this is not a birth event.'
					)
				)
			}
			Array.forEach(previous.life?.individuals ?? [], individual =>
				restoreSight(-individual.id, individual.explored ?? [])
			)
		})

		// A save of this world's generator picks up where it stopped; else each team starts with Home on its basin's floor and one Builder, knowing the ground round Home.
		yield* Option.match(
			Option.filter(saved, previous => previous.generator === GENERATOR),
			{
				onNone: () =>
					Effect.sync(() => {
						Array.forEach(spawns, (spawn, index) => {
							const homeId = nextId()
							const home = {
								...newBuilding(homeId, index, 'home', {x: spawn.x - 1, z: spawn.z - 1}, 'south', start.built),
								stock: START.stock
							}
							MutableHashMap.set(buildings, homeId, home)
							occupy(home)
							MutableList.append(teams, {
								bench: [],
								benchProgress: -1,
								cycles: 0,
								gates: [],
								home: homeId,
								id: index,
								inbox: ['The colony is founded: Home and one Builder. Everything else you gather, smelt and build.'],
								line: [],
								lineProgress: -1,
								outcomes: []
							})
							Array.forEach(START.units, (unitClass, n) => {
								const id = nextId()
								MutableHashMap.set(
									units,
									id,
									newUnit(id, index, unitClass, 0, {x: spawn.x + 0.5 + n, z: spawn.z + 3}, start.planning)
								)
								recordBirth(id)
							})
							lookRound(index, {x: spawn.x + 0.5, z: spawn.z + 0.5}, HOME_SIGHT)
						})
					}),
				onSome: restore
			}
		)

		Array.forEach([...allEnemies(), ...Array.fromIterable(MutableHashMap.values(mobs))], body =>
			MutableHashSet.add(dirtyWild, body.id)
		)

		return {
			acknowledge: (through: number) => life.acknowledge(through),
			// Applies one team's commands in order; what each did goes into its next observation.
			apply: (team: number, commands: Command[]) => {
				const results = Array.map(commands, command => apply(team, command))
				const entry = teamOf(team)
				if (entry !== undefined) entry.outcomes = [...entry.outcomes, ...results]
				return results
			},
			connect: () => {
				counter.connection += 1
				MutableHashMap.set(connections, counter.connection, {
					buildings: -1,
					explored: MutableHashMap.empty(),
					props: 0,
					sent: false,
					teams: '',
					tiles: 0,
					traces: MutableHashMap.empty(),
					tracesAt: -1,
					zones: -1
				})
				return counter.connection
			},
			decide: localDecision,
			decision: (id: number) =>
				Option.map(
					Option.filter(entity(id), body => body.health > 0),
					body => {
						const unit = unitOf(body.id)
						return life.local(body, state.tick, unit !== undefined && connected(unit))
					}
				),
			defer: (id: number, until: number) => {
				life.person(id, state.tick).next = until
			},
			disconnect: (id: number) => {
				MutableHashMap.remove(connections, id)
			},
			discovered: (team: number) => Array.isReadonlyArrayNonEmpty(life.core(team).contacts),
			due: () =>
				Array.map(
					Array.filter(entities(), body => body.health > 0 && life.person(body.id, state.tick).next <= state.tick),
					body => body.id
				),
			evidence: (receipt: NonNullable<Journal['locals']>[number]) => {
				if (receipt.context === undefined) return
				const body = Option.getOrUndefined(entity(receipt.actor))
				if (body !== undefined) {
					life.event(
						body,
						receipt.tick,
						'decision',
						receipt.failure ?? `Model returned ${receipt.choice ?? 'no choice'}; a response does not prove execution.`,
						undefined,
						{context: receipt.context, tokens: receipt.tokens ?? {}}
					)
				}
			},
			experiences: () => life.drain(),
			frame,
			individual: (id: number) => life.person(id, state.tick),
			// The timeline's marks since the last call.
			marks: () => {
				const taken = MutableList.toArray(marks)
				MutableList.clear(marks)
				return taken
			},
			observe,
			receive: (team: number, result: Outcome) => {
				const entry = teamOf(team)
				if (entry !== undefined) entry.outcomes = [...entry.outcomes, result]
			},
			// Advances the world a number of ticks.
			run: (ticks: number) =>
				Effect.mapError(
					Effect.forEach(Array.range(1, ticks), () => tick(), {concurrency: 1, discard: true}),
					cause => GameError.make({cause, message: 'The world could not go on.'})
				),
			seed,
			setStatus: (team: number, value: TeamView['status']) => {
				MutableHashMap.set(status, team, value)
			},
			// Everything a later run needs to go on from this tick.
			snapshot: Effect.mapError(
				Effect.gen(function* () {
					const saving = {
						buildings: yield* Effect.forEach(
							allBuildings(),
							building => Effect.map(Machine.encodeSnapshot(Sites, building.site), site => ({...building, site})),
							{concurrency: 1}
						),
						enemies: yield* Effect.forEach(
							allEnemies(),
							enemy => Effect.map(Machine.encodeSnapshot(Creatures, enemy.task), task => ({...enemy, task})),
							{concurrency: 1}
						),
						mobs: yield* Effect.forEach(
							Array.sort(Array.fromIterable(MutableHashMap.values(mobs)), byId),
							mob => Effect.map(Machine.encodeSnapshot(Creatures, mob.task), task => ({...mob, task})),
							{concurrency: 1}
						),
						units: yield* Effect.forEach(
							allUnits(),
							unit => Effect.map(Machine.encodeSnapshot(Tasks, unit.task), task => ({...unit, task})),
							{concurrency: 1}
						)
					}
					return {
						amounts: Array.map(
							Array.fromIterable(amounts),
							entry => [tileOf(entry[0]).x, tileOf(entry[0]).z, entry[1]] satisfies [number, number, number]
						),
						buildings: saving.buildings,
						cleared: Array.sort(Array.fromIterable(cleared), Order.Number),
						draws: state.draws,
						edits: Array.map(Array.fromIterable(edits), entry => ({edit: entry[1], ...tileOf(entry[0])})),
						enemies: saving.enemies,
						generator: GENERATOR,
						jams: Array.fromIterable(jams),
						life: {
							...life.snapshot(),
							individuals: Array.map(life.snapshot().individuals, individual => ({
								...individual,
								explored: Array.map(Array.fromIterable(exploredOf(-individual.id)), entry => ({
									bits: Uint8Array.from(entry[1].bits),
									...chunkFrom(entry[0])
								}))
							}))
						},
						mobs: saving.mobs,
						nextId: state.nextId,
						patches: Array.fromIterable(patches),
						pendingExperiences: life.drain(),
						pipes: Array.getSomes(
							Array.map(pipes.nets, net =>
								Option.zipWith(
									Option.filter(net.fluid, () => net.stock > 0),
									Array.head(net.pipes),
									(fluid, conduit) => [conduit, fluid, net.stock] satisfies [number, ItemId, number]
								)
							)
						),
						rules: SIMULATION,
						seed,
						sides: Array.map(
							Array.fromIterable(sides),
							entry => [entry[0], entry[1].side, entry[1].way] satisfies [number, number, Point]
						),
						stalls: Array.map(
							Array.fromIterable(stalls),
							entry => [entry[0], entry[1].best, entry[1].since, entry[1].to] satisfies [number, number, number, Point]
						),
						teams: Array.map(allTeams(), team => ({
							...team,
							explored: Array.map(Array.fromIterable(exploredOf(team.id)), entry => ({
								bits: Uint8Array.from(entry[1].bits),
								...chunkFrom(entry[0])
							}))
						})),
						tick: state.tick,
						units: saving.units,
						visited: Array.fromIterable(visited),
						wildId: state.wildId
					} satisfies Saved
				}),
				cause => GameError.make({cause, message: 'The world could not be saved.'})
			),
			teams: () => Array.map(allTeams(), team => team.id),
			tick: () => state.tick,
			units: () => Array.map(allUnits(), unitView)
		}
	},
	Effect.mapError(cause => GameError.make({cause, message: 'The world could not be made.'}))
)
