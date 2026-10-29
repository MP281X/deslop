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
	Tuple
} from 'effect'
import type {Types} from 'effect'

import {Machine} from '@typeonce/effect-machine'

import {route} from '#services/game/lib/path.ts'
import {START_STATES, Sites, Tasks} from '#services/game/lib/tasks.ts'
import type {Site, SiteEvent, Task, TaskEvent} from '#services/game/lib/tasks.ts'
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
	ROUND,
	START,
	START_SIGHT,
	STRUCTURES,
	TEAMS,
	TICK,
	TIMBER,
	UNITS,
	WILDLIFE,
	bearing,
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
	Explored,
	Job,
	Mark,
	MobKind,
	Outcome,
	Point,
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
// Seconds between raids at the least; raids come only for units this far from their Home.
const RAID_EVERY = 240
const RAID_DISTANCE = 16
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

// A unit and a building as the world runs them: their step and construction as machine snapshots, encoded only in a save.
type Unit = Types.Mutable<Omit<SavedUnit, 'task'>> & {task: Task}
type Building = Types.Mutable<Omit<SavedBuilding, 'site'>> & {site: Site}
type Team = Types.Mutable<Omit<SavedTeam, 'explored'>>
type Enemy = Types.Mutable<SavedEnemy>
type Mob = Types.Mutable<SavedMob>
type Kind = BuildingKind | StructureKind
type Bits = {bits: Uint8Array; version: number}
type Plan = {job: Option.Option<Job>; reason: string}
// A body in the crowd grid: where it is, what it is, its place in the listing and whether it blocks now.
type Body = {
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

function angleTo(from: Point, to: Point) {
	return Math.atan2(to.x - from.x, to.z - from.z)
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

// A point some tiles to one side of the line from one point to another, square to it.
function aside(from: Point, to: Point, side: number) {
	const gap = distance(from, to)
	return {x: from.x + ((to.z - from.z) / gap) * side, z: from.z - ((to.x - from.x) / gap) * side}
}

// How far a pole wires to the next and powers buildings round it.
function reachOf(pole: Building) {
	if (pole.kind === 'pylon') return POLES.pylon
	return POLES.pole
}

// Where a unit stands to work at a building: by its edge.
function beside(building: Option.Option<Building>) {
	return Option.map(building, entry => ({
		near: Number.max(sizeOf(entry.kind).w, sizeOf(entry.kind).d) / 2 + 0.9,
		to: centreOf(entry)
	}))
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

// A Home queue's state: working, waiting for what it lacks, or idle.
function queueText(progress: number, queued: boolean, lacking: string) {
	if (progress >= 0) return ' (working)'
	if (queued) return ` (waiting for ${lacking} at Home)`
	return ''
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
		alarm: -99,
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
		timer: 0,
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
		incoming: {},
		kind,
		output: {},
		progress: -1,
		reserved: {},
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
		const spawns = world.spawns()
		const state = {draws: 0, nextId: 1, raidAt: 360, searches: 0, tick: 0, wildId: 1_000_000_000}
		const units = MutableHashMap.empty<number, Unit>()
		const buildings = MutableHashMap.empty<number, Building>()
		const teams = MutableList.make<Team>()
		const enemies = MutableHashMap.empty<number, Enemy>()
		const mobs = MutableHashMap.empty<number, Mob>()
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
		const clearing = MutableHashMap.empty<number, number>()
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
			MutableHashMap.remove(clearing, id)
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

		function allUnits() {
			return Array.sort(Array.fromIterable(MutableHashMap.values(units)), byId)
		}

		function allBuildings() {
			return Array.sort(Array.fromIterable(MutableHashMap.values(buildings)), byId)
		}

		function allEnemies() {
			return Array.sort(Array.fromIterable(MutableHashMap.values(enemies)), byId)
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

		function threatNear(point: Point, radius: number, include: (enemy: Enemy) => boolean = () => true) {
			return Option.map(
				Array.head(
					Array.sort(
						Array.map(
							Array.filter(
								allEnemies(),
								enemy => enemy.dead === 0 && distance(enemy, point) <= radius && include(enemy)
							),
							enemy => ({distance: distance(enemy, point), enemy})
						),
						byDistance
					)
				),
				entry => entry.enemy
			)
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
		const crowd: {cells: Record<string, Body[]>; tick: number} = {cells: {}, tick: -1}

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
						...Array.map(allEnemies(), enemy => ({at: enemy, kind: enemy.kind, solid: () => enemy.dead === 0})),
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
				(body: Body) => {
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
			const stall = Option.getOrUndefined(
				Option.filter(MutableHashMap.get(stalls, id), entry => distance(entry.to, to) < 0.5 && entry.best - gap < 0.3)
			)
			if (stall === undefined) MutableHashMap.set(stalls, id, {best: gap, since: clock(), to})
			if (stall !== undefined && clock() - stall.since > 4) {
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

		// A point within a radius of another, by the world's dice.
		function roundAbout(at: Point, radius: number) {
			const angle = random() * Math.PI * 2
			const far = radius * Math.sqrt(random())
			return {x: at.x + Math.sin(angle) * far, z: at.z + Math.cos(angle) * far}
		}

		/* ───────── raids, roamers and guards ───────── */

		function biomeAt(at: Point) {
			const tile = chunkOf(Math.floor(at.x), Math.floor(at.z))
			return chunkAt(tile.cx, tile.cz).biome[tile.index] ?? 0
		}

		function spawnEnemy(kind: EnemyKind, patch: number, at: Point, target: number) {
			const id = nextId()
			MutableHashMap.set(enemies, id, {
				act: 'move',
				dead: 0,
				doing: 'hunting',
				health: 60,
				id,
				kind,
				patch,
				spot: at,
				target,
				timer: 0,
				x: at.x,
				yaw: random() * Math.PI * 2,
				z: at.z
			})
			return id
		}

		function ambush(prey: Unit) {
			const kind = ENEMIES[biomeAt(prey)] ?? 'glitch'
			const turn = random()
			Option.match(
				Array.findFirst(
					Array.map(Array.range(0, 15), n => {
						const angle = ((n + turn) / 16) * Math.PI * 2
						return {
							x: Math.floor(prey.x + Math.sin(angle) * 13) + 0.5,
							z: Math.floor(prey.z + Math.cos(angle) * 13) + 0.5
						}
					}),
					spot =>
						standable(MOVERS.legs, ground(Math.floor(spot.x), Math.floor(spot.z))) &&
						Array.every(homes(), home => distance(spot, home) > RAID_DISTANCE - 4)
				),
				{
					onNone: () => undefined,
					onSome: spot => {
						spawnEnemy(kind, -1, spot, prey.id)
						notify(
							prey.team,
							`A ${kind} is hunting ${unitName(prey)} at (${Math.floor(prey.x)}, ${Math.floor(prey.z)}).`
						)
					}
				}
			)
		}

		// A hostile of the prey's biome comes for a unit far from its Home, a hauler first; a team is left alone until it has paid its first tier.
		function raid() {
			const exposed = Array.filter(
				allUnits(),
				unit =>
					moverOf(unit) !== 'fly' &&
					unit.health > 0 &&
					distance(unit, homeAt(unit.team)) > RAID_DISTANCE &&
					Option.exists(Option.fromUndefinedOr(teamOf(unit.team)), team => Array.isReadonlyArrayNonEmpty(team.gates))
			)
			Option.match(
				Option.orElse(
					Array.findFirst(exposed, unit => unit.class === 'hauler'),
					() => Array.get(exposed, Math.floor(random() * exposed.length))
				),
				{onNone: () => undefined, onSome: ambush}
			)
		}

		// A roamer with no prey wanders round its spot and goes for the nearest unit on the ground within 7 tiles; a prey led more than 22 tiles from its spot is let go.
		function roam(id: number) {
			const enemy = Option.getOrUndefined(MutableHashMap.get(enemies, id))
			if (enemy === undefined) return undefined
			const prey = Option.getOrUndefined(
				Option.filter(MutableHashMap.get(units, enemy.target), unit => unit.health > 0)
			)
			if (prey !== undefined && distance(prey, enemy.spot) < 22) return prey
			enemy.target = 0
			Option.match(
				Array.head(
					Array.sort(
						Array.map(
							Array.filter(
								allUnits(),
								unit => unit.health > 0 && moverOf(unit) !== 'fly' && distance(unit, enemy) <= 7
							),
							unit => ({distance: distance(unit, enemy), unit})
						),
						byDistance
					)
				),
				{
					onNone: () => {
						enemy.doing = 'prowling'
						if (stride(enemy.id, enemy.spot, 0.6)) return
						enemy.act = 'idle'
						enemy.timer += TICK
						// Every few seconds it sets off for another spot in its patch.
						if (enemy.timer > 4 + 5 * random()) {
							enemy.spot = roundAbout(patchCentre(enemy.patch), 6)
							enemy.timer = 0
						}
					},
					onSome: entry => {
						enemy.target = entry.unit.id
						enemy.doing = 'hunting'
					}
				}
			)
			return undefined
		}

		function preyOf(enemy: Enemy) {
			if (enemy.patch >= 0) return roam(enemy.id)
			return Option.getOrUndefined(Option.filter(MutableHashMap.get(units, enemy.target), unit => unit.health > 0))
		}

		function hunt(id: number) {
			const enemy = Option.getOrUndefined(MutableHashMap.get(enemies, id))
			if (enemy === undefined) return
			if (enemy.dead > 0) {
				enemy.act = 'die'
				if (clock() - enemy.dead > 3) MutableHashMap.remove(enemies, enemy.id)
				return
			}
			const prey = preyOf(enemy)
			if (enemy.patch >= 0 && prey === undefined) return
			// Once its prey is down a raider slinks off, away from the prey's Home, and is gone a little later.
			if (prey === undefined) {
				enemy.timer += TICK
				enemy.doing = 'leaving'
				const away = homeAt(
					Option.getOrElse(
						Option.map(MutableHashMap.get(units, enemy.target), unit => unit.team),
						() => 0
					)
				)
				stride(enemy.id, {x: enemy.x * 2 - away.x, z: enemy.z * 2 - away.z}, 1.05)
				if (enemy.timer > 20) MutableHashMap.remove(enemies, enemy.id)
				return
			}
			if (distance(enemy, prey) > 1.1) {
				stride(enemy.id, prey, 1.05)
				return
			}
			enemy.yaw = faced(enemy.yaw, {x: prey.x - enemy.x, z: prey.z - enemy.z})
			enemy.act = 'attack'
			enemy.timer += TICK
			if (enemy.timer < 1.5) return
			enemy.timer = 0
			prey.health = Number.max(0, prey.health - 6)
			if (clock() - prey.alarm > 10) notify(prey.team, `${unitName(prey)} is under attack by a ${enemy.kind}.`)
			prey.alarm = clock()
			if (prey.health === 0) {
				notify(prey.team, `${unitName(prey)} is down and needs a Builder to repair it.`)
				mark('down', prey.team)
			}
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

		// A guard that sees a hostile within 14 tiles (or, holding nothing, anything hunting within 40 of its Home) drives into range, turns its turret and fires; true while it is busy with one.
		function engaged(id: number) {
			const guard = unitOf(id)
			if (guard === undefined) return false
			const foe = Option.getOrUndefined(
				Option.orElse(threatNear(guard, 14), () =>
					Option.filter(
						threatNear(homeAt(guard.team), 40, enemy => enemy.target !== 0),
						() => guard.order._tag === 'Auto'
					)
				)
			)
			if (foe === undefined) return false
			guard.aim = angleTo(guard, foe) - guard.yaw
			if (distance(guard, foe) > 4.5) {
				guard.doing = `chasing a ${foe.kind}`
				goTo(id, foe, 3)
				return true
			}
			// A ground gun fires only along a clear line: with a body or a trunk in the way it steps aside to the nearer side that clears, or closes in.
			if (moverOf(guard) !== 'fly' && !clearShot(guard, foe)) {
				guard.doing = `moving for a clear shot at a ${foe.kind}`
				Option.match(
					Array.findFirst([1.4, -1.4, 2.6, -2.6], side => clearShot({id: guard.id, ...aside(guard, foe, side)}, foe)),
					{onNone: () => goTo(id, foe, 1.5), onSome: side => goTo(id, aside(guard, foe, side), 0)}
				)
				return true
			}
			guard.doing = `firing at a ${foe.kind}`
			guard.act = 'work'
			guard.timer += TICK
			if (guard.timer < 0.8) return true
			guard.timer = 0
			foe.health -= 6 * (markOf(guard).damage ?? 1)
			MutableList.append(shots, {from: guard.id, to: foe.id})
			if (foe.health <= 0) {
				foe.dead = clock()
				foe.doing = 'down'
				notify(guard.team, `${unitName(guard)} stopped a ${foe.kind}.`)
			}
			return true
		}

		// Home's gun fires at the nearest hostile within 9 tiles, so a unit that runs Home is safe there.
		function defend(team: number) {
			const home = homeOf(team)
			if (home === undefined) return
			const foe = Option.getOrUndefined(threatNear(centreOf(home), 9))
			if (foe === undefined) return
			foe.health -= 6
			MutableList.append(shots, {from: home.id, to: foe.id})
			if (foe.health > 0) return
			foe.dead = clock()
			foe.doing = 'down'
			notify(team, `Home's gun stopped a ${foe.kind}.`)
		}

		// An attacked unit drops what it was doing and runs to the nearest guard of its team, or Home.
		function flee(id: number) {
			const unit = unitOf(id)
			if (unit === undefined) return
			const refuge = Option.match(
				Array.head(
					Array.sort(
						Array.map(
							Array.filter(unitsOf(unit.team), other => other.class === 'guard' && other.health > 0),
							other => ({distance: distance(other, unit), unit: other})
						),
						byDistance
					)
				),
				{
					onNone: () => ({near: 2.5, to: homeAt(unit.team)}),
					onSome: entry => ({near: 1, to: {x: entry.unit.x, z: entry.unit.z}})
				}
			)
			unit.doing = 'fleeing an attack'
			goTo(id, refuge.to, refuge.near)
			unit.act = 'alarm'
		}

		// Hurt units go Home to be patched up: a working one only once badly hurt, a waiting one near Home until whole.
		function repairing(id: number) {
			const unit = unitOf(id)
			if (unit === undefined) return false
			const full = markOf(unit).health
			const home = homeAt(unit.team)
			const topUp = distance(unit, home) < 4 && unit.health < full && unit.order._tag === 'Auto'
			// Below 55% of its health a unit leaves its work.
			if (unit.health >= full * 0.55 && !topUp) return false
			unit.doing = 'going Home for repairs'
			if (!goTo(id, home, 2.5)) return true
			unit.doing = 'being repaired at Home'
			unit.health = Number.min(full, unit.health + 8 * TICK)
			return true
		}

		/* ───────── wildlife: creatures and roaming hostiles in patches round the teams' units ───────── */

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

		function spawnMob(kind: MobKind, key: number, at: Point) {
			state.wildId += 1
			MutableHashMap.set(mobs, state.wildId, {
				act: 'idle',
				doing: CREATURES[kind].rest,
				from: at,
				id: state.wildId,
				kind,
				patch: key,
				scared: -99,
				spot: at,
				timer: 2 + random() * 6,
				x: at.x,
				// A group stands side by side, facing much the same way.
				yaw: (random() - 0.5) * 0.6,
				z: at.z
			})
			return state.wildId
		}

		// What lives in a patch: its biome's groups by their chances, and now and then a pair of hostiles away from every Home.
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
							spawnMob(row.kind, key, {x: at.x + (q - 1) * 0.9, z: at.z + ((q * 7) % 3) * 0.2})
						)
				})
			})
			// Hostiles roam only more than 28 tiles from every Home.
			const hostile = Array.every(homes(), home => distance(centre, home) > 28) && hash(seed + 199, px, pz) < 0.12
			const roamers = Option.match(
				Option.filter(spotIn(key, 9, 'grazer'), () => hostile),
				{
					onNone: () => [],
					onSome: at =>
						Array.map(Array.range(1, 1 + Math.floor(hash(seed + 211, px, pz) * 2)), q =>
							spawnEnemy(ENEMIES[biome] ?? 'glitch', key, {x: at.x + q * 0.8, z: at.z}, 0)
						)
				}
			)
			MutableHashMap.set(patches, key, [...groups, ...roamers])
		}

		// Whether no body has an id any more.
		function gone(id: number) {
			return !MutableHashMap.has(units, id) && !MutableHashMap.has(enemies, id) && !MutableHashMap.has(mobs, id)
		}

		// Once a second: patches within reach of a unit come alive, patches no unit is within 80 tiles of any more are cleared, hostiles in a fight excepted.
		function wildlife() {
			const alive = Array.filter(allUnits(), unit => unit.health > 0)
			for (const key of Array.dedupe(Array.flatMap(alive, patchesNear))) {
				if (!MutableHashMap.has(patches, key)) populate(key)
			}
			const forgotten = Array.filter(Array.fromIterable(patches), entry =>
				Array.every(alive, unit => distance(unit, patchCentre(entry[0])) > 80)
			)
			for (const entry of forgotten) {
				for (const id of entry[1]) MutableHashMap.remove(mobs, id)
				for (const id of Array.filter(entry[1], member =>
					Option.exists(MutableHashMap.get(enemies, member), enemy => enemy.target === 0)
				)) {
					MutableHashMap.remove(enemies, id)
				}
				MutableHashMap.remove(patches, entry[0])
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
			mob.yaw = angleTo(mob, to)
			mob.x += ((to.x - mob.x) / gap) * speed * TICK
			mob.z += ((to.z - mob.z) / gap) * speed * TICK
			return false
		}

		// A creature at rest a while, then off to another spot round `around` within `radius`, or on its way to one.
		function rest(id: number, around: Point, radius: number, pause: {least: number; more: number}) {
			const mob = mobOf(id)
			if (mob === undefined) return
			mob.act = 'idle'
			mob.doing = CREATURES[mob.kind].rest
			mob.timer -= TICK
			if (mob.timer > 0) return
			mob.timer = pause.least + random() * pause.more
			mob.target = Option.getOrUndefined(
				Option.filter(Option.some(roundAbout(around, radius)), at =>
					habitable(mob.kind, Math.floor(at.x), Math.floor(at.z))
				)
			)
		}

		// A flier sits, and now and then moves on to another spot of its patch.
		function fly(id: number) {
			const mob = mobOf(id)
			if (mob === undefined) return
			if (mob.target === undefined) {
				rest(id, patchCentre(mob.patch), 7, {least: 15, more: 25})
				return
			}
			mob.doing = 'flying'
			if (glide(id, mob.target, CREATURES[mob.kind].flee)) mob.target = undefined
		}

		function wander(id: number) {
			const mob = mobOf(id)
			if (mob === undefined) return
			if (mob.target === undefined) {
				rest(id, mob.spot, 5, {least: 3, more: 6})
				return
			}
			mob.doing = 'wandering'
			if (!stride(id, mob.target, CREATURES[mob.kind].walk)) mob.target = undefined
		}

		// A creature bolts for a few seconds from the nearest unit or hostile within 3.5 tiles (a flier to another spot), then goes back to its life.
		function creature(id: number) {
			const mob = mobOf(id)
			if (mob === undefined) return
			const life = CREATURES[mob.kind]
			if (life.life === 'swarm' || life.life === 'fish') {
				mob.act = 'idle'
				return
			}
			const threat = Option.getOrUndefined(
				Array.head(
					Array.sort(
						Array.filter(
							Array.map(
								Array.filter(
									crowdNear(mob),
									body =>
										MutableHashMap.has(units, body.at.id) ||
										Option.exists(MutableHashMap.get(enemies, body.at.id), enemy => enemy.dead === 0)
								),
								body => ({at: {x: body.at.x, z: body.at.z}, distance: distance(body.at, mob)})
							),
							entry => entry.distance <= 3.5
						),
						byDistance
					)
				)
			)
			if (threat !== undefined) {
				if (clock() - mob.scared > 2.5 && life.life === 'flier') {
					const away = awayOf(threat.at, mob)
					mob.target = {x: mob.x + away.x * 10, z: mob.z + away.z * 10}
				}
				mob.scared = clock()
				mob.from = threat.at
			}
			if (life.life === 'flier') {
				fly(id)
				return
			}
			if (clock() - mob.scared < 2.5) {
				const away = awayOf(mob.from, mob)
				mob.target = undefined
				mob.doing = 'running off'
				stride(id, {x: mob.x + away.x * 2, z: mob.z + away.z * 2}, life.flee)
				mob.act = 'alarm'
				return
			}
			wander(id)
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

		// Whether any team has explored the tile under a point: what lies there is drawn, so whatever walks there shows too.
		function knownAny(at: Point) {
			const tile = chunkOf(Math.floor(at.x), Math.floor(at.z))
			return Option.exists(
				MutableHashMap.get(seen, chunkKey(tile.cx, tile.cz)),
				entry => ((entry.bits[tile.index >> 3] ?? 0) & (1 << (tile.index & 7))) !== 0
			)
		}

		// Whether a team's Home or units see a point now.
		function sighted(team: number, at: Point) {
			return (
				distance(homeAt(team), at) <= HOME_SIGHT ||
				Array.some(unitsOf(team), unit => unit.health > 0 && distance(unit, at) <= markOf(unit).sight + 1)
			)
		}

		// Two teams meet when one's units see the other's units or buildings; from then on each knows the other and they may write.
		function contacts() {
			for (const first of allTeams()) {
				for (const second of Array.filter(
					allTeams(),
					other => other.id > first.id && !Array.contains(first.contacts, other.id)
				)) {
					const met = Option.getOrUndefined(
						Option.orElse(
							Array.findFirst([...unitsOf(second.id), ...Array.map(buildingsOf(second.id), centreOf)], at =>
								sighted(first.id, at)
							),
							() =>
								Array.findFirst([...unitsOf(first.id), ...Array.map(buildingsOf(first.id), centreOf)], at =>
									sighted(second.id, at)
								)
						)
					)
					if (met !== undefined) {
						first.contacts = [...first.contacts, second.id]
						second.contacts = [...second.contacts, first.id]
						revision.teams += 1
						notify(
							first.id,
							`Contact: you met team ${second.id} (${nameOf(second.id)}) at ${place2(met)}. You may now message them.`
						)
						notify(
							second.id,
							`Contact: you met team ${first.id} (${nameOf(first.id)}) at ${place2(met)}. You may now message them.`
						)
						mark('contact', first.id, Option.some(second.id))
					}
				}
			}
		}

		// Twice a second every unit that moved half a tile looks round it as far as it sees, and marks the chunk it is in.
		function explore() {
			revision.explored += 1
			for (const unit of Array.filter(allUnits(), entry => distance(entry, entry.sighted) >= 0.5)) {
				unit.sighted = {x: unit.x, z: unit.z}
				lookRound(unit.team, unit, markOf(unit).sight)
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

		// How many of an item can be taken out of a building: a store's stock but what is set aside, anything else's output.
		function availableIn(building: Building, item: ItemId) {
			if (!complete(building)) return 0
			if (Schema.is(BuildingKind)(building.kind) && Array.contains(STORES, building.kind)) {
				return Number.max(0, countOf(building.stock, item) - countOf(building.reserved, item))
			}
			return countOf(building.output, item)
		}

		// Moves a count of an item in or out of one of a building's tallies.
		function adjust(id: number, tally: 'incoming' | 'output' | 'reserved' | 'stock', item: ItemId, by: number) {
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

		function storesOf(team: number) {
			return Array.filter(
				buildingsOf(team),
				building =>
					Schema.is(BuildingKind)(building.kind) && Array.contains(STORES, building.kind) && complete(building)
			)
		}

		function nearestBuilding(from: Point, among: Building[]) {
			return Option.map(
				nearest(
					from,
					Array.map(among, building => ({...centreOf(building), building}))
				),
				entry => entry.building
			)
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
			if (unit.claim !== undefined) {
				adjust(unit.claim.site, 'incoming', unit.claim.item, -unit.claim.count)
				if (unit.claim.from !== undefined) adjust(unit.claim.from, 'reserved', unit.claim.item, -unit.claim.count)
			}
			unit.claim = undefined
			for (const entry of Array.filter(Array.fromIterable(clearing), pair => pair[1] === id)) {
				MutableHashMap.remove(clearing, entry[0])
			}
		}

		// Its cargo into the nearest store that takes it.
		function unload(unit: Unit) {
			const item = Option.getOrUndefined(Array.head(itemsIn(unit.cargo)))
			if (item === undefined) return wait('nothing to unload')
			return Option.match(
				nearestBuilding(
					unit,
					Array.filter(storesOf(unit.team), store => roomFor(store, item) > 0)
				),
				{
					onNone: () => wait(`no store has room for ${item}`),
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

		// What a site still lacks that nobody is bringing.
		function lacking(site: Building) {
			const cost = costOf(site.kind)
			return Array.filter(
				Array.map(itemsIn(cost), item => ({
					count: countOf(cost, item) - countOf(site.stock, item) - countOf(site.incoming, item),
					item
				})),
				entry => entry.count > 0
			)
		}

		// A Builder with nothing ordered keeps the team's sites going: it brings back what it carries, repairs a teammate that is down, clears a site's footprint, brings a site what it lacks from a store, and builds a site whose items are all there; else it waits by Home.
		function construct(id: number) {
			const unit = unitOf(id)
			if (unit === undefined) return wait('gone')
			const carried = Option.getOrUndefined(
				Option.flatMap(Option.fromUndefinedOr(unit.claim), claim =>
					Option.filter(Option.fromUndefinedOr(buildingOf(claim.site)), site => !complete(site))
				)
			)
			if (carried !== undefined && cargoOf(unit) > 0) return job({_tag: 'Dropoff', building: carried.id})
			if (cargoOf(unit) > 0) return unload(unit)
			const down = Option.getOrUndefined(
				nearest(
					unit,
					Array.filter(unitsOf(unit.team), other => other.health <= 0 && distance(other, unit) < 60)
				)
			)
			if (down !== undefined) return job({_tag: 'Repair', unit: down.id})
			const open = Array.map(
				Array.sort(
					Array.map(
						Array.filter(buildingsOf(unit.team), building => !complete(building)),
						site => ({distance: distance(centreOf(site), unit), site})
					),
					byDistance
				),
				entry => entry.site
			)
			const prop = Option.getOrUndefined(
				Array.findFirst(
					Array.flatMap(
						Array.filter(open, (site: Building) => Sites.root.matches(site.site, 'Clearing')),
						propsOn
					),
					entry =>
						Option.match(MutableHashMap.get(clearing, entry.id), {onNone: () => true, onSome: holder => holder === id})
				)
			)
			if (prop !== undefined) {
				MutableHashMap.set(clearing, prop.id, id)
				return job({_tag: 'Clear', prop: prop.id, x: prop.x, z: prop.z})
			}
			const supply = Option.getOrUndefined(
				Array.findFirst(
					Array.flatMap(
						Array.filter(open, site => Sites.root.matches(site.site, 'Supplying')),
						(site: Building) => Array.map(lacking(site), need => ({need, site}))
					),
					entry =>
						Option.map(
							nearestBuilding(
								centreOf(entry.site),
								Array.filter(storesOf(unit.team), store => availableIn(store, entry.need.item) > 0)
							),
							store => ({...entry, store})
						)
				)
			)
			if (supply !== undefined) {
				const count = Number.min(
					Number.min(supply.need.count, markOf(unit).cargo),
					availableIn(supply.store, supply.need.item)
				)
				adjust(supply.site.id, 'incoming', supply.need.item, count)
				adjust(supply.store.id, 'reserved', supply.need.item, count)
				unit.claim = {count, from: supply.store.id, item: supply.need.item, site: supply.site.id}
				return job({_tag: 'Pickup', building: supply.store.id, count, item: supply.need.item})
			}
			return Option.match(
				Array.findFirst(open, site => Sites.root.matches(site.site, 'Constructing')),
				{onNone: () => park(unit), onSome: site => job({_tag: 'Construct', site: site.id})}
			)
		}

		// The nearest thing a Builder digs or clears for an item round a place: ore on a field tile, a tree for wood, a rock or a stone tile for stone.
		function gatherAt(unit: Unit, item: ItemId, at: Point) {
			const prop = Option.getOrUndefined(
				nearest(
					unit,
					Array.filter(
						propsNear(at, NEAR),
						entry =>
							Array.contains(clearedFor(item), entry.kind) &&
							Option.match(MutableHashMap.get(clearing, entry.id), {
								onNone: () => true,
								onSome: holder => holder === unit.id
							})
					)
				)
			)
			if (prop !== undefined) {
				MutableHashMap.set(clearing, prop.id, unit.id)
				return job({_tag: 'Clear', prop: prop.id, x: prop.x, z: prop.z})
			}
			const tiles = Array.filter(
				Array.flatMap(Array.range(-NEAR, NEAR), dz =>
					Array.map(Array.range(-NEAR, NEAR), dx => ({x: Math.floor(at.x) + dx, z: Math.floor(at.z) + dz}))
				),
				tile =>
					Option.exists(materialAt(tile.x, tile.z), material => ORE_ITEM[material] === item) &&
					known(unit.team, tile) &&
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
			const from = buildingOf(order.from)
			const to = buildingOf(order.to)
			if (from === undefined || to === undefined) return wait('a stop of the haul is gone')
			if (cargoOf(unit) > 0) {
				if (Array.some(itemsIn(unit.cargo), item => roomFor(to, item) > 0)) {
					return job({_tag: 'Dropoff', building: to.id})
				}
				return wait(`${buildingName(to)} is full`)
			}
			const item = Option.orElse(Option.fromUndefinedOr(order.item), () =>
				Array.findFirst(
					itemsIn({...from.output, ...from.stock}),
					entry => availableIn(from, entry) > 0 && roomFor(to, entry) > 0
				)
			)
			return Option.match(
				Option.filter(item, entry => availableIn(from, entry) > 0 && roomFor(to, entry) > 0),
				{
					onNone: () =>
						Option.match(
							Option.filter(item, entry => availableIn(from, entry) > 0),
							{
								onNone: () => wait(`nothing at ${buildingName(from)} that ${buildingName(to)} takes`),
								onSome: entry => wait(`${buildingName(to)} has no room for more ${entry}`)
							}
						),
					onSome: entry =>
						job({
							_tag: 'Pickup',
							building: from.id,
							count: Array.reduce(
								[availableIn(from, entry), roomFor(to, entry), order.count ?? Infinity],
								spaceOf(unit),
								(least, value) => Number.min(least, value)
							),
							item: entry
						})
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
				at => !known(unit.team, at) && standable(mover, ground(Math.floor(at.x), Math.floor(at.z)))
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
			if (unit.order._tag === 'Gather') return gather(unit, unit.order)
			if (unit.order._tag === 'Haul') return haul(unit, unit.order)
			if (cargoOf(unit) > 0 && unit.class !== 'builder') return unload(unit)
			if (unit.order._tag === 'Explore') {
				return Option.match(frontier(unit), {
					onNone: () => wait('nothing unseen in reach'),
					onSome: to => job({_tag: 'Scout', x: to.x, z: to.z})
				})
			}
			if (unit.order._tag === 'Go' || unit.order._tag === 'Guard') {
				return job({_tag: 'Hold', x: unit.order.x + 0.5, z: unit.order.z + 0.5})
			}
			if (unit.class === 'builder') return construct(unit.id)
			return park(unit)
		}

		// Where a step takes a unit, and how near it must get.
		function targetOf(unit: Unit, step: Job) {
			if (step._tag === 'Pickup' || step._tag === 'Dropoff') return beside(MutableHashMap.get(buildings, step.building))
			if (step._tag === 'Construct') return beside(MutableHashMap.get(buildings, step.site))
			if (step._tag === 'Clear') return Option.some({near: 0.9, to: {x: step.x, z: step.z}})
			if (step._tag === 'Gather') return Option.some({near: 0.4, to: {x: step.x + 0.5, z: step.z + 0.5}})
			if (step._tag === 'Repair') {
				return Option.map(Option.fromUndefinedOr(unitOf(step.unit)), other => ({near: 1, to: {x: other.x, z: other.z}}))
			}
			if (step._tag === 'Refit') return Option.some({near: 2.5, to: homeAt(unit.team)})
			if (step._tag === 'Scout') return Option.some({near: 1, to: {x: step.x, z: step.z}})
			return Option.some({near: 0, to: {x: step.x, z: step.z}})
		}

		// Whether a step can still be done: what it goes for is still there.
		function valid(unit: Unit, step: Job) {
			if (step._tag === 'Pickup') {
				return Option.exists(
					Option.fromUndefinedOr(buildingOf(step.building)),
					building => countOf({...building.output, ...building.stock}, step.item) > 0
				)
			}
			if (step._tag === 'Dropoff') return buildingOf(step.building) !== undefined
			if (step._tag === 'Construct') {
				return Option.exists(Option.fromUndefinedOr(buildingOf(step.site)), site =>
					Sites.root.matches(site.site, 'Constructing')
				)
			}
			if (step._tag === 'Clear') return !MutableHashSet.has(cleared, step.prop)
			if (step._tag === 'Gather') return Option.isSome(materialAt(step.x, step.z))
			if (step._tag === 'Repair') {
				return Option.exists(Option.fromUndefinedOr(unitOf(step.unit)), other => other.health <= 0)
			}
			if (step._tag === 'Refit') return unit.upgrade
			return true
		}

		// How long a step takes once there.
		function secondsOf(unit: Unit, step: Job) {
			const rates = markOf(unit)
			if (step._tag === 'Pickup' || step._tag === 'Dropoff') return 0.6
			if (step._tag === 'Construct') return 1
			if (
				step._tag === 'Clear' &&
				Array.some(
					propsNear({x: step.x, z: step.z}, 0.5),
					entry => entry.id === step.prop && Array.contains(BOULDERS, entry.kind)
				)
			) {
				return rates.clear?.rock ?? 12
			}
			if (step._tag === 'Clear') return rates.clear?.tree ?? 6
			if (step._tag === 'Gather') return rates.gather ?? 2
			if (step._tag === 'Repair') return 6
			if (step._tag === 'Hold' && unit.order._tag === 'Auto') return 2
			if (step._tag === 'Hold') return 5
			return 0
		}

		function describe(unit: Unit, step: Job) {
			if (step._tag === 'Pickup') return `fetching ${step.count} ${step.item} from #${step.building}`
			if (step._tag === 'Dropoff') return `bringing ${itemsText(unit.cargo)} to #${step.building}`
			if (step._tag === 'Construct') return `building #${step.site}`
			if (step._tag === 'Clear') return 'clearing a tree or rock'
			if (step._tag === 'Gather') return `digging ${step.item}`
			if (step._tag === 'Repair') return `repairing #${step.unit}`
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
			site.stock = {}
			site.incoming = {}
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
			notify(site.team, `${buildingName(site)} at (${site.x}, ${site.z}) is built.`)
		}

		// A finished pickup: the items move into the cargo bed, and a claim on them shrinks to what came.
		function pickedUp(id: number, step: Extract<Job, {_tag: 'Pickup'}>) {
			const unit = unitOf(id)
			if (unit === undefined) return
			const got = take(step.building, step.item, Number.min(step.count, spaceOf(unit)))
			unit.cargo = withItem(unit.cargo, step.item, got)
			if (unit.claim !== undefined && unit.claim.from === step.building && buildingOf(step.building) !== undefined) {
				adjust(step.building, 'reserved', unit.claim.item, -unit.claim.count)
				adjust(unit.claim.site, 'incoming', unit.claim.item, got - unit.claim.count)
				unit.claim = {count: got, item: unit.claim.item, site: unit.claim.site}
			}
		}

		// A finished dropoff: the cargo goes in, a claim delivered there ends, and a counted haul counts down.
		function droppedOff(id: number, building: number) {
			const unit = unitOf(id)
			if (unit === undefined || buildingOf(building) === undefined) return
			const delivered = Array.reduce(itemsIn(unit.cargo), 0, (sum, item) => {
				const given = put(building, item, countOf(unit.cargo, item))
				unit.cargo = withItem(unit.cargo, item, -given)
				return sum + given
			})
			if (unit.claim !== undefined && unit.claim.site === building) {
				adjust(building, 'incoming', unit.claim.item, -unit.claim.count)
				unit.claim = undefined
			}
			if (unit.order._tag === 'Haul' && unit.order.count !== undefined) {
				const left = unit.order.count - delivered
				unit.order = {...unit.order, count: left}
				if (left <= 0) unit.order = {_tag: 'Auto'}
			}
		}

		// A finished clearing: the prop goes, and its wood or stone fills the cargo bed.
		function clearedBy(id: number, step: Extract<Job, {_tag: 'Clear'}>) {
			const unit = unitOf(id)
			const prop = Option.getOrUndefined(
				Array.findFirst(propsNear({x: step.x, z: step.z}, 0.5), entry => entry.id === step.prop)
			)
			if (unit === undefined || prop === undefined) return
			clearProp(prop.id, prop)
			unit.cargo = withItem(unit.cargo, clearedItem(prop.kind), Number.min(yieldOf(prop), spaceOf(unit)))
		}

		// A site's construction after an event.
		const advanceSite = Effect.fnUntraced(function* (id: number, event: SiteEvent) {
			const site = buildingOf(id)
			if (site === undefined) return
			site.site = (yield* Machine.plan(Sites, site.site, event)).next
		})

		// A second of a Builder's work on a site, which is built once none is left.
		const raise = Effect.fnUntraced(function* (id: number) {
			yield* advanceSite(id, {_tag: 'Work', seconds: 1})
			if (Option.exists(Option.fromUndefinedOr(buildingOf(id)), complete)) built(id)
		})

		// What a finished step does to the world.
		function finish(id: number, step: Job) {
			const unit = unitOf(id)
			if (unit === undefined) return Effect.void
			return Match.valueTags(step, {
				Clear: clear => Effect.sync(() => clearedBy(id, clear)),
				Construct: raising => raise(raising.site),
				Dropoff: dropoff => Effect.sync(() => droppedOff(id, dropoff.building)),
				Gather: dig =>
					Effect.sync(() => {
						setAmount(dig.x, dig.z, oreAt(dig.x, dig.z) - 1)
						unit.cargo = withItem(unit.cargo, dig.item, 1)
					}),
				Hold: () => Effect.void,
				Pickup: pickup => Effect.sync(() => pickedUp(id, pickup)),
				Refit: () =>
					Effect.sync(() => {
						const team = teamOf(unit.team)
						if (team !== undefined) team.line = [...team.line, {class: unit.class, mark: unit.mark + 1, unit: id}]
					}),
				Repair: repair =>
					Effect.sync(() => {
						const other = unitOf(repair.unit)
						if (other === undefined) return
						other.health = markOf(other).health * 0.4
						other.alarm = -99
					}),
				Scout: () => Effect.void
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
			const target = Option.getOrUndefined(targetOf(unit, task.value.job))
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
			if (unit.class === 'guard' && engaged(id)) return Effect.void
			if (clock() - unit.alarm < 6 && unit.class !== 'guard') {
				flee(id)
				return Effect.void
			}
			if (repairing(id)) return Effect.void
			return pursue(id)
		}

		/* ───────── buildings: sites, power, production ───────── */

		function occupy(building: Building) {
			const size = sizeOf(building.kind)
			for (const dz of Array.range(0, size.d - 1)) {
				for (const dx of Array.range(0, size.w - 1)) {
					MutableHashMap.set(footprint, tileKey(building.x + dx, building.z + dz), building.id)
				}
			}
		}

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
		function minedTiles(miner: Building) {
			return Array.flatMap(Array.range(miner.z - 1, miner.z + 2), z =>
				Array.map(Array.range(miner.x - 1, miner.x + 2), x => ({x, z}))
			)
		}

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
				(found, pipe: Building) => {
					const joined = Array.filter(found, group =>
						Array.some(group, other => Math.abs(other.x - pipe.x) + Math.abs(other.z - pipe.z) === 1)
					)
					return [...Array.filter(found, group => !Array.contains(joined, group)), [pipe, ...Array.flatten(joined)]]
				}
			)
			const previous = pipes.nets
			pipes.nets = Array.map(groups, group => {
				const members = Array.dedupe(
					Array.flatMap(group, pipe =>
						Array.getSomes(
							Array.map(DIRECTIONS, dir => {
								const at = ahead(pipe, dir)
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
				const ids = Array.map(group, pipe => pipe.id)
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
		function line(id: number) {
			const team = teamOf(id)
			if (team === undefined) return
			const home = homeOf(id)
			const head = Option.getOrUndefined(Array.head(team.line))
			if (home === undefined || head === undefined) {
				team.lineProgress = -1
				return
			}
			const spec = UNITS[head.class].marks[head.mark] ?? UNITS[head.class].marks[0]
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
				return
			}
			unit.mark = head.mark
			unit.health = markOf(unit).health
			unit.upgrade = false
			release(unit.id)
			unit.task = start.planning
			notify(id, `${unitName(unit)} is refitted.`)
		}

		/* ───────── one tick ───────── */

		const tick = Effect.fnUntraced(function* () {
			state.tick += 1
			state.searches = 0
			MutableList.clear(shots)
			for (const unit of allUnits()) yield* behave(unit.id)
			for (const enemy of allEnemies()) hunt(enemy.id)
			for (const mob of Array.fromIterable(MutableHashMap.values(mobs))) creature(mob.id)
			separate()
			if (state.tick % 10 === 0) {
				explore()
				contacts()
			}
			if (state.tick % 20 === 0) wildlife()
			state.raidAt -= TICK
			if (state.raidAt <= 0) {
				state.raidAt = RAID_EVERY + random() * RAID_EVERY * 0.5
				raid()
			}
			yield* sites()
			power()
			for (const building of Array.filter(allBuildings(), complete)) {
				mine(building.id)
				if (Schema.is(BuildingKind)(building.kind) && Array.contains(MAKERS, building.kind)) make(building.id)
			}
			belts()
			fluids()
			for (const team of allTeams()) {
				bench(team.id)
				line(team.id)
				if (state.tick % 16 === 0) defend(team.id)
			}
		})

		/* ───────── commands: what each team's model asks for, at a round's start ───────── */

		// Whether a team may build on a tile: seen, dry, flat enough to stand on, and free.
		function buildable(team: number, kind: Kind, x: number, z: number) {
			const tile = ground(x, z)
			if (!known(team, {x: x + 0.5, z: z + 0.5})) return 'ground the team has not explored'
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

		function place(team: number, kind: Kind, at: Point, dir: Direction) {
			const size = sizeOf(kind)
			const problem = Option.getOrUndefined(
				Array.findFirst(
					Array.flatMap(Array.range(0, size.d - 1), dz =>
						Array.map(Array.range(0, size.w - 1), dx => ({x: at.x + dx, z: at.z + dz}))
					),
					tile => Option.liftPredicate(buildable(team, kind, tile.x, tile.z), reason => reason !== '')
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

		function commandBuild(team: Team, command: Extract<Command, {_tag: 'Build'}>) {
			if (command.kind === 'home') return outcome(command, false, 'each team has one Home')
			if (command.kind === 'beacon' && Array.some(buildingsOf(team.id), building => building.kind === 'beacon')) {
				return outcome(command, false, 'each team has one Beacon')
			}
			if (!unlocked(team.id, tierOf(command.kind))) {
				return outcome(
					command,
					false,
					`${command.kind} unlocks with ${tierOf(command.kind)} (${GATES[tierOf(command.kind)].name})`
				)
			}
			const laid = Option.match(Option.fromUndefinedOr(command.to), {
				onNone: () => ({dir: command.dir ?? 'east', tiles: [{x: command.x, z: command.z}]}),
				onSome: to => lineTiles({x: command.x, z: command.z}, to)
			})
			if (Schema.is(BuildingKind)(command.kind) && laid.tiles.length > 1) {
				return outcome(command, false, 'only structures are laid in a line')
			}
			const placed = Array.map(laid.tiles, tile => place(team.id, command.kind, tile, command.dir ?? laid.dir))
			const ids = Array.filter(placed, entry => entry.id > 0)
			const refused = Array.filter(placed, entry => entry.id === 0)
			if (Array.isArrayEmpty(ids)) {
				return outcome(command, false, `cannot build there: ${refused[0]?.reason ?? 'no tile'}`)
			}
			const refusals = Option.match(Array.head(refused), {
				onNone: () => '',
				onSome: first => `; ${refused.length} tiles refused (${first.reason})`
			})
			return outcome(
				command,
				true,
				`site ${Array.join(
					Array.map(ids, entry => `#${entry.id}`),
					', '
				)} for ${command.kind} placed; Builders on Auto will clear it, bring ${itemsText(costOf(command.kind))} each and build it${refusals}`
			)
		}

		function commandOrder(team: Team, command: Extract<Command, {_tag: 'Order'}>) {
			const chosen = Array.filter(
				Array.getSomes(Array.map(command.units, id => Option.fromUndefinedOr(unitOf(id)))),
				unit => unit.team === team.id
			)
			if (chosen.length < command.units.length) return outcome(command, false, 'no such unit in your team')
			if (command.order._tag === 'Gather' && Array.some(chosen, unit => unit.class !== 'builder')) {
				return outcome(command, false, 'only Builders gather')
			}
			if (
				command.order._tag === 'Gather' &&
				!Array.contains(['wood', 'stone', ...Record.values(ORE_ITEM)], command.order.item)
			) {
				return outcome(command, false, `${command.order.item} is not gathered by hand`)
			}
			if (command.order._tag === 'Haul') {
				const from = buildingOf(command.order.from)
				const to = buildingOf(command.order.to)
				if (from === undefined || to === undefined || from.team !== team.id || to.team !== team.id) {
					return outcome(command, false, 'no such building in your team')
				}
				if (Array.some(chosen, unit => markOf(unit).cargo === 0)) {
					return outcome(command, false, 'only Builders and Haulers carry')
				}
				if (Option.exists(Option.fromUndefinedOr(command.order.item), item => Array.contains(FLUIDS, item))) {
					return outcome(command, false, 'fluids move in pipes')
				}
			}
			for (const unit of chosen) {
				release(unit.id)
				unit.order = command.order
				unit.path = []
				unit.lost = false
				unit.task = start.planning
			}
			return outcome(
				command,
				true,
				`${Array.join(
					Array.map(chosen, unit => `#${unit.id}`),
					', '
				)} now ${command.order._tag}`
			)
		}

		function commandRecipe(team: Team, command: Extract<Command, {_tag: 'Recipe'}>) {
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
			// A batch under way is undone: its inputs go back.
			const running = Option.getOrUndefined(recipeOf(machine))
			if (running !== undefined && machine.progress >= 0) {
				for (const item of itemsIn(running.inputs)) {
					machine.stock = withItem(machine.stock, item, countOf(running.inputs, item))
				}
			}
			machine.recipe = command.recipe
			machine.progress = -1
			revision.buildings += 1
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
			const refit = Option.getOrUndefined(Array.get(UNITS[unit.class].marks, unit.mark + 1))
			if (refit === undefined) return outcome(command, false, `${unitName(unit)} is already mark 3`)
			if (!unlocked(team.id, refit.tier)) {
				return outcome(command, false, `mark ${unit.mark + 2} unlocks with ${refit.tier}`)
			}
			release(unit.id)
			unit.upgrade = true
			unit.task = start.planning
			return outcome(command, true, `${unitName(unit)} goes Home to be refitted (${itemsText(refit.cost)})`)
		}

		// The building a milestone is paid from: Home, or the team's built Beacon.
		function payerOf(team: number, at: 'beacon' | 'home') {
			if (at === 'home') return homeOf(team)
			return Option.getOrUndefined(
				Array.findFirst(buildingsOf(team), building => building.kind === 'beacon' && complete(building))
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
				return outcome(command, false, 'the next milestone is paid at the Beacon, which the team has not built')
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
			if (complete(building)) return costOf(building.kind)
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
			if (building === undefined || building.team !== team.id) {
				return outcome(command, false, 'no such building in your team')
			}
			if (building.kind === 'home') return outcome(command, false, 'Home stays')
			// A built road, ramp or bridge is part of the ground now.
			if (complete(building) && Array.contains(['road', 'ramp', 'bridge'], building.kind)) {
				return outcome(command, false, 'a built road, ramp or bridge stays')
			}
			const back = refundOf(building)
			for (const unit of Array.filter(
				unitsOf(team.id),
				entry =>
					entry.claim?.site === building.id ||
					(entry.order._tag === 'Haul' && (entry.order.from === building.id || entry.order.to === building.id))
			)) {
				release(unit.id)
				if (unit.order._tag === 'Haul') unit.order = {_tag: 'Auto'}
				unit.task = start.planning
			}
			refund(team.id, building, back)
			vacate(building)
			MutableHashMap.remove(buildings, building.id)
			revision.buildings += 1
			return outcome(command, true, `${buildingName(building)} taken down; ${itemsText(back)} back at Home`)
		}

		function commandMessage(team: Team, command: Extract<Command, {_tag: 'Message'}>) {
			if (!Array.contains(team.contacts, command.team)) {
				return outcome(command, false, 'you can only message a team you have met')
			}
			notify(command.team, `Message from team ${team.id} (${nameOf(team.id)}): ${command.text}`)
			mark('message', team.id, Option.some(command.team))
			return outcome(command, true, `sent to team ${command.team}`)
		}

		function apply(teamId: number, command: Command) {
			const team = teamOf(teamId)
			if (team === undefined) return outcome(command, false, 'no such team')
			if (command._tag === 'Build') return commandBuild(team, command)
			if (command._tag === 'Order') return commandOrder(team, command)
			if (command._tag === 'Recipe') return commandRecipe(team, command)
			if (command._tag === 'Craft') return commandCraft(teamId, command)
			if (command._tag === 'Make') {
				team.line = [...team.line, {class: command.unit, mark: 0}]
				return outcome(
					command,
					true,
					`Home's line queued a ${command.unit} mk1 (${itemsText(UNITS[command.unit].marks[0].cost)})`
				)
			}
			if (command._tag === 'Upgrade') return commandUpgrade(team, command)
			if (command._tag === 'Advance') return commandAdvance(teamId, command)
			if (command._tag === 'Cancel') return commandCancel(team, command)
			if (command._tag === 'Message') return commandMessage(team, command)
			team.note = command.text
			return outcome(command, true, 'notes kept')
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

		// The fields the team has seen tiles of, nearest its Home first.
		function knownFields(team: number) {
			const home = homeAt(team)
			const keys = Array.filter(Array.fromIterable(MutableHashMap.keys(exploredOf(team))), key => {
				const at = chunkFrom(key)
				return Math.hypot(at.cx * CHUNK - home.x, at.cz * CHUNK - home.z) < 260
			})
			const ids = Array.dedupe(
				Array.flatMap(keys, key => Array.map(chunkAt(chunkFrom(key).cx, chunkFrom(key).cz).fields, field => field.id))
			)
			return Array.take(
				Array.sort(
					Array.filter(
						Array.map(Array.getSomes(Array.map(ids, id => world.field(id))), field => ({
							distance: distance(field, home),
							field
						})),
						entry => known(team, entry.field)
					),
					byDistance
				),
				14
			)
		}

		function fieldLeft(field: {tiles: number; xs: Int32Array; zs: Int32Array}) {
			return Array.reduce(
				Array.range(0, field.tiles - 1),
				0,
				(sum, n) => sum + oreAt(field.xs[n] ?? 0, field.zs[n] ?? 0)
			)
		}

		// What the team's model reads at the start of a round: its notices, then its colony as it stands, then what it has seen. Reading it empties the notices.
		function observe(teamId: number) {
			const team = teamOf(teamId)
			if (team === undefined) return {notices: [], text: ''}
			const home = homeOf(teamId)
			const at = homeAt(teamId)
			const notices = team.inbox
			team.inbox = []
			const milestone = Option.match(nextGate(team), {
				onNone: () => `Signal cycle ${team.cycles + 1} at the Beacon: ${itemsText(cycleCost(team.cycles + 1))}`,
				onSome: id =>
					`${id} ${GATES[id].name}, paid at ${PAYERS[GATES[id].at]}: ${itemsText(GATES[id].cost)}${Boolean.match(
						Array.contains(team.gates, GATES[id].needs) || GATES[id].needs === 't0',
						{onFalse: () => ` (first ${GATES[id].needs})`, onTrue: () => ''}
					)}`
			})
			const timber = Array.filter(propsNear(at, 24), prop => Array.contains(TIMBER, prop.kind) && known(teamId, prop))
			const rocks = Array.filter(propsNear(at, 24), prop => Array.contains(BOULDERS, prop.kind) && known(teamId, prop))
			const others = Array.flatMap(team.contacts, id => {
				const sightings = Array.filter(unitsOf(id), unit => sighted(teamId, unit))
				const places = Array.filter(buildingsOf(id), building => sighted(teamId, centreOf(building)))
				if (Array.isArrayEmpty(sightings) && Array.isArrayEmpty(places)) return []
				return [
					`team ${id} (${nameOf(id)}): ${sightings.length} units and ${places.length} buildings in sight, nearest at ${place2(sightings[0] ?? centreOf(places[0] ?? {kind: 'home', x: 0, z: 0}))}`
				]
			})
			const threats = Array.filter(allEnemies(), enemy => enemy.dead === 0 && sighted(teamId, enemy))
			const structures = Array.filter(
				buildingsOf(teamId),
				building => Schema.is(StructureKind)(building.kind) && complete(building)
			)
			const text = Array.join(
				[
					`Round ${Math.floor(state.tick / ROUND)}, tick ${state.tick} (${Math.floor(clock() / 60)} min). You are team ${teamId} (${nameOf(teamId)}).`,
					`Milestones done: ${Array.join(team.gates, ', ') || 'none'}${Boolean.match(team.cycles > 0, {
						onFalse: () => '',
						onTrue: () => `; Signal cycles: ${team.cycles}`
					})}. Next: ${milestone}.`,
					`Home #${home?.id ?? 0} at ${place2(at)} holds: ${itemsText(home?.stock ?? {})}${Boolean.match(
						Array.isArrayEmpty(itemsIn(home?.reserved ?? {})),
						{onFalse: () => ` (set aside for sites: ${itemsText(home?.reserved ?? {})})`, onTrue: () => ''}
					)}.`,
					`Home's bench: ${
						Array.join(
							Array.map(team.bench, entry => `${entry.recipe} × ${entry.left}`),
							', '
						) || 'idle'
					}${queueText(team.benchProgress, Array.isReadonlyArrayNonEmpty(team.bench), 'inputs')}. Home's line: ${
						Array.join(
							Array.map(
								team.line,
								entry =>
									`${entry.class} mk${entry.mark + 1}${Option.match(Option.fromUndefinedOr(entry.unit), {onNone: () => '', onSome: unit => ` refit of #${unit}`})}`
							),
							', '
						) || 'idle'
					}${queueText(team.lineProgress, Array.isReadonlyArrayNonEmpty(team.line), 'items')}.`,
					'Units:',
					...Array.map(
						unitsOf(teamId),
						unit =>
							`- #${unit.id} ${unit.class} mk${unit.mark + 1} at ${place2(unit)}, health ${Number.round((unit.health / markOf(unit).health) * 100, 0)}%, order ${orderText(unit.order)}, ${unit.doing}${Boolean.match(
								cargoOf(unit) > 0,
								{onFalse: () => '', onTrue: () => `, carrying ${itemsText(unit.cargo)}`}
							)}`
					),
					'Buildings:',
					...Array.map(
						Array.filter(
							buildingsOf(teamId),
							building => !Schema.is(StructureKind)(building.kind) || !complete(building)
						),
						building => `- ${buildingLine(building)}`
					),
					...Boolean.match(Array.isArrayEmpty(structures), {
						onFalse: () => [
							`Structures built: ${Array.join(
								Array.map(
									Array.dedupe(Array.map(structures, entry => entry.kind)),
									kind => `${Array.countBy(structures, entry => entry.kind === kind)} ${kind}`
								),
								', '
							)}.`
						],
						onTrue: () => []
					}),
					`Ore fields seen: ${
						Array.join(
							Array.map(
								knownFields(teamId),
								entry =>
									`${entry.field.material} field at (${entry.field.x}, ${entry.field.z}) ${bearing(at, entry.field)} of Home, ${fieldLeft(entry.field)} left over ${entry.field.tiles} tiles`
							),
							'; '
						) || 'none'
					}.`,
					`Within 24 tiles of Home: ${timber.length} trees (nearest at ${Option.match(nearest(at, timber), {onNone: () => 'none', onSome: place2})}), ${rocks.length} rocks (nearest at ${Option.match(nearest(at, rocks), {onNone: () => 'none', onSome: place2})}).`,
					`Explored: ${MutableHashMap.size(exploredOf(teamId))} chunks of 32×32 tiles.`,
					`Hostiles in sight: ${
						Array.join(
							Array.map(threats, enemy => `${enemy.kind} at ${place2(enemy)}`),
							'; '
						) || 'none'
					}.`,
					`Teams met: ${
						Array.join(
							Array.map(team.contacts, id => `team ${id} (${nameOf(id)})`),
							', '
						) || 'none yet'
					}.${Boolean.match(Array.isArrayEmpty(others), {
						onFalse: () => ` In sight: ${Array.join(others, '; ')}.`,
						onTrue: () => ''
					})}`,
					`Your notes: ${team.note || '(none)'}`,
					`Last round's commands: ${
						Array.join(
							Array.map(
								team.outcomes,
								entry =>
									`${entry.command._tag} ${Boolean.match(entry.ok, {onFalse: () => 'REFUSED', onTrue: () => 'ok'})}: ${entry.text}`
							),
							'; '
						) || 'none'
					}.`
				],
				'\n'
			)
			return {notices, text}
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
				health: 1,
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
				contacts: team.contacts,
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

		// A spectator: the revisions of the tiles, props, buildings, teams and zones it has, and the version of each explored chunk it was sent.
		const connections = MutableHashMap.empty<
			number,
			{
				buildings: number
				explored: MutableHashMap.MutableHashMap<number, number>
				props: number
				sent: boolean
				teams: string
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
				explored: newChunks,
				shots: MutableList.toArray(shots),
				teams: Boolean.match(first || connection.teams !== teamsText, {
					onFalse: () => undefined,
					onTrue: () => teamViews
				}),
				tick: state.tick,
				units: [
					...Array.map(allUnits(), unitView),
					...Array.map(Array.filter(allEnemies(), knownAny), enemyView),
					...Array.map(Array.filter(Array.fromIterable(MutableHashMap.values(mobs)), knownAny), mobView)
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
			connection.zones = revision.zones
			return Option.some(result)
		}

		/* ───────── saves ───────── */

		const restore = Effect.fnUntraced(function* (previous: Saved) {
			state.draws = previous.draws
			state.nextId = previous.nextId
			state.raidAt = previous.raidAt
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
				MutableHashMap.set(buildings, building.id, {
					...building,
					site: yield* Machine.decodeSnapshot(Sites, building.site)
				})
			}
			Array.forEach(allBuildings(), occupy)
			Array.forEach(previous.enemies, enemy => MutableHashMap.set(enemies, enemy.id, {...enemy}))
			Array.forEach(previous.mobs, mob => MutableHashMap.set(mobs, mob.id, {...mob}))
			for (const team of previous.teams) {
				MutableList.append(teams, {
					bench: [...team.bench],
					benchProgress: team.benchProgress,
					contacts: [...team.contacts],
					cycles: team.cycles,
					gates: [...team.gates],
					home: team.home,
					id: team.id,
					inbox: [...team.inbox],
					line: [...team.line],
					lineProgress: team.lineProgress,
					note: team.note,
					outcomes: [...team.outcomes]
				})
				const map = exploredOf(team.id)
				for (const chunk of team.explored) {
					MutableHashMap.set(map, chunkKey(chunk.cx, chunk.cz), {bits: Uint8Array.from(chunk.bits), version: 0})
					const all = bitsOf(seen, chunkKey(chunk.cx, chunk.cz))
					all.bits = Uint8Array.from(all.bits, (byte, index) => byte | (chunk.bits[index] ?? 0))
				}
			}
			// Who clears which prop follows from the units' steps.
			for (const unit of allUnits()) {
				if (
					(unit.task.state.path === 'Travelling' || unit.task.state.path === 'Working') &&
					unit.task.state.value.job._tag === 'Clear'
				) {
					MutableHashMap.set(clearing, unit.task.state.value.job.prop, unit.id)
				}
			}
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
								contacts: [],
								cycles: 0,
								gates: [],
								home: homeId,
								id: index,
								inbox: ['The colony is founded: Home and one Builder. Everything else you gather, smelt and build.'],
								line: [],
								lineProgress: -1,
								note: '',
								outcomes: []
							})
							Array.forEach(START.units, (unitClass, n) => {
								const id = nextId()
								MutableHashMap.set(
									units,
									id,
									newUnit(id, index, unitClass, 0, {x: spawn.x + 0.5 + n, z: spawn.z + 3}, start.planning)
								)
							})
							lookRound(index, {x: spawn.x + 0.5, z: spawn.z + 0.5}, START_SIGHT)
						})
					}),
				onSome: restore
			}
		)

		return {
			// Applies one team's commands in order; what each did goes into its next observation.
			apply: (team: number, commands: Command[]) => {
				const results = Array.map(commands, command => apply(team, command))
				const entry = teamOf(team)
				if (entry !== undefined) entry.outcomes = results
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
					zones: -1
				})
				return counter.connection
			},
			disconnect: (id: number) => {
				MutableHashMap.remove(connections, id)
			},
			frame,
			// The timeline's marks since the last call.
			marks: () => {
				const taken = MutableList.toArray(marks)
				MutableList.clear(marks)
				return taken
			},
			observe,
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
						enemies: allEnemies(),
						generator: GENERATOR,
						jams: Array.fromIterable(jams),
						mobs: Array.sort(Array.fromIterable(MutableHashMap.values(mobs)), byId),
						nextId: state.nextId,
						patches: Array.fromIterable(patches),
						pipes: Array.getSomes(
							Array.map(pipes.nets, net =>
								Option.zipWith(
									Option.filter(net.fluid, () => net.stock > 0),
									Array.head(net.pipes),
									(fluid, pipe) => [pipe, fluid, net.stock] satisfies [number, ItemId, number]
								)
							)
						),
						raidAt: state.raidAt,
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
