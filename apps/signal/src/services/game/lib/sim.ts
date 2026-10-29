import {Array, MutableHashMap, MutableHashSet, MutableList, Number, Option, Order, Record} from 'effect'
import type {Types} from 'effect'

import {route} from '#services/game/lib/path.ts'
import {COSTS, RESEARCH, STATS, bearing, buildings, nameOf, staticTiles} from '#services/game/lib/utils.ts'
import type {
	Act,
	Action,
	Hud,
	Job,
	Point,
	Saved,
	Stock,
	Turn,
	UnitKind,
	UnitView,
	Waypoint
} from '#services/game/schema.ts'
import {EnemyKind} from '#services/game/schema.ts'
import {
	GENERATOR,
	GROUND,
	LIQUID,
	MOVERS,
	ORES,
	chunkOf,
	crossable,
	hash,
	makeWorld,
	standable,
	tileGround,
	tileKey,
	tileOf
} from '#services/world/lib/utils.ts'
import type {Chunk, Field, Mover} from '#services/world/lib/utils.ts'
import {Material} from '#services/world/schema.ts'
import type {Edit, TileChange} from '#services/world/schema.ts'

const TICK = 0.05
// Ore moves in bites this size: a digger's scoop; a loader's claw holds two.
const BITE = 5
// Seconds a loader takes to grip or drop ore in the field, and at Home.
const GRIP = 0.8
const UNLOAD = 0.6
// The share of its health below which a unit leaves its job to be repaired.
const HURT = 0.55
// Seconds between raids at the least; raids come only for units this far from Home.
const RAID_EVERY = 240
const RAID_DISTANCE = 16
// Orders name places at most this many tiles from Home.
const REACH = 200
// Building costs in stone per tile, and seconds of work per tile.
const BUILD = {bridge: {seconds: 10, stone: 8}, ramp: {seconds: 8, stone: 6}, road: {seconds: 3, stone: 2}}
const SIDES = [
	{x: 1, z: 0},
	{x: -1, z: 0},
	{x: 0, z: 1},
	{x: 0, z: -1}
]
const CORNERS = [
	{x: 0, z: 0},
	{x: 1, z: 0},
	{x: 0, z: 1},
	{x: 1, z: 1}
]
const START_STOCK = {copper: 20, iron: 40, stone: 60}
const START_FLEET = [
	'worker',
	'worker',
	'cart',
	'cart',
	'digger',
	'dozer',
	'sentry',
	'loader',
	'loader'
] satisfies UnitKind[]
// Who hauls ore between a digger and Home, and who guards; research adds striders and skiffs to the first, rotors to the second.
const HAULERS = ['cart', 'strider', 'skiff'] satisfies UnitKind[]
const GUARDS = ['sentry', 'rotor'] satisfies UnitKind[]
const NEEDS_ROAD = 'carts cannot reach the field: it needs a road or a ramp'
// Wet ground wheels crawl over.
const MUD = [GROUND.mud, GROUND.mud2, GROUND.marsh, GROUND.reeds]

type Unit = {
	act: Act
	aim: number
	alarm: number
	// Where the unit last stood half a tile from, and when; and until when it passes through others.
	anchor: Point
	anchored: number
	cargo: number
	doing: string
	ghost: number
	health: number
	hop: number
	id: number
	job: Option.Option<number>
	kind: UnitKind
	lost: boolean
	material: Option.Option<Material>
	path: Point[]
	planned: number
	recycle: boolean
	route: string
	timer: number
	x: number
	yaw: number
	z: number
}

type Enemy = {
	act: Act
	dead: number
	doing: string
	health: number
	id: number
	kind: EnemyKind
	target: number
	timer: number
	x: number
	yaw: number
	z: number
}

type JobState = Types.Mutable<Job> & {
	blocked: Option.Option<string>
	spot: Option.Option<Point>
	tile: Option.Option<number>
}

type Connection = {hud: string; id: number; revision: number; sent: boolean; user: string}

type Cost = Partial<Record<Material, number>>

type BuildAction = Extract<Action, {_tag: 'Build'}>

type Colony = {
	alerts: Hud['alerts'][number][]
	chat: Turn[]
	clock: number
	connection: number
	draws: number
	edits: number
	lastActive: number
	line: UnitKind[]
	lineTimer: number
	nextId: number
	raidAt: number
	research: Hud['research']
	revision: number
	searches: number
	shots: {from: number; to: number}[]
	stock: Stock
	waypoints: Waypoint[]
}

// Events CORE may want to react to on its own.
export type GameEvent = {at: Point; text: string}

const byDistance = Order.mapInput(Order.Number, (entry: {distance: number}) => entry.distance)

// A cost's materials with their amounts, in material order.
function costEntries(cost: Cost) {
	return Array.filter(
		Array.map(Material.literals, material => ({amount: cost[material] ?? 0, material})),
		entry => entry.amount > 0
	)
}

function costText(cost: Cost) {
	return Array.join(
		Array.map(costEntries(cost), entry => `${entry.amount} ${entry.material}`),
		' + '
	)
}

function distance(a: Point, b: Point) {
	return Math.hypot(a.x - b.x, a.z - b.z)
}

function angleTo(from: Point, to: Point) {
	return Math.atan2(to.x - from.x, to.z - from.z)
}

function refuse(summary: string) {
	return {ids: Array.empty<number>(), ok: false, summary}
}

// The places an order names.
function placesOf(action: Action) {
	if (action._tag === 'Build') return [action.from, action.to]
	if (action._tag === 'Guard' || action._tag === 'Mark') return [action.at]
	return []
}

// How much a unit gives way when bodies overlap: idle units make way for moving ones, working ones hold their place.
function yieldOf(act: Act) {
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

// The next tile of a four-connected line: whichever step keeps closer to the true line.
function nextTile(start: Point, end: Point, last: Point) {
	const dx = Math.sign(end.x - last.x)
	const dz = Math.sign(end.z - last.z)
	const across = Math.abs((end.z - start.z) * (last.x + dx - start.x) - (end.x - start.x) * (last.z - start.z))
	const down = Math.abs((end.z - start.z) * (last.x - start.x) - (end.x - start.x) * (last.z + dz - start.z))
	if (dz === 0 || (dx !== 0 && across <= down)) return {x: last.x + dx, z: last.z}
	return {x: last.x, z: last.z + dz}
}

// The tiles a straight line from one point to another crosses, four-connected, in order.
function lineTiles(from: Point, to: Point) {
	const start = {x: Math.floor(from.x), z: Math.floor(from.z)}
	const end = {x: Math.floor(to.x), z: Math.floor(to.z)}
	const steps = Math.abs(end.x - start.x) + Math.abs(end.z - start.z)
	if (steps === 0) return [start]
	const walked = Array.mapAccum(Array.range(1, steps), start, last => {
		const next = nextTile(start, end, last)
		return [next, next]
	})
	return [start, ...walked[1]]
}

// How far along a ramp's rise a corner of its tile lies, for a line heading one way.
function alongOf(direction: Point, corner: Point) {
	if (direction.x > 0) return corner.x
	if (direction.x < 0) return 1 - corner.x
	if (direction.z > 0) return corner.z
	return 1 - corner.z
}

// Ramp corners for a tile on a line from lower ground to higher: its back edge at one height and its front edge at the next.
function rampCorners(direction: Point, back: number, front: number) {
	const heights = Array.map(CORNERS, corner => back + (front - back) * alongOf(direction, corner))
	return [heights[0] ?? 0, heights[1] ?? 0, heights[2] ?? 0, heights[3] ?? 0] satisfies [number, number, number, number]
}

function newUnit(id: number, kind: UnitKind, at: Point) {
	return {
		act: 'idle',
		aim: 0,
		alarm: -99,
		anchor: {x: at.x, z: at.z},
		anchored: 0,
		cargo: 0,
		doing: 'parked at Home',
		ghost: 0,
		health: STATS[kind].health,
		hop: 0,
		id,
		job: Option.none(),
		kind,
		lost: false,
		material: Option.none(),
		path: [],
		planned: -99,
		recycle: false,
		route: '',
		timer: 0,
		x: at.x,
		yaw: 0,
		z: at.z
	} satisfies Unit
}

function fieldTiles(field: Field) {
	return Array.map(Array.range(0, field.tiles - 1), n => ({x: field.xs[n] ?? 0, z: field.zs[n] ?? 0}))
}

function percent(share: number) {
	return `${Number.round(share * 100, 0)}%`
}

// A colony from its save when the world generator is unchanged, else a fresh one on the world `fresh` seeds.
export function makeSim(saved: Option.Option<Saved>, now: number, fresh: number) {
	const restored = Option.filter(saved, previous => previous.generator === GENERATOR)
	const seed = Option.match(restored, {onNone: () => fresh, onSome: previous => previous.seed})
	const world = makeWorld(seed)
	const spawn = world.spawn()
	const places = buildings(spawn)
	const home = places.home
	const dock = {x: home.x, z: home.z + 2.5}
	const silo = {x: home.x - 1, z: home.z}
	const blocked = staticTiles(spawn)
	const chunks = MutableHashMap.empty<number, Chunk>()
	const fields = MutableHashMap.empty<number, Option.Option<Field>>()
	const amounts = MutableHashMap.empty<number, number>()
	const edits = MutableHashMap.empty<number, Edit>()
	const units = MutableHashMap.empty<number, Unit>()
	const enemies = MutableHashMap.empty<number, Enemy>()
	const jobs = MutableHashMap.empty<number, JobState>()
	const connections = MutableHashMap.empty<number, Connection>()
	const log = MutableList.make<{key: number; revision: number}>()
	const events = MutableList.make<GameEvent>()
	const reach = {edits: -1, tiles: MutableHashSet.empty<number>()}
	const state: Colony = {
		alerts: [],
		chat: [],
		clock: 0,
		connection: 0,
		draws: 0,
		edits: 0,
		lastActive: now,
		line: [],
		lineTimer: 0,
		nextId: 1,
		raidAt: 360,
		research: {tier: 1},
		revision: 0,
		searches: 0,
		shots: [],
		// Every material at zero, then the starting stock.
		stock: {...Record.map(ORES, () => 0), ...START_STOCK},
		waypoints: []
	}

	// The colony's own dice, seeded by its world so a replay of the same ticks rolls the same.
	function random() {
		state.draws += 1
		return hash(seed, state.draws, 7919)
	}

	/* ───────── the world as units see it: generated chunks, edits and ore left ───────── */

	function chunkAt(cx: number, cz: number) {
		const key = (cx + 4096) * 8192 + (cz + 4096)
		return Option.getOrElse(MutableHashMap.get(chunks, key), () => {
			if (MutableHashMap.size(chunks) > 600) MutableHashMap.clear(chunks)
			const chunk = world.chunk(cx, cz)
			MutableHashMap.set(chunks, key, chunk)
			return chunk
		})
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

	function fieldOf(id: number) {
		return Option.getOrElse(MutableHashMap.get(fields, id), () => {
			const field = world.field(id)
			MutableHashMap.set(fields, id, field)
			return field
		})
	}

	function remaining(field: Field) {
		return Array.reduce(fieldTiles(field), 0, (sum, tile) => sum + oreAt(tile.x, tile.z))
	}

	function changed(x: number, z: number) {
		state.revision += 1
		MutableList.append(log, {key: tileKey(x, z), revision: state.revision})
		// A client further behind than this many changes gets the whole overlay again.
		if (log.length > 6000) MutableList.take(log)
	}

	function setAmount(x: number, z: number, amount: number) {
		MutableHashMap.set(amounts, tileKey(x, z), amount)
		changed(x, z)
	}

	function setEdit(x: number, z: number, edit: Edit) {
		MutableHashMap.set(edits, tileKey(x, z), edit)
		state.edits += 1
		changed(x, z)
	}

	// What one straight step costs a unit kind: roads are quick, mud slows wheels, buildings and impassable ground stop it.
	function walker(kind: UnitKind) {
		const mover = MOVERS[STATS[kind].mover]
		return (x: number, z: number, dx: number, dz: number) => {
			if (Array.contains(blocked, tileKey(x + dx, z + dz))) return Infinity
			const to = ground(x + dx, z + dz)
			if (!crossable(mover, ground(x, z), to, dx, dz)) return Infinity
			if (to.road) return 0.6
			if (STATS[kind].mover === 'wheels' && Array.contains(MUD, to.ground)) return 2.5
			return 1
		}
	}

	function speedOf(unit: Unit) {
		const tile = ground(Math.floor(unit.x), Math.floor(unit.z))
		const base = STATS[unit.kind].speed
		if (STATS[unit.kind].mover === 'fly') return base
		if (tile.road) return base * 1.5
		if (STATS[unit.kind].mover === 'wheels' && Array.contains(MUD, tile.ground)) return base * 0.5
		return base
	}

	/* ───────── units: spawning, names, movement ───────── */

	function unitOf(id: number) {
		return Option.getOrUndefined(MutableHashMap.get(units, id))
	}

	function enemyOf(id: number) {
		return Option.getOrUndefined(MutableHashMap.get(enemies, id))
	}

	function jobOf(id: number) {
		return Option.getOrUndefined(MutableHashMap.get(jobs, id))
	}

	function allUnits() {
		return Array.fromIterable(MutableHashMap.values(units))
	}

	function allEnemies() {
		return Array.fromIterable(MutableHashMap.values(enemies))
	}

	function spawnUnit(kind: UnitKind, at: Point) {
		const id = state.nextId
		state.nextId += 1
		MutableHashMap.set(units, id, newUnit(id, kind, at))
		return id
	}

	function unitName(unit: Unit) {
		return nameOf(
			unit.kind,
			Array.countBy(allUnits(), other => other.kind === unit.kind && other.id <= unit.id)
		)
	}

	function alert(entry: {at: Point; text: string; unit?: number}) {
		state.alerts = Array.take([{...entry, time: state.clock}, ...state.alerts], 5)
		MutableList.append(events, {at: entry.at, text: entry.text})
	}

	function threatNear(point: Point, radius: number) {
		return Option.map(
			Array.head(
				Array.sort(
					Array.map(
						Array.filter(allEnemies(), enemy => enemy.dead === 0 && distance(enemy, point) <= radius),
						enemy => ({distance: distance(enemy, point), enemy})
					),
					byDistance
				)
			),
			entry => entry.enemy
		)
	}

	// A crew member out of the job for now: fleeing, hurt, or a sentry with a hostile in sight.
	function busy(unit: Unit) {
		return (
			state.clock - unit.alarm < 6 ||
			unit.health < STATS[unit.kind].health * HURT ||
			(Array.contains(GUARDS, unit.kind) && Option.isSome(threatNear(unit, 14)))
		)
	}

	// Searches a route for a unit; false when this tick's searches are spent or no way exists.
	function plan(id: number, to: Point, near: number, key: string) {
		const unit = unitOf(id)
		// Six searches a tick, of up to 6000 tiles each, keep a tick cheap.
		if (unit === undefined || state.searches >= 6) return false
		state.searches += 1
		unit.route = key
		unit.planned = state.clock
		const found = route(walker(unit.kind), {x: unit.x, z: unit.z}, to, {budget: 6000, near})
		unit.path = Option.getOrElse(found, () => [])
		unit.lost = Option.isNone(found)
		return Option.isSome(found)
	}

	// One tick of motion toward a point; true when it gets there.
	function step(id: number, to: Point) {
		const unit = unitOf(id)
		if (unit === undefined) return false
		const gap = distance(unit, to)
		const travel = speedOf(unit) * TICK
		// A unit that has not got half a tile further in two seconds, wedged between others, passes through them for two more.
		if (distance(unit, unit.anchor) > 0.5) {
			unit.anchor = {x: unit.x, z: unit.z}
			unit.anchored = state.clock
		}
		if (state.clock - unit.anchored > 2) {
			unit.ghost = state.clock + 2
			unit.anchored = state.clock
		}
		unit.act = 'move'
		if (gap > 1e-3) unit.yaw = angleTo(unit, to)
		if (gap <= travel) {
			unit.x = to.x
			unit.z = to.z
			return true
		}
		unit.x += ((to.x - unit.x) / gap) * travel
		unit.z += ((to.z - unit.z) / gap) * travel
		return false
	}

	// Moves a unit toward a point by its own ground rules; true once it is within `near` tiles.
	function goTo(id: number, to: Point, near: number) {
		const unit = unitOf(id)
		if (unit === undefined) return false
		if (Math.abs(unit.x - to.x) <= near + 0.5 && Math.abs(unit.z - to.z) <= near + 0.5) {
			unit.path = []
			unit.anchored = state.clock
			return true
		}
		if (STATS[unit.kind].mover === 'fly') {
			step(id, to)
			return false
		}
		const key = `${Math.floor(to.x)},${Math.floor(to.z)},${near}`
		// A unit plans again when its goal moves, at most every second and a half, and retries a failed plan after three.
		const stale = unit.route !== key && (Array.isArrayEmpty(unit.path) || state.clock - unit.planned > 1.5)
		const retry = unit.route === key && Array.isArrayEmpty(unit.path) && state.clock - unit.planned > 3
		if ((stale || retry) && !plan(id, to, near, key)) return false
		Option.match(Array.head(unit.path), {
			onNone: () => undefined,
			onSome: next => {
				if (step(id, next)) unit.path = Array.drop(unit.path, 1)
			}
		})
		return false
	}

	// Where a body pushed by an offset ends up: nowhere it could not stand or step to.
	function nudged(at: Point, mover: Mover, by: Point) {
		const moved = {x: at.x + by.x, z: at.z + by.z}
		const from = {x: Math.floor(at.x), z: Math.floor(at.z)}
		const to = {x: Math.floor(moved.x), z: Math.floor(moved.z)}
		if (from.x === to.x && from.z === to.z) return moved
		const open =
			Math.abs(to.x - from.x) + Math.abs(to.z - from.z) === 1 &&
			!Array.contains(blocked, tileKey(to.x, to.z)) &&
			crossable(mover, ground(from.x, from.z), ground(to.x, to.z), to.x - from.x, to.z - from.z)
		if (open) return moved
		return at
	}

	// Units never overlap: each pair closer than their sizes is pushed apart by how much each gives way.
	function separate() {
		const bodies = [
			...Array.map(
				Array.filter(
					allUnits(),
					unit => STATS[unit.kind].mover !== 'fly' && unit.ghost < state.clock && unit.health > 0
				),
				unit => ({
					at: unit,
					give: yieldOf(unit.act),
					mover: MOVERS[STATS[unit.kind].mover],
					radius: STATS[unit.kind].radius
				})
			),
			...Array.map(
				Array.filter(allEnemies(), enemy => enemy.dead === 0),
				enemy => ({at: enemy, give: 0.5, mover: MOVERS.legs, radius: 0.35})
			)
		]
		for (const pair of Array.flatMap(bodies, (first, index) =>
			Array.map(Array.drop(bodies, index + 1), second => ({first, second}))
		)) {
			const overlap = pair.first.radius + pair.second.radius - distance(pair.first.at, pair.second.at)
			if (overlap > 0) {
				const away = awayOf(pair.first.at, pair.second.at)
				const share = pair.first.give / (pair.first.give + pair.second.give)
				const first = nudged(pair.first.at, pair.first.mover, {
					x: -away.x * overlap * share,
					z: -away.z * overlap * share
				})
				const second = nudged(pair.second.at, pair.second.mover, {
					x: away.x * overlap * (1 - share),
					z: away.z * overlap * (1 - share)
				})
				pair.first.at.x = first.x
				pair.first.at.z = first.z
				pair.second.at.x = second.x
				pair.second.at.z = second.z
			}
		}
	}

	// Counts a unit's time at a task; true each time it reaches the seconds, when the timer starts over.
	function worked(id: number, seconds: number) {
		const unit = unitOf(id)
		if (unit === undefined) return false
		unit.act = 'work'
		unit.timer += TICK
		if (unit.timer < seconds) return false
		unit.timer = 0
		return true
	}

	function hover(id: number, at: Point, doing: string) {
		const unit = unitOf(id)
		if (unit === undefined) return
		unit.doing = doing
		if (goTo(id, at, 0)) unit.act = 'idle'
	}

	/* ───────── jobs: crews, mining, building, guarding ───────── */

	function crewOf(job: JobState) {
		return Array.filter(
			Array.getSomes(Array.map(job.crew, id => MutableHashMap.get(units, id))),
			unit => unit.health > 0
		)
	}

	// Takes the nearest free units of the given kinds into a job's crew, up to a count across them.
	function recruit(jobId: number, kinds: UnitKind[], count: number, near: Point) {
		const job = jobOf(jobId)
		if (job === undefined) return
		const free = Array.filter(
			allUnits(),
			// A unit still holding ore from an earlier job brings it Home first, so one load never mixes two materials.
			unit =>
				Array.contains(kinds, unit.kind) &&
				Option.isNone(unit.job) &&
				!unit.recycle &&
				unit.cargo === 0 &&
				unit.health > STATS[unit.kind].health * HURT
		)
		const taken = Array.take(
			Array.sort(
				Array.map(free, unit => ({distance: distance(unit, near), unit})),
				byDistance
			),
			Number.max(0, count - Array.countBy(crewOf(job), unit => Array.contains(kinds, unit.kind)))
		)
		for (const entry of taken) {
			entry.unit.job = Option.some(job.id)
			entry.unit.path = []
			job.crew = [...job.crew, entry.unit.id]
		}
	}

	function release(jobId: number) {
		Option.match(MutableHashMap.get(jobs, jobId), {
			onNone: () => undefined,
			// Downed members leave the crew too, so they come back free.
			onSome: job => {
				for (const member of Array.getSomes(Array.map(job.crew, id => MutableHashMap.get(units, id)))) {
					member.job = Option.none()
					member.path = []
					member.lost = false
				}
			}
		})
		MutableHashMap.remove(jobs, jobId)
	}

	// A bite of ore from a tile into the digger's bed every 1.4 seconds, while the bed has room.
	function scoop(jobId: number, diggerId: number, key: number, material: Material) {
		const job = jobOf(jobId)
		const digger = unitOf(diggerId)
		if (job === undefined || digger === undefined) return
		const tile = tileOf(key)
		if (!goTo(diggerId, {x: tile.x + 0.5, z: tile.z + 0.5}, 0)) {
			digger.doing = `driving to the ${material} field`
			if (digger.lost) {
				digger.doing = `cannot reach the ${material} field`
				job.blocked = Option.some('the digger cannot reach the field')
			}
			return
		}
		digger.material = Option.some(material)
		if (digger.cargo + BITE > STATS.digger.cargo) {
			digger.act = 'idle'
			digger.doing = 'bed full, waiting for the loader'
			return
		}
		digger.doing = `digging ${material}`
		if (!worked(diggerId, 1.4)) return
		const amount = oreAt(tile.x, tile.z)
		setAmount(tile.x, tile.z, amount - Number.min(BITE, amount))
		digger.cargo += Number.min(BITE, amount)
	}

	// The digger works the field tile by tile, nearest first.
	function dig(jobId: number, field: Field, diggerId: number) {
		const job = jobOf(jobId)
		const digger = unitOf(diggerId)
		if (job === undefined || digger === undefined) return
		job.tile = Option.orElse(
			Option.filter(job.tile, key => oreAt(tileOf(key).x, tileOf(key).z) > 0),
			() =>
				Option.map(
					Array.head(
						Array.sort(
							Array.map(
								Array.filter(fieldTiles(field), tile => oreAt(tile.x, tile.z) > 0),
								tile => ({distance: distance(digger, {x: tile.x + 0.5, z: tile.z + 0.5}), key: tileKey(tile.x, tile.z)})
							),
							byDistance
						)
					),
					entry => entry.key
				)
		)
		Option.match(job.tile, {
			onNone: () => {
				digger.act = 'idle'
				digger.doing = `done at the ${field.material} field`
			},
			onSome: key => scoop(jobId, diggerId, key, field.material)
		})
	}

	// The tiles wheels reach from Home's dock, out to 110 tiles, flooded again after each change to the ground.
	function wheelsReach() {
		if (reach.edits === state.edits) return reach.tiles
		const start = {x: Math.floor(dock.x), z: Math.floor(dock.z)}
		const tiles = MutableHashSet.make(tileKey(start.x, start.z))
		const walk = walker('cart')
		const frontier = {tiles: [start]}
		Array.forEach(Array.range(1, 400), () => {
			frontier.tiles = Array.filter(
				Array.flatMap(frontier.tiles, tile =>
					Array.map(
						Array.filter(SIDES, side => walk(tile.x, tile.z, side.x, side.z) < Infinity),
						side => ({x: tile.x + side.x, z: tile.z + side.z})
					)
				),
				next => {
					const key = tileKey(next.x, next.z)
					if (MutableHashSet.has(tiles, key) || Math.hypot(next.x - start.x, next.z - start.z) >= 110) return false
					MutableHashSet.add(tiles, key)
					return true
				}
			)
		})
		reach.edits = state.edits
		reach.tiles = tiles
		return tiles
	}

	// Where carts wait to be loaded: the nearest tile beside the digger that wheels reach from Home.
	function loadSpot(jobId: number, digger: Unit) {
		const job = jobOf(jobId)
		if (job === undefined) return Option.none<Point>()
		const kept = Option.filter(job.spot, spot => distance(spot, digger) < 3.5)
		if (Option.isSome(kept)) return kept
		const centre = {x: Math.floor(digger.x), z: Math.floor(digger.z)}
		const reached = wheelsReach()
		const candidates = Array.flatMap(Array.range(-3, 3), dz =>
			Array.map(Array.range(-3, 3), dx => ({distance: Math.hypot(dx, dz), tile: {x: centre.x + dx, z: centre.z + dz}}))
		)
		job.spot = Option.map(
			Array.findFirst(
				Array.sort(candidates, byDistance),
				candidate => candidate.distance > 0 && MutableHashSet.has(reached, tileKey(candidate.tile.x, candidate.tile.z))
			),
			candidate => ({x: candidate.tile.x + 0.5, z: candidate.tile.z + 0.5})
		)
		return job.spot
	}

	// A cart loads beside the digger until full, hauls to Home's dock, waits to be unloaded and comes back.
	function haul(jobId: number, cartId: number, digger: Option.Option<Unit>, left: number) {
		const job = jobOf(jobId)
		const cart = unitOf(cartId)
		if (job === undefined || cart === undefined) return
		// A full cart, or one with ore and nothing more to come, heads Home.
		if (
			cart.cargo + BITE > STATS[cart.kind].cargo ||
			(cart.cargo > 0 && (left === 0 || Option.isNone(digger))) ||
			cart.hop < 0
		) {
			cart.hop = -1
			cart.doing = `hauling ${Option.getOrElse(cart.material, () => 'ore')} to Home`
			if (!goTo(cartId, dock, 1)) return
			cart.act = 'idle'
			cart.doing = 'unloading at Home'
			if (cart.cargo === 0) cart.hop = 0
			return
		}
		Option.match(
			Option.flatMap(digger, unit => loadSpot(jobId, unit)),
			{
				onNone: () => {
					cart.act = 'idle'
					cart.doing = 'cannot reach the digger'
					job.blocked = Option.some(NEEDS_ROAD)
				},
				onSome: spot => {
					cart.doing = 'driving to the digger'
					if (!goTo(cartId, spot, 1)) {
						if (cart.lost) job.blocked = Option.some(NEEDS_ROAD)
						return
					}
					cart.act = 'idle'
					cart.doing = 'loading beside the digger'
				}
			}
		)
	}

	function drop(loaderId: number, cartId: number) {
		const loader = unitOf(loaderId)
		const cart = unitOf(cartId)
		if (loader === undefined || cart === undefined) return
		loader.doing = 'carrying ore to a cart'
		if (!goTo(loaderId, cart, 0) || !worked(loaderId, GRIP)) return
		// What the cart has no room for stays in the claw for the next one.
		const moved = Number.min(loader.cargo, STATS[cart.kind].cargo - cart.cargo)
		cart.cargo += moved
		cart.material = loader.material
		loader.cargo -= moved
	}

	// The crew's loader flies ore from the digger's bed to a waiting cart with room, a claw at a time.
	function carry(jobId: number, loaderId: number, diggerId: Option.Option<number>, left: number) {
		const job = jobOf(jobId)
		const loader = unitOf(loaderId)
		const digger = Option.getOrUndefined(Option.flatMapNullishOr(diggerId, unitOf))
		if (job === undefined || loader === undefined) return
		if (digger === undefined) {
			hover(loaderId, home, 'waiting for a digger')
			return
		}
		// The cart beside the digger with room for a claw of ore, nearest first.
		const cart = Option.map(
			Array.head(
				Array.sort(
					Array.map(
						Array.filter(
							crewOf(job),
							unit =>
								Array.contains(HAULERS, unit.kind) &&
								unit.hop >= 0 &&
								unit.cargo + BITE <= STATS[unit.kind].cargo &&
								distance(unit, digger) <= 6 &&
								Array.isArrayEmpty(unit.path)
						),
						unit => ({distance: distance(unit, digger), unit})
					),
					byDistance
				)
			),
			entry => entry.unit
		)
		const beside = {x: digger.x + 0.8, z: digger.z + 0.8}
		// A whole bite at a time while the field lasts; once it is worked out, whatever is left in the bed.
		const waiting = digger.cargo === 0 || (digger.cargo < BITE && left > 0)
		if (loader.cargo === 0 && (waiting || Option.isNone(cart))) {
			hover(loaderId, beside, 'waiting beside the digger')
			return
		}
		if (loader.cargo === 0) {
			loader.doing = 'picking up ore'
			if (!goTo(loaderId, digger, 0) || !worked(loaderId, GRIP)) return
			loader.cargo = Number.min(STATS.loader.cargo, digger.cargo)
			loader.material = digger.material
			digger.cargo -= loader.cargo
			return
		}
		Option.match(cart, {
			onNone: () => hover(loaderId, beside, 'holding ore for a cart'),
			onSome: target => drop(loaderId, target.id)
		})
	}

	function deliver(material: Option.Option<Material>, amount: number) {
		Option.match(material, {
			onNone: () => undefined,
			onSome: kind => {
				state.stock = {...state.stock, [kind]: state.stock[kind] + amount}
			}
		})
	}

	// A free loader drops what it holds into the silo and waits by Home.
	function rest(id: number, index: number) {
		const loader = unitOf(id)
		if (loader === undefined) return
		if (loader.cargo > 0) {
			loader.doing = 'emptying its claw'
			if (!goTo(id, silo, 0)) return
			deliver(loader.material, loader.cargo)
			loader.cargo = 0
		}
		hover(id, {x: home.x + 1.5 + index, z: home.z - 1.5}, 'waiting at Home')
	}

	function homeHop(loaderId: number, cartId: number) {
		const loader = unitOf(loaderId)
		const cart = unitOf(cartId)
		if (loader === undefined || cart === undefined) return
		loader.doing = 'unloading a cart into the silo'
		if (loader.cargo === 0) {
			if (!goTo(loaderId, cart, 0) || !worked(loaderId, UNLOAD)) return
			loader.cargo = Number.min(STATS.loader.cargo, cart.cargo)
			loader.material = cart.material
			cart.cargo -= loader.cargo
			return
		}
		if (!goTo(loaderId, silo, 0) || !worked(loaderId, UNLOAD)) return
		deliver(loader.material, loader.cargo)
		loader.cargo = 0
	}

	// Home's own loaders empty docked carts into the silo, a claw at a time; a cart with no loader free tips its bed slowly.
	function unload() {
		const docked = Array.filter(
			allUnits(),
			unit => Array.contains(HAULERS, unit.kind) && unit.cargo > 0 && unit.hop < 0 && distance(unit, dock) < 2.2
		)
		const loaders = Array.filter(
			allUnits(),
			unit => unit.kind === 'loader' && Option.isNone(unit.job) && !unit.recycle && unit.health > 0
		)
		for (const entry of Array.map(loaders, (loader, index) => ({index, loader}))) {
			Option.match(Array.get(docked, entry.index), {
				onNone: () => rest(entry.loader.id, entry.index),
				onSome: cart => homeHop(entry.loader.id, cart.id)
			})
		}
		for (const cart of Array.drop(docked, loaders.length)) {
			if (worked(cart.id, UNLOAD * 6)) {
				deliver(cart.material, Number.min(BITE, cart.cargo))
				cart.cargo -= Number.min(BITE, cart.cargo)
			}
		}
	}

	function mine(jobId: number, field: Field, carts: number) {
		recruit(jobId, ['digger'], 1, field)
		recruit(jobId, ['loader'], 1, field)
		recruit(jobId, HAULERS, carts, field)
		const job = jobOf(jobId)
		if (job === undefined) return
		// Members fleeing, hurt or fighting sit the job out until they are back.
		const ready = Array.filter(crewOf(job), unit => !busy(unit))
		const digger = Array.findFirst(ready, unit => unit.kind === 'digger')
		const left = remaining(field)
		job.done = 1 - left / Number.max(1, field.total)
		job.blocked = Option.none()
		Option.match(digger, {
			onNone: () => {
				job.blocked = Option.some('waiting for a free digger')
			},
			onSome: unit => dig(jobId, field, unit.id)
		})
		for (const cart of Array.filter(ready, unit => Array.contains(HAULERS, unit.kind))) {
			haul(jobId, cart.id, digger, left)
		}
		for (const loader of Array.filter(ready, unit => unit.kind === 'loader')) {
			carry(
				jobId,
				loader.id,
				Option.map(digger, unit => unit.id),
				left
			)
		}
		if (left === 0 && Array.every(crewOf(job), unit => unit.cargo === 0)) {
			alert({at: {x: field.x, z: field.z}, text: `The ${field.material} field is worked out`})
			release(jobId)
		}
	}

	function tileLevel(x: number, z: number) {
		return Array.reduce(ground(x, z).corners, 0, (sum, corner) => sum + corner) / 4
	}

	// What a build line does to its i-th tile: a road, a ramp tile, or a deck over liquid.
	function editFor(action: BuildAction, tiles: Point[], index: number) {
		const tile = tiles[index] ?? action.from
		const first = tiles[0] ?? tile
		const last = tiles[tiles.length - 1] ?? tile
		const low = tileLevel(first.x, first.z)
		const high = tileLevel(last.x, last.z)
		const ends = index === 0 || index === tiles.length - 1
		if (action.kind === 'road' || (action.kind === 'ramp' && ends)) return {_tag: 'Road'} satisfies Edit
		if (action.kind === 'bridge' && ground(tile.x, tile.z).liquid === LIQUID.none) return {_tag: 'Road'} satisfies Edit
		if (action.kind === 'bridge') {
			return {_tag: 'Bridge', level: low + ((high - low) * index) / Number.max(1, tiles.length - 1)} satisfies Edit
		}
		const span = tiles.length - 2
		return {
			_tag: 'Ramp',
			corners: rampCorners(
				{x: Math.sign(last.x - first.x), z: Math.sign(last.z - first.z)},
				low + ((high - low) * (index - 1)) / span,
				low + ((high - low) * index) / span
			)
		} satisfies Edit
	}

	// The dozer drives to the line's next tile, pays its stone and works it.
	function pave(jobId: number, dozerId: number, action: BuildAction, done: number) {
		const job = jobOf(jobId)
		const dozer = unitOf(dozerId)
		if (job === undefined || dozer === undefined) return
		const tiles = lineTiles(action.from, action.to)
		const tile = tiles[done] ?? action.from
		const centre = {x: tile.x + 0.5, z: tile.z + 0.5}
		const cost = BUILD[action.kind]
		job.blocked = Option.none()
		if (!goTo(dozerId, centre, 1)) {
			dozer.doing = `driving to build a ${action.kind}`
			if (dozer.lost) job.blocked = Option.some(`the dozer cannot reach the ${action.kind}`)
			return
		}
		if (state.stock.stone < cost.stone && dozer.timer === 0) {
			dozer.act = 'idle'
			dozer.doing = `waiting for ${cost.stone} stone`
			job.blocked = Option.some(`needs ${cost.stone} stone a tile`)
			return
		}
		if (dozer.timer === 0) state.stock = {...state.stock, stone: state.stock.stone - cost.stone}
		dozer.yaw = angleTo(dozer, centre)
		dozer.doing = `building a ${action.kind}`
		if (!worked(dozerId, cost.seconds)) return
		setEdit(tile.x, tile.z, editFor(action, tiles, done))
		job.done = (done + 1) / tiles.length
	}

	function build(jobId: number, action: BuildAction) {
		recruit(jobId, ['dozer'], 1, action.from)
		const job = jobOf(jobId)
		if (job === undefined) return
		const tiles = lineTiles(action.from, action.to)
		const done = Math.floor(job.done * tiles.length + 1e-6)
		if (done >= tiles.length) {
			alert({at: action.to, text: `The ${action.kind} is finished`})
			release(jobId)
			return
		}
		Option.match(
			Array.findFirst(crewOf(job), unit => unit.kind === 'dozer' && !busy(unit)),
			{
				onNone: () => {
					job.blocked = Option.some('waiting for a free dozer')
				},
				onSome: dozer => pave(jobId, dozer.id, action, done)
			}
		)
	}

	/* ───────── raids and sentries ───────── */

	function ambush(prey: Unit) {
		const at = chunkOf(Math.floor(prey.x), Math.floor(prey.z))
		const kind = EnemyKind.literals[chunkAt(at.cx, at.cz).biome[at.index] ?? 0] ?? 'glitch'
		const turn = random()
		const spots = Array.map(Array.range(0, 15), n => {
			const angle = ((n + turn) / 16) * Math.PI * 2
			return {x: Math.floor(prey.x + Math.sin(angle) * 13) + 0.5, z: Math.floor(prey.z + Math.cos(angle) * 13) + 0.5}
		})
		Option.match(
			Array.findFirst(
				spots,
				spot =>
					standable(MOVERS.legs, ground(Math.floor(spot.x), Math.floor(spot.z))) &&
					distance(spot, home) > RAID_DISTANCE - 4
			),
			{
				onNone: () => undefined,
				onSome: spot => {
					const id = state.nextId
					state.nextId += 1
					MutableHashMap.set(enemies, id, {
						act: 'move',
						dead: 0,
						doing: 'hunting',
						health: 60,
						id,
						kind,
						target: prey.id,
						timer: 0,
						x: spot.x,
						yaw: 0,
						z: spot.z
					})
					MutableList.append(events, {at: {x: prey.x, z: prey.z}, text: `A ${kind} is hunting ${unitName(prey)}`})
				}
			}
		)
	}

	// A hostile of the prey's biome comes for a unit far from Home, a cart first.
	function raid() {
		const exposed = Array.filter(
			allUnits(),
			unit => STATS[unit.kind].mover !== 'fly' && unit.health > 0 && distance(unit, home) > RAID_DISTANCE
		)
		Option.match(
			Option.orElse(
				Array.findFirst(exposed, unit => unit.kind === 'cart'),
				() => Array.get(exposed, Math.floor(random() * exposed.length))
			),
			{onNone: () => undefined, onSome: ambush}
		)
	}

	// One straight step on legs: onto ground they stand on, over an edge they climb, never into a building.
	function legStep(x: number, z: number, dx: number, dz: number) {
		return (
			!Array.contains(blocked, tileKey(x + dx, z + dz)) &&
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

	function prowl(id: number, to: Point) {
		const enemy = enemyOf(id)
		if (enemy === undefined) return
		const gap = distance(enemy, to)
		enemy.act = 'move'
		enemy.yaw = angleTo(enemy, to)
		if (gap < 1e-3) return
		const next = {
			x: enemy.x + ((to.x - enemy.x) / gap) * 1.05 * TICK,
			z: enemy.z + ((to.z - enemy.z) / gap) * 1.05 * TICK
		}
		if (!legsCross({x: Math.floor(enemy.x), z: Math.floor(enemy.z)}, {x: Math.floor(next.x), z: Math.floor(next.z)})) {
			return
		}
		enemy.x = next.x
		enemy.z = next.z
	}

	function hunt(id: number) {
		const enemy = enemyOf(id)
		if (enemy === undefined) return
		if (enemy.dead > 0) {
			enemy.act = 'die'
			if (state.clock - enemy.dead > 3) MutableHashMap.remove(enemies, id)
			return
		}
		const prey = Option.getOrUndefined(Option.filter(MutableHashMap.get(units, enemy.target), unit => unit.health > 0))
		// Once its prey is down it slinks off, away from Home, and is gone a little later.
		if (prey === undefined) {
			enemy.timer += TICK
			enemy.doing = 'leaving'
			prowl(id, {x: enemy.x * 2 - home.x, z: enemy.z * 2 - home.z})
			if (enemy.timer > 20) MutableHashMap.remove(enemies, id)
			return
		}
		enemy.yaw = angleTo(enemy, prey)
		if (distance(enemy, prey) > 1.1) {
			prowl(id, prey)
			return
		}
		enemy.act = 'attack'
		enemy.timer += TICK
		if (enemy.timer < 1.5) return
		enemy.timer = 0
		prey.health = Number.max(0, prey.health - 6)
		if (state.clock - prey.alarm > 10) {
			alert({at: {x: prey.x, z: prey.z}, text: `${unitName(prey)} is under attack`, unit: prey.id})
		}
		prey.alarm = state.clock
		if (prey.health === 0) {
			alert({at: {x: prey.x, z: prey.z}, text: `${unitName(prey)} is down and needs a worker`, unit: prey.id})
		}
	}

	// A free worker drives to a unit that is down and patches it up enough to limp Home.
	function recover(id: number) {
		const worker = unitOf(id)
		const down = Option.getOrUndefined(
			Array.head(
				Array.sort(
					Array.map(
						Array.filter(allUnits(), unit => unit.health <= 0),
						unit => ({distance: distance(unit, worker ?? home), unit})
					),
					byDistance
				)
			)
		)
		if (worker === undefined || down === undefined) return false
		worker.doing = `recovering ${unitName(down.unit)}`
		if (!goTo(id, down.unit, 1) || !worked(id, 6)) return true
		down.unit.health = STATS[down.unit.kind].health * 0.4
		down.unit.alarm = -99
		return true
	}

	// A sentry that sees a hostile within 14 tiles (a free one, anything near Home) drives into range, turns its turret and fires; true while it is busy with one.
	function engaged(id: number) {
		const sentry = unitOf(id)
		if (sentry === undefined) return false
		const foe = Option.getOrUndefined(
			Option.orElse(threatNear(sentry, 14), () => Option.filter(threatNear(home, 40), () => Option.isNone(sentry.job)))
		)
		if (foe === undefined) return false
		sentry.aim = angleTo(sentry, foe) - sentry.yaw
		if (distance(sentry, foe) > 4.5) {
			sentry.doing = `chasing a ${foe.kind}`
			goTo(id, foe, 3)
			return true
		}
		sentry.doing = `firing at a ${foe.kind}`
		if (!worked(id, 0.8)) return true
		foe.health -= 6
		state.shots = [...state.shots, {from: id, to: foe.id}]
		if (foe.health <= 0) {
			foe.dead = state.clock
			foe.doing = 'down'
			alert({at: {x: foe.x, z: foe.z}, text: `${unitName(sentry)} stopped a ${foe.kind}`})
		}
		return true
	}

	function post(jobId: number, sentryId: number, at: Point) {
		const job = jobOf(jobId)
		const sentry = unitOf(sentryId)
		if (job === undefined || sentry === undefined) return
		job.blocked = Option.none()
		if (sentry.lost) job.blocked = Option.some('the sentry cannot reach the place')
		if (engaged(sentryId)) return
		sentry.doing = 'driving to guard'
		if (!goTo(sentryId, at, 1)) return
		sentry.act = 'idle'
		sentry.doing = 'guarding'
		job.done = 1
	}

	function guard(jobId: number, at: Point) {
		recruit(jobId, GUARDS, 1, at)
		const job = jobOf(jobId)
		if (job === undefined) return
		Option.match(
			Array.findFirst(crewOf(job), unit => Array.contains(GUARDS, unit.kind) && !busy(unit)),
			{
				onNone: () => {
					job.blocked = Option.some('waiting for a free sentry or rotor')
				},
				onSome: sentry => post(jobId, sentry.id, at)
			}
		)
	}

	// An attacked unit drops what it was doing and runs to the nearest sentry, or Home.
	function flee(id: number) {
		const unit = unitOf(id)
		if (unit === undefined) return
		const refuge = Option.match(
			Array.head(
				Array.sort(
					Array.map(
						Array.filter(allUnits(), other => Array.contains(GUARDS, other.kind) && other.health > 0),
						other => ({distance: distance(other, unit), unit: other})
					),
					byDistance
				)
			),
			{onNone: () => ({near: 2, to: home}), onSome: entry => ({near: 1, to: {x: entry.unit.x, z: entry.unit.z}})}
		)
		unit.doing = 'fleeing an attack'
		goTo(id, refuge.to, refuge.near)
		unit.act = 'alarm'
	}

	/* ───────── one tick ───────── */

	// A ring round Home that leaves the dock's side (south) open for carts.
	function parkingSpot(unit: Unit) {
		const slot = Option.getOrElse(
			Array.findFirstIndex(
				Array.filter(allUnits(), other => Option.isNone(other.job)),
				other => other.id === unit.id
			),
			() => 0
		)
		const angle = 0.9 + (slot % 9) * ((Math.PI * 2 - 1.8) / 8)
		const radius = 5.5 + Math.floor(slot / 9) * 1.4
		return {x: home.x + Math.sin(angle) * radius, z: home.z + Math.cos(angle) * radius}
	}

	// Hurt units go Home to be patched up: a working one only once badly hurt, an idle one near Home until whole.
	function repairing(id: number) {
		const unit = unitOf(id)
		if (unit === undefined) return false
		const full = STATS[unit.kind].health
		const topUp = distance(unit, home) < 3 && unit.health < full && Option.isNone(unit.job)
		if (unit.health >= full * HURT && !topUp) return false
		unit.doing = 'going Home for repairs'
		if (!goTo(id, home, 2)) return true
		unit.doing = 'being repaired'
		unit.health = Number.min(full, unit.health + 8 * TICK)
		return true
	}

	// A unit marked for recycling drives Home and is taken apart for four fifths of its cost.
	function recycle(id: number) {
		const unit = unitOf(id)
		if (unit === undefined) return
		unit.doing = 'driving Home to be recycled'
		if (!goTo(id, home, 2)) return
		for (const entry of costEntries(COSTS[unit.kind])) {
			deliver(Option.some(entry.material), Math.floor(entry.amount * 0.8))
		}
		alert({at: home, text: `${unitName(unit)} was recycled`})
		MutableHashMap.remove(units, id)
	}

	// A unit freed with ore aboard brings it Home before it parks: Home's loaders empty a cart, anything else tips its bed.
	function bringHome(id: number) {
		const unit = unitOf(id)
		if (unit === undefined) return
		unit.doing = `bringing ${Option.getOrElse(unit.material, () => 'ore')} Home`
		const hauler = Array.contains(HAULERS, unit.kind)
		if (hauler) unit.hop = -1
		if (!goTo(id, dock, 1)) return
		unit.doing = 'unloading at Home'
		if (hauler || !worked(id, UNLOAD * 6)) return
		deliver(unit.material, unit.cargo)
		unit.cargo = 0
	}

	function behave(id: number) {
		const unit = unitOf(id)
		if (unit === undefined) return
		unit.act = 'idle'
		if (unit.health <= 0) {
			unit.act = 'die'
			unit.doing = 'down, waiting for a worker'
			unit.path = []
			return
		}
		if (Array.contains(GUARDS, unit.kind) && engaged(id)) return
		if (state.clock - unit.alarm < 6 && !Array.contains(GUARDS, unit.kind)) {
			flee(id)
			return
		}
		if (repairing(id)) return
		if (unit.recycle) {
			recycle(id)
			return
		}
		if (Option.isSome(unit.job) || unit.kind === 'loader') return
		if (unit.kind === 'worker' && recover(id)) return
		if (unit.cargo > 0) {
			bringHome(id)
			return
		}
		unit.doing = 'going to park'
		if (goTo(id, parkingSpot(unit), 0)) unit.doing = 'parked at Home'
	}

	function work(id: number) {
		const job = jobOf(id)
		if (job === undefined) return
		const crew = crewOf(job)
		if (Array.isArrayNonEmpty(crew) && Array.every(crew, busy)) return
		if (job.action._tag === 'Mine') {
			const carts = job.action.carts ?? 2
			Option.match(fieldOf(job.action.field), {onNone: () => release(id), onSome: field => mine(id, field, carts)})
		}
		if (job.action._tag === 'Build') build(id, job.action)
		if (job.action._tag === 'Guard') guard(id, job.action.at)
	}

	// Home's line builds one queued unit every eight seconds; the lab researches its tier.
	function produce() {
		Option.match(Array.head(state.line), {
			onNone: () => {
				state.lineTimer = 0
			},
			onSome: kind => {
				state.lineTimer += TICK
				if (state.lineTimer < 8) return
				state.lineTimer = 0
				state.line = Array.drop(state.line, 1)
				const id = spawnUnit(kind, {x: home.x, z: home.z + 2})
				Option.match(MutableHashMap.get(units, id), {
					onNone: () => undefined,
					onSome: unit => alert({at: home, text: `${unitName(unit)} rolled off the line`, unit: id})
				})
			}
		})
		Option.match(Option.fromUndefinedOr(state.research.left), {
			onNone: () => undefined,
			onSome: left => {
				if (left - TICK > 0) {
					state.research = {...state.research, left: left - TICK}
					return
				}
				state.research = {tier: state.research.tier + 1}
				alert({at: places.lab, text: `Research done: tier ${state.research.tier} unlocked`})
			}
		})
	}

	function tick() {
		state.clock += TICK
		state.searches = 0
		for (const unit of allUnits()) behave(unit.id)
		for (const job of Array.fromIterable(MutableHashMap.values(jobs))) work(job.id)
		unload()
		for (const enemy of allEnemies()) hunt(enemy.id)
		separate()
		state.raidAt -= TICK
		if (state.raidAt <= 0) {
			state.raidAt = RAID_EVERY + random() * RAID_EVERY * 0.5
			raid()
		}
		produce()
	}

	/* ───────── actions ───────── */

	function pay(cost: Cost, times: number) {
		const short = Array.filter(costEntries(cost), entry => state.stock[entry.material] < entry.amount * times)
		if (Array.isArrayNonEmpty(short)) {
			return Option.some(
				`needs ${Array.join(
					Array.map(short, entry => `${entry.amount * times} ${entry.material}`),
					', '
				)}`
			)
		}
		for (const entry of costEntries(cost)) {
			state.stock = {...state.stock, [entry.material]: state.stock[entry.material] - entry.amount * times}
		}
		return Option.none()
	}

	function startJob(action: Action, title: string) {
		const id = state.nextId
		state.nextId += 1
		MutableHashMap.set(jobs, id, {
			action,
			blocked: Option.none(),
			crew: [],
			done: 0,
			id,
			spot: Option.none(),
			tile: Option.none()
		})
		return {ids: [id], ok: true, summary: title}
	}

	function startMine(action: Extract<Action, {_tag: 'Mine'}>) {
		const taken = Array.some(
			Array.fromIterable(MutableHashMap.values(jobs)),
			job => job.action._tag === 'Mine' && job.action.field === action.field
		)
		return Option.match(fieldOf(action.field), {
			onNone: () => refuse(`no ore field ${action.field}`),
			onSome: field => {
				if (remaining(field) === 0) return refuse(`the ${field.material} field is worked out`)
				if (taken) return refuse(`a crew already mines that ${field.material} field`)
				return startJob(action, `mine the ${field.material} field`)
			}
		})
	}

	function startBuild(action: BuildAction) {
		const tiles = lineTiles(action.from, action.to)
		const first = tiles[0] ?? action.from
		const last = tiles[tiles.length - 1] ?? action.to
		if (tiles.length > 40) return refuse('a build line is at most 40 tiles')
		if (action.kind !== 'ramp') return startJob(action, `build a ${action.kind} of ${tiles.length} tiles`)
		if (first.x !== last.x && first.z !== last.z) return refuse('a ramp runs straight along x or z')
		if (tiles.length < 3) return refuse('a ramp needs at least one tile between its ends')
		const rise = Math.abs(tileLevel(last.x, last.z) - tileLevel(first.x, first.z))
		const needed = Math.ceil(rise / MOVERS.wheels.slope)
		if (tiles.length - 2 < needed) {
			return refuse(`too steep: a ramp up ${Number.round(rise, 0)} levels needs ${needed} tiles between its ends`)
		}
		return startJob(action, `build a ramp of ${tiles.length} tiles`)
	}

	function make(kind: UnitKind, count: number) {
		if (STATS[kind].tier > state.research.tier) return refuse(`${kind}s need research tier ${STATS[kind].tier}`)
		return Option.match(pay(COSTS[kind], count), {
			onNone: () => {
				state.line = [...state.line, ...Array.replicate(kind, count)]
				return {ids: Array.empty<number>(), ok: true, summary: `make ${kind} × ${count}`}
			},
			onSome: refuse
		})
	}

	function research() {
		if (state.research.left !== undefined) return refuse('the lab is already researching')
		return Option.match(Array.get(RESEARCH, state.research.tier - 1), {
			onNone: () => refuse('nothing left to research'),
			onSome: tier =>
				Option.match(pay(tier.cost, 1), {
					onNone: () => {
						state.research = {...state.research, left: tier.seconds}
						return {ids: Array.empty<number>(), ok: true, summary: `research ${tier.name}`}
					},
					onSome: refuse
				})
		})
	}

	function recycleOrder(id: number) {
		const unit = unitOf(id)
		if (unit === undefined) return refuse(`no unit ${id}`)
		if (Option.isSome(unit.job)) return refuse(`${unitName(unit)} is busy`)
		unit.recycle = true
		return {ids: [id], ok: true, summary: `recycle ${unitName(unit)}`}
	}

	function mark(at: Point, note: string) {
		const id = state.nextId
		state.nextId += 1
		state.waypoints = [...state.waypoints, {at, id, note}]
		return {ids: [id], ok: true, summary: `mark "${note}"`}
	}

	function unmark(id: number) {
		if (!Array.some(state.waypoints, waypoint => waypoint.id === id)) return refuse(`no waypoint ${id}`)
		state.waypoints = Array.filter(state.waypoints, waypoint => waypoint.id !== id)
		return {ids: [id], ok: true, summary: 'remove a waypoint'}
	}

	function cancel(id: number) {
		if (!MutableHashMap.has(jobs, id)) return refuse(`no job ${id}`)
		release(id)
		return {ids: [id], ok: true, summary: 'cancel a job'}
	}

	function act(action: Action) {
		if (Array.some(placesOf(action), at => distance(at, home) > REACH)) {
			return refuse(`a place more than ${REACH} tiles from Home`)
		}
		if (action._tag === 'Mine') return startMine(action)
		if (action._tag === 'Build') return startBuild(action)
		if (action._tag === 'Guard') return startJob(action, 'guard a place')
		if (action._tag === 'Cancel') return cancel(action.job)
		if (action._tag === 'Make') return make(action.kind, action.count)
		if (action._tag === 'Research') return research()
		if (action._tag === 'Recycle') return recycleOrder(action.unit)
		if (action._tag === 'Mark') return mark(action.at, action.note)
		return unmark(action.waypoint)
	}

	/* ───────── views: frames, the HUD, CORE's context, saves ───────── */

	function unitView(unit: Unit) {
		return {
			act: unit.act,
			aim: unit.aim,
			cargo: Option.getOrUndefined(unit.material),
			doing: unit.doing,
			health: unit.health / STATS[unit.kind].health,
			id: unit.id,
			kind: unit.kind,
			load: unit.cargo / Number.max(1, STATS[unit.kind].cargo),
			x: unit.x,
			yaw: unit.yaw,
			z: unit.z
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

	function jobView(job: JobState) {
		if (job.action._tag === 'Mine') {
			return Option.match(fieldOf(job.action.field), {
				onNone: () => ({at: home, crew: job.crew, detail: '', id: job.id, progress: 0, title: 'Mining'}),
				onSome: found => ({
					at: {x: found.x, z: found.z},
					blocked: Option.getOrUndefined(job.blocked),
					crew: job.crew,
					detail: `${remaining(found)} ${found.material} left`,
					id: job.id,
					progress: job.done,
					title: `Mine ${found.material}`
				})
			})
		}
		if (job.action._tag === 'Build') {
			const tiles = lineTiles(job.action.from, job.action.to).length
			return {
				at: job.action.to,
				blocked: Option.getOrUndefined(job.blocked),
				crew: job.crew,
				detail: `${Number.round(job.done * tiles, 0)} of ${tiles} tiles`,
				id: job.id,
				progress: job.done,
				title: `Build a ${job.action.kind}`
			}
		}
		return {
			at: Option.getOrElse(
				Option.map(
					Option.liftPredicate(job.action, action => action._tag === 'Guard'),
					action => action.at
				),
				() => home
			),
			blocked: Option.getOrUndefined(job.blocked),
			crew: job.crew,
			detail: '',
			id: job.id,
			progress: job.done,
			title: 'Guard'
		}
	}

	function hud(user: string, core: Hud['core']) {
		return {
			alerts: state.alerts,
			chat: Array.takeRight(state.chat, 12),
			core,
			home,
			jobs: Array.map(Array.fromIterable(MutableHashMap.values(jobs)), jobView),
			lab: places.lab,
			players: Array.dedupe(
				Array.map(Array.fromIterable(MutableHashMap.values(connections)), connection => connection.user)
			),
			research: state.research,
			stock: state.stock,
			waypoints: state.waypoints,
			you: user
		} satisfies Hud
	}

	function overlayChange(key: number) {
		const tile = tileOf(key)
		return {
			amount: Option.getOrUndefined(MutableHashMap.get(amounts, key)),
			edit: Option.getOrUndefined(MutableHashMap.get(edits, key)),
			x: tile.x,
			z: tile.z
		} satisfies TileChange
	}

	// A new or far-behind client gets every changed tile; others the tiles changed since their last frame.
	function changesFor(connection: Connection) {
		const oldest = Option.getOrElse(
			Option.map(Array.head(MutableList.toArray(log)), entry => entry.revision),
			() => state.revision + 1
		)
		if (!connection.sent || connection.revision < oldest - 1) {
			return Array.map(
				Array.dedupe([
					...Array.fromIterable(MutableHashMap.keys(amounts)),
					...Array.fromIterable(MutableHashMap.keys(edits))
				]),
				overlayChange
			)
		}
		return Array.map(
			Array.dedupe(
				Array.map(
					Array.filter(MutableList.toArray(log), entry => entry.revision > connection.revision),
					entry => entry.key
				)
			),
			overlayChange
		)
	}

	// A client's next frame: every unit, its tile changes, the HUD when it changed and the world's seed in the first.
	function frame(id: number, at: number, core: Hud['core']) {
		const connection = Option.getOrUndefined(MutableHashMap.get(connections, id))
		if (connection === undefined) return Option.none()
		const view = hud(connection.user, core)
		const encoded = JSON.stringify(view)
		const changes = changesFor(connection)
		const first = !connection.sent
		const moved = encoded !== connection.hud
		connection.sent = true
		connection.revision = state.revision
		connection.hud = encoded
		return Option.some({
			at,
			changes,
			hud: Option.getOrUndefined(Option.liftPredicate(view, () => moved)),
			shots: state.shots,
			units: [...Array.map(allUnits(), unitView), ...Array.map(allEnemies(), enemyView)],
			world: Option.getOrUndefined(Option.liftPredicate({generator: GENERATOR, seed}, () => first))
		})
	}

	// The fields with tiles in the chunks round Home, which reach about 96 tiles out.
	function knownFields() {
		const centre = chunkOf(Math.floor(home.x), Math.floor(home.z))
		const ids = Array.dedupe(
			Array.flatMap(Array.range(-3, 3), dz =>
				Array.flatMap(Array.range(-3, 3), dx =>
					Array.map(chunkAt(centre.cx + dx, centre.cz + dz).fields, field => field.id)
				)
			)
		)
		return Array.getSomes(Array.map(ids, fieldOf))
	}

	// What CORE knows: the colony, its crews and the fields within reach, in plain lines with the ids orders use.
	function summary() {
		const near = Array.take(
			Array.sort(
				Array.filter(
					Array.map(knownFields(), field => ({distance: distance(field, home), field, left: remaining(field)})),
					entry => entry.left > 0
				),
				byDistance
			),
			16
		)
		const next = Option.match(Array.get(RESEARCH, state.research.tier - 1), {
			onNone: () => 'nothing',
			onSome: tier => `${tier.name}, costs ${costText(tier.cost)}`
		})
		const researching = Option.match(Option.fromUndefinedOr(state.research.left), {
			onNone: () => '',
			onSome: left => `, researching (${Math.ceil(left)} s left)`
		})
		return Array.join(
			[
				`Home is at (${Math.floor(home.x)}, ${Math.floor(home.z)}); the lab is beside it.`,
				`Stock: ${Array.join(
					Array.map(
						Array.filter(Record.toEntries(state.stock), entry => entry[1] > 0),
						entry => `${entry[1]} ${entry[0]}`
					),
					', '
				)}.`,
				`Research tier ${state.research.tier}${researching}. Next: ${next}.`,
				`Unit costs: ${Array.join(
					Array.map(
						Array.filter(Record.toEntries(COSTS), entry => STATS[entry[0]].tier <= state.research.tier),
						entry => `${entry[0]} ${costText(entry[1])}`
					),
					'; '
				)}.`,
				`Units: ${Array.join(
					Array.map(
						allUnits(),
						unit =>
							`${unitName(unit)} (id ${unit.id}, ${unit.doing}, ${percent(unit.health / STATS[unit.kind].health)} health)`
					),
					'; '
				)}.`,
				`Being built at Home: ${Array.join(state.line, ', ') || 'nothing'}.`,
				`Jobs: ${
					Array.join(
						Array.map(
							Array.fromIterable(MutableHashMap.values(jobs)),
							job =>
								`${jobView(job).title} (job ${job.id}, ${percent(job.done)}${Option.match(job.blocked, {onNone: () => '', onSome: reason => `, blocked: ${reason}`})})`
						),
						'; '
					) || 'none'
				}.`,
				`Ore fields near Home: ${Array.join(
					Array.map(
						near,
						entry =>
							`${entry.field.material} field ${entry.field.id}: ${entry.left} left, ${bearing(home, entry.field)} of Home, at (${entry.field.x}, ${entry.field.z})`
					),
					'; '
				)}.`,
				`Waypoints: ${
					Array.join(
						Array.map(
							state.waypoints,
							waypoint =>
								`"${waypoint.note}" (id ${waypoint.id}) at (${Math.floor(waypoint.at.x)}, ${Math.floor(waypoint.at.z)}), ${bearing(home, waypoint.at)} of Home`
						),
						'; '
					) || 'none'
				}.`,
				`Threats: ${
					Array.join(
						Array.map(
							Array.filter(allEnemies(), enemy => enemy.dead === 0),
							enemy => `a ${enemy.kind} ${bearing(home, enemy)} of Home`
						),
						'; '
					) || 'none'
				}.`
			],
			'\n'
		)
	}

	function restore(previous: Saved) {
		for (const entry of previous.amounts) MutableHashMap.set(amounts, tileKey(entry[0], entry[1]), entry[2])
		for (const entry of previous.edits) MutableHashMap.set(edits, tileKey(entry.x, entry.z), entry.edit)
		for (const unit of previous.units) {
			MutableHashMap.set(units, unit.id, {
				...newUnit(unit.id, unit.kind, unit),
				cargo: unit.cargo,
				health: unit.health,
				job: Option.fromUndefinedOr(unit.job),
				material: Option.fromUndefinedOr(unit.material)
			})
		}
		for (const job of previous.jobs) {
			MutableHashMap.set(jobs, job.id, {
				...job,
				blocked: Option.none(),
				crew: [...job.crew],
				spot: Option.none(),
				tile: Option.none()
			})
		}
		state.chat = [...previous.chat]
		state.line = [...previous.line]
		state.nextId = previous.nextId
		state.research = previous.research
		state.stock = {...state.stock, ...previous.stock}
		state.waypoints = [...previous.waypoints]
	}

	Option.match(restored, {
		onNone: () => {
			for (const entry of Array.map(START_FLEET, (kind, index) => ({
				angle: (index / START_FLEET.length) * Math.PI * 2,
				kind
			}))) {
				spawnUnit(entry.kind, {x: home.x + Math.sin(entry.angle) * 4, z: home.z + Math.cos(entry.angle) * 4})
			}
		},
		onSome: restore
	})

	return {
		act: (action: Action, at: number) => {
			state.lastActive = at
			return act(action)
		},
		chat: () => state.chat,
		connect: (user: string, at: number) => {
			state.lastActive = at
			state.connection += 1
			MutableHashMap.set(connections, state.connection, {hud: '', id: state.connection, revision: 0, sent: false, user})
			return state.connection
		},
		disconnect: (id: number) => {
			MutableHashMap.remove(connections, id)
		},
		drain: () => {
			const drained = MutableList.toArray(events)
			MutableList.clear(events)
			return drained
		},
		frame,
		home,
		idleHours: (at: number) => (at - state.lastActive) / 3_600_000,
		say: (turn: Turn) => {
			state.chat = Array.takeRight([...state.chat, turn], 40)
		},
		seed,
		snapshot: () =>
			({
				amounts: Array.map(
					Array.fromIterable(amounts),
					entry => [tileOf(entry[0]).x, tileOf(entry[0]).z, entry[1]] satisfies [number, number, number]
				),
				chat: Array.takeRight(state.chat, 40),
				edits: Array.map(Array.fromIterable(edits), entry => ({edit: entry[1], ...tileOf(entry[0])})),
				generator: GENERATOR,
				jobs: Array.map(Array.fromIterable(MutableHashMap.values(jobs)), job => ({
					action: job.action,
					crew: job.crew,
					done: job.done,
					id: job.id
				})),
				line: state.line,
				nextId: state.nextId,
				research: state.research,
				seed,
				stock: state.stock,
				units: Array.map(allUnits(), unit => ({
					cargo: unit.cargo,
					health: unit.health,
					id: unit.id,
					job: Option.getOrUndefined(unit.job),
					kind: unit.kind,
					material: Option.getOrUndefined(unit.material),
					x: unit.x,
					z: unit.z
				})),
				waypoints: state.waypoints
			}) satisfies Saved,
		// Advances the world to a time in fixed ticks, at most a second's worth at once.
		step: (at: number, from: number) => {
			state.shots = []
			const ticks = Number.clamp(Number.round((at - from) / 1000 / TICK, 0), {maximum: 20, minimum: 0})
			if (ticks > 0) Array.forEach(Array.range(1, ticks), tick)
		},
		summary,
		touch: (at: number) => {
			state.lastActive = at
		},
		units: () => Array.map(allUnits(), unitView)
	}
}
