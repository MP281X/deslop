import {Array, MutableHashMap, MutableList, Number, Option, Order, Record, String, pipe} from 'effect'
import type {Types} from 'effect'

import {
	CHUNK,
	CODES,
	CHUNK_TILES,
	FLAG_CARGO,
	FLAG_CONTROLLED,
	STATS,
	STRIDE,
	TEAM_COLORS,
	TILE,
	YIELD,
	bit,
	chunkKey,
	chunkOf,
	chunkTiles,
	hash,
	tileAt,
	tileIndex,
	describeMemory,
	explored,
	routineLabel,
	separation,
	whereFrom
} from '#services/game/lib/utils.ts'
import type {
	Action,
	DroneKind,
	EntityInfo,
	EntityKind,
	Explored,
	Hud,
	LogEntry,
	MemoryEntry,
	Point,
	Routine,
	Saved,
	SavedPlayer,
	Selector,
	Turn
} from '#services/game/schema.ts'

const ORE_PER_TILE = 40
// What each kind is built for, beyond Idle, Return and Goto; any other routine is refused.
const ROLES = {
	builder: ['Build'],
	core: [],
	glitch: [],
	guard: ['Escort', 'Patrol', 'Track'],
	hauler: ['Haul'],
	miner: ['Mine'],
	relay: [],
	scout: ['Explore', 'Patrol', 'Search', 'Track'],
	turret: [],
	wall: []
} satisfies Record<EntityKind, Routine['_tag'][]>
const DEFAULT_ROUTINES = {
	builder: {group: 'builders', routine: {_tag: 'Idle'}},
	guard: {group: 'escort', routine: {_tag: 'Escort', group: 'mining'}},
	hauler: {group: 'mining', routine: {_tag: 'Haul'}},
	miner: {group: 'mining', routine: {_tag: 'Mine'}},
	scout: {group: 'scouts', routine: {_tag: 'Explore'}}
} satisfies Record<DroneKind, {group: string; routine: Routine}>
const STARTING_FLEET = Array.map(
	['scout', 'scout', 'miner', 'miner', 'hauler', 'guard', 'guard', 'builder'] satisfies DroneKind[],
	(kind, index) => ({angle: (index / 8) * Math.PI * 2, kind})
)
const byDistance = Order.mapInput(Order.Number, (candidate: {distance: number}) => candidate.distance)
const byRecent = Order.mapInput(Order.Number, (entry: MemoryEntry) => -entry.updatedAt)

function water(x: number, z: number) {
	return tileAt(Math.floor(x), Math.floor(z)).kind === TILE.Water
}

type Task = {phase: 'none' | 'travel' | 'work' | 'deliver'; ref: number; since: number; x: number; z: number}

type Entity = {
	cargo: number
	cooldown: number
	firing: number
	group: string
	health: number
	heading: number
	id: number
	kind: EntityKind
	markX: number
	markZ: number
	owner: string
	routine: Routine
	steerUntil: number
	steerX: number
	steerZ: number
	task: Task
	version: number
	vx: number
	vz: number
	x: number
	z: number
}

type Player = Types.Mutable<SavedPlayer> & {connections: number; raidAt: number}

type Explore = {bits: Uint8Array; count: number; cx: number; cz: number; version: number}

type Team = {
	chunks: MutableHashMap.MutableHashMap<string, Explore>
	log: LogEntry[]
	memory: MutableHashMap.MutableHashMap<string, MemoryEntry>
	seen: MutableHashMap.MutableHashMap<string, number>
	seq: number
}

type Connection = {
	depleted: number
	explored: number
	hudAt: number
	known: MutableHashMap.MutableHashMap<number, number>
	player: string
	shots: number
}

export type WorldEvent =
	| {_tag: 'Encounter'; at: Point; name: string; other: string; player: string}
	| {_tag: 'Raid'; at: Point; player: string; route: string}

type Intent = {routine?: Routine; task?: Task; x: number; z: number}

type User = {id: string; name: string}

function toward(from: {x: number; z: number}, target: {x: number; z: number}, speed: number, slow: number) {
	const distance = Math.hypot(target.x - from.x, target.z - from.z)
	if (distance < 0.05) return {distance, x: 0, z: 0}
	const scale = (speed * Number.min(1, distance / slow)) / distance
	return {distance, x: (target.x - from.x) * scale, z: (target.z - from.z) * scale}
}

function cell(x: number, z: number) {
	return `${Math.floor(x / 16)}:${Math.floor(z / 16)}`
}

function routeKey(task: Task) {
	return `route:${Math.floor(task.x / 32)},${Math.floor(task.z / 32)}`
}

function slug(text: string) {
	return pipe(String.toLowerCase(text), String.replaceAll(/[^a-z0-9]+/gu, '-'), String.slice(0, 40))
}

function parseKey(key: string) {
	const [cx = 0, cz = 0] = Array.map(String.split(key, ','), part => Option.getOrElse(Number.parse(part), () => 0))
	return {cx, cz}
}

// How close to the core a unit counts as at the base: touching it, with room for a crowd at the door.
function dock(unit: {kind: EntityKind}) {
	return STATS.core.size + STATS[unit.kind].size + 1.2
}

function moving(kind: EntityKind) {
	return kind !== 'glitch' && STATS[kind].speed > 0
}

function routeHistory(entry?: MemoryEntry) {
	if (entry?._tag === 'RouteAssaulted') return {avoid: entry.avoid, count: entry.count, losses: entry.losses}
	return {avoid: false, count: 0, losses: 0}
}
function destinations(routine: Routine) {
	if (routine._tag === 'Goto') return [routine.target]
	if (routine._tag === 'Build') return [routine.at]
	if (routine._tag === 'Patrol') return [routine.center]
	return []
}

export function makeWorld(saved: Option.Option<Saved>) {
	const entities = MutableHashMap.empty<number, Entity>()
	const players = MutableHashMap.empty<string, Player>()
	// Each player's recent conversation with CORE; like the event log, it does not survive a restart.
	const chats = MutableHashMap.empty<string, Turn[]>()
	const teams = MutableHashMap.empty<string, Team>()
	const connections = MutableHashMap.empty<number, Connection>()
	const depleted = MutableHashMap.empty<string, number>()
	const depletedChunks = MutableHashMap.empty<string, Point[]>()
	const mined = MutableHashMap.empty<string, number>()
	const claims = MutableHashMap.empty<string, number>()
	const ores = MutableHashMap.empty<string, number[]>()
	const events = MutableList.make<WorldEvent>()
	const counters = {connection: 0, depletion: 0, id: 1, random: 0x9e_37_79_b9, shot: 0, tick: 0}
	const recent = {
		cells: Record.empty<string, Entity[]>(),
		depletions: Array.empty<{at: Point; seq: number}>(),
		owners: Record.empty<string, Entity[]>(),
		shots: Array.empty<{from: number; seq: number; to: number}>(),
		stale: true,
		teams: Record.empty<string, Entity[]>()
	}

	function random() {
		counters.random = (counters.random + 0x6d_2b_79_f5) | 0
		return hash(counters.random, counters.tick, counters.id)
	}

	function team(id: string) {
		return Option.getOrElse(MutableHashMap.get(teams, id), () => {
			const created: Team = {
				chunks: MutableHashMap.empty(),
				log: [],
				memory: MutableHashMap.empty(),
				seen: MutableHashMap.empty(),
				seq: 1
			}
			MutableHashMap.set(teams, id, created)
			return created
		})
	}

	function playerOf(id: string) {
		return Option.getOrUndefined(MutableHashMap.get(players, id))
	}

	function teamOf(owner: string) {
		return playerOf(owner)?.team ?? ''
	}

	function nameOf(owner: string) {
		return playerOf(owner)?.name ?? owner
	}

	function playerNamed(name: string) {
		return Array.findFirst(
			Array.fromIterable(MutableHashMap.values(players)),
			candidate => String.toLowerCase(candidate.name) === String.toLowerCase(name)
		)
	}

	function log(teamId: string, entry: LogEntry) {
		const target = team(teamId)
		target.log = Array.takeRight(Array.append(target.log, entry), 8)
		target.seq += 1
	}

	function remember(teamId: string, entry: MemoryEntry) {
		const target = team(teamId)
		MutableHashMap.set(target.memory, entry.key, entry)
		for (const item of Array.drop(Array.sort(Array.fromIterable(MutableHashMap.values(target.memory)), byRecent), 60)) {
			MutableHashMap.remove(target.memory, item.key)
		}
		target.seq += 1
	}

	function memoryOf(teamId: string, key: string) {
		return Option.getOrUndefined(MutableHashMap.get(team(teamId).memory, key))
	}

	function hostileTo(teamId: string, owner: string) {
		const entry = memoryOf(teamId, `standing:${owner}`)
		return entry?._tag === 'Standing' && entry.stance === 'hostile'
	}

	function spawn(kind: EntityKind, owner: string, at: Point, group: string, routine: Routine) {
		const id = counters.id
		counters.id += 1
		recent.stale = true
		MutableHashMap.set(entities, id, {
			cargo: 0,
			cooldown: 0,
			firing: 0,
			group,
			heading: 0,
			health: STATS[kind].health,
			id,
			kind,
			markX: Infinity,
			markZ: Infinity,
			owner,
			routine,
			steerUntil: 0,
			steerX: 0,
			steerZ: 0,
			task: {phase: 'none', ref: 0, since: counters.tick, x: at.x, z: at.z},
			version: 1,
			vx: 0,
			vz: 0,
			x: at.x,
			z: at.z
		})
		return id
	}

	function entityOf(id: number) {
		return Option.getOrUndefined(MutableHashMap.get(entities, id))
	}

	// The spatial cells and the owner and team indexes rebuild every tick, and on demand after a spawn or a loss.
	function reindex() {
		const all = Array.fromIterable(MutableHashMap.values(entities))
		recent.cells = Array.groupBy(all, entity => cell(entity.x, entity.z))
		recent.owners = Array.groupBy(all, entity => entity.owner)
		recent.teams = Array.groupBy(
			Array.filter(all, entity => entity.owner !== ''),
			entity => teamOf(entity.owner)
		)
		recent.stale = false
	}

	function owned(owner: string) {
		if (recent.stale) reindex()
		return recent.owners[owner] ?? []
	}

	function teamEntities(teamId: string) {
		if (recent.stale) reindex()
		return recent.teams[teamId] ?? []
	}

	function remove(id: number) {
		MutableHashMap.remove(entities, id)
		recent.stale = true
	}

	function nearby(x: number, z: number, radius: number) {
		if (recent.stale) reindex()
		const span = Math.ceil(radius / 16)
		return Array.flatMap(Array.range(-span, span), gx =>
			Array.flatMap(Array.range(-span, span), gz =>
				Array.filter(
					recent.cells[cell(x + gx * 16, z + gz * 16)] ?? [],
					candidate => Math.hypot(candidate.x - x, candidate.z - z) <= radius
				)
			)
		)
	}

	// Marks a sight disc row by row, looking each chunk up once per run of tiles; ground the team fully knows is skipped.
	function markExplored(teamId: string, center: Point, radius: number) {
		const target = team(teamId)
		const x = Math.floor(center.x)
		const z = Math.floor(center.z)
		const known = Array.every(
			Array.cartesian([chunkOf(x - radius), chunkOf(x + radius)], [chunkOf(z - radius), chunkOf(z + radius)]),
			pair =>
				Option.exists(
					MutableHashMap.get(target.chunks, chunkKey(pair[0], pair[1])),
					chunk => chunk.count >= CHUNK_TILES
				)
		)
		if (known) return
		target.seq += 1
		const cursor: {chunk?: Explore; cx: number; cz: number} = {cx: Infinity, cz: Infinity}
		for (const dz of Array.range(-radius, radius)) {
			const half = Math.floor(Math.sqrt(radius * radius - dz * dz))
			for (const tx of Array.range(x - half, x + half)) {
				if (cursor.chunk === undefined || cursor.cx !== chunkOf(tx) || cursor.cz !== chunkOf(z + dz)) {
					cursor.cx = chunkOf(tx)
					cursor.cz = chunkOf(z + dz)
					cursor.chunk = Option.getOrElse(MutableHashMap.get(target.chunks, chunkKey(cursor.cx, cursor.cz)), () => {
						const created = {bits: new Uint8Array(CHUNK_TILES / 8), count: 0, cx: cursor.cx, cz: cursor.cz, version: 0}
						MutableHashMap.set(target.chunks, chunkKey(cursor.cx, cursor.cz), created)
						return created
					})
				}
				const tile = tileIndex(tx, z + dz)
				const current = cursor.chunk.bits[tile >> 3] ?? 0
				if ((current & (1 << (tile & 7))) === 0) {
					cursor.chunk.bits.set([current | (1 << (tile & 7))], tile >> 3)
					cursor.chunk.count += 1
					cursor.chunk.version = target.seq
				}
			}
		}
	}

	function isExplored(teamId: string, x: number, z: number) {
		return pipe(
			MutableHashMap.get(team(teamId).chunks, chunkKey(chunkOf(x), chunkOf(z))),
			Option.exists(chunk => ((chunk.bits[tileIndex(x, z) >> 3] ?? 0) & (1 << (tileIndex(x, z) & 7))) !== 0)
		)
	}

	// Routes raided twice, or rerouted by CORE, are dangerous: miners pick ore away from them.
	function nearestOre(miner: Entity, base: Point) {
		const teamId = teamOf(miner.owner)
		const danger = Array.filter(
			Array.fromIterable(MutableHashMap.values(team(teamId).memory)),
			entry => entry._tag === 'RouteAssaulted' && (entry.avoid || entry.count >= 2)
		)
		return pipe(
			Array.cartesian(
				Array.range(chunkOf(base.x) - 3, chunkOf(base.x) + 3),
				Array.range(chunkOf(base.z) - 3, chunkOf(base.z) + 3)
			),
			Array.flatMap(pair =>
				// Ore tiles per chunk are generated once and cached.
				Array.map(
					Option.getOrElse(MutableHashMap.get(ores, chunkKey(pair[0], pair[1])), () => {
						const tiles = chunkTiles(pair[0], pair[1])
						const found = Array.filter(
							Array.range(0, CHUNK_TILES - 1),
							index => (YIELD[tiles.kinds[index] ?? 0] ?? 0) > 0
						)
						MutableHashMap.set(ores, chunkKey(pair[0], pair[1]), found)
						return found
					}),
					index => ({x: pair[0] * CHUNK + (index % CHUNK), z: pair[1] * CHUNK + Math.floor(index / CHUNK)})
				)
			),
			Array.filter(
				tile =>
					isExplored(teamId, tile.x, tile.z) &&
					!MutableHashMap.has(depleted, `${tile.x},${tile.z}`) &&
					Option.match(MutableHashMap.get(claims, `${tile.x},${tile.z}`), {
						onNone: () => true,
						onSome: claimant => claimant === miner.id || !MutableHashMap.has(entities, claimant)
					}) &&
					!Array.some(
						danger,
						entry => entry._tag === 'RouteAssaulted' && Math.hypot(entry.at.x - tile.x, entry.at.z - tile.z) < 24
					)
			),
			// Richer deposits are worth a longer trip: crystal three times ore pulls from √3 times as far.
			Array.map(tile => ({
				...tile,
				distance:
					Math.hypot(tile.x + 0.5 - miner.x, tile.z + 0.5 - miner.z) /
					Math.sqrt(YIELD[tileAt(tile.x, tile.z).kind] ?? 1)
			})),
			Array.sort(byDistance),
			Array.head
		)
	}

	// Depleted tiles are indexed by chunk too, so a team learns of them when it explores that chunk.
	function exhaust(key: string, tile: Point) {
		MutableHashMap.set(depleted, key, ORE_PER_TILE)
		MutableHashMap.modifyAt(depletedChunks, chunkKey(chunkOf(tile.x), chunkOf(tile.z)), points =>
			Option.some(
				Array.append(
					Option.getOrElse(points, () => []),
					tile
				)
			)
		)
	}

	// Returns whether the tile ran out.
	function mine(tile: Point, amount: number) {
		const key = `${tile.x},${tile.z}`
		const total = Option.getOrElse(MutableHashMap.get(mined, key), () => 0) + amount
		MutableHashMap.set(mined, key, total)
		if (total < ORE_PER_TILE) return false
		exhaust(key, tile)
		counters.depletion += 1
		recent.depletions = Array.append(Array.takeRight(recent.depletions, 200), {at: tile, seq: counters.depletion})
		return true
	}

	function update(id: number, patch: Partial<Pick<Entity, 'cargo' | 'group' | 'routine' | 'task'>>) {
		const target = entityOf(id)
		if (target === undefined) return
		target.cargo = patch.cargo ?? target.cargo
		target.group = patch.group ?? target.group
		target.task = patch.task ?? target.task
		if (patch.routine !== undefined) {
			target.routine = patch.routine
			target.task = {phase: 'none', ref: 0, since: counters.tick, x: target.x, z: target.z}
		}
		target.version += 1
	}

	function baseOf(drone: Entity) {
		return playerOf(drone.owner)?.base ?? {x: drone.x, z: drone.z}
	}

	function deposit(owner: string, amount: number) {
		const player = playerOf(owner)
		if (player !== undefined) player.ore += Math.floor(amount)
	}

	function roam(drone: Entity, speed: number, pick: () => Point) {
		if (drone.task.phase !== 'none' && Math.hypot(drone.task.x - drone.x, drone.task.z - drone.z) >= 2) {
			return toward(drone, drone.task, speed, 3)
		}
		const next = pick()
		return {...toward(drone, next, speed, 3), task: {...drone.task, phase: 'travel' as const, x: next.x, z: next.z}}
	}

	// Explorers favour unexplored ground near them, with a soft pull back toward the base.
	function frontier(drone: Entity, base: Point) {
		const teamId = teamOf(drone.owner)
		return pipe(
			Array.makeBy(5, () => {
				const angle = random() * Math.PI * 2
				const x = drone.x + Math.sin(angle) * (24 + random() * 32)
				const z = drone.z + Math.cos(angle) * (24 + random() * 32)
				return {
					distance:
						bit(isExplored(teamId, Math.floor(x), Math.floor(z))) +
						Math.hypot(x - base.x, z - base.z) / 450 +
						random() * 0.3,
					x,
					z
				}
			}),
			Array.sort(byDistance),
			Array.headNonEmpty
		)
	}

	function mineIntent(miner: Entity, speed: number) {
		const capacity = STATS[miner.kind].cargo
		if (miner.task.phase === 'deliver') {
			const step = toward(miner, baseOf(miner), speed, 3)
			if (step.distance > dock(miner)) return step
			deposit(miner.owner, miner.cargo)
			update(miner.id, {cargo: 0})
			return {task: {...miner.task, phase: 'none'}, x: 0, z: 0} satisfies Intent
		}
		if (miner.cargo >= capacity) {
			// Haulers collect from full miners; a miner nobody visits for 30 seconds carries its own load.
			const waited = counters.tick - miner.task.since > 600
			if (Array.some(owned(miner.owner), other => other.routine._tag === 'Haul') && !waited) return {x: 0, z: 0}
			return {task: {...miner.task, phase: 'deliver'}, x: 0, z: 0} satisfies Intent
		}
		if (miner.task.phase === 'none') {
			return Option.match(nearestOre(miner, baseOf(miner)), {
				onNone: () => ({routine: {_tag: 'Idle' as const}, x: 0, z: 0}),
				onSome: ore => {
					MutableHashMap.set(claims, `${ore.x},${ore.z}`, miner.id)
					return {
						task: {phase: 'travel' as const, ref: 0, since: counters.tick, x: ore.x + 0.5, z: ore.z + 0.5},
						x: 0,
						z: 0
					}
				}
			})
		}
		const step = toward(miner, miner.task, speed, 2)
		if (step.distance > 0.6) return step
		update(miner.id, {
			cargo: Number.min(
				capacity,
				miner.cargo + (1.5 / 20) * (YIELD[tileAt(Math.floor(miner.task.x), Math.floor(miner.task.z)).kind] ?? 0)
			)
		})
		if (mine({x: Math.floor(miner.task.x), z: Math.floor(miner.task.z)}, 1.5 / 20)) {
			return {task: {...miner.task, phase: 'none'}, x: 0, z: 0} satisfies Intent
		}
		return {task: {...miner.task, phase: 'work', since: counters.tick}, x: 0, z: 0} satisfies Intent
	}

	function haulIntent(hauler: Entity, speed: number) {
		if (hauler.task.phase === 'deliver' || hauler.cargo >= STATS.hauler.cargo * 0.8) {
			const step = toward(hauler, baseOf(hauler), speed, 3)
			if (step.distance > dock(hauler)) return {...step, task: {...hauler.task, phase: 'deliver'}} satisfies Intent
			deposit(hauler.owner, hauler.cargo)
			update(hauler.id, {cargo: 0})
			return {task: {...hauler.task, phase: 'none'}, x: 0, z: 0} satisfies Intent
		}
		const miner = pipe(
			owned(hauler.owner),
			Array.filter(other => other.kind === 'miner' && other.cargo >= 3),
			Array.map(other => ({distance: Math.hypot(other.x - hauler.x, other.z - hauler.z) - other.cargo * 4, other})),
			Array.sort(byDistance),
			Array.head,
			Option.map(found => found.other),
			Option.getOrUndefined
		)
		if (miner === undefined && hauler.cargo > 0) {
			return {task: {...hauler.task, phase: 'deliver'}, x: 0, z: 0} satisfies Intent
		}
		if (miner === undefined) return toward(hauler, {x: baseOf(hauler).x + 4, z: baseOf(hauler).z + 4}, speed, 3)
		const step = toward(hauler, miner, speed, 3)
		if (step.distance > 1.6) {
			return {...step, task: {...hauler.task, phase: 'travel', ref: miner.id, x: miner.x, z: miner.z}} satisfies Intent
		}
		const moved = Number.min(miner.cargo, STATS.hauler.cargo - hauler.cargo)
		update(miner.id, {cargo: miner.cargo - moved, task: {...miner.task, since: counters.tick}})
		update(hauler.id, {cargo: hauler.cargo + moved})
		return {x: 0, z: 0}
	}

	function escortIntent(guard: Entity, speed: number, group: string) {
		const wards = Array.filter(
			owned(guard.owner),
			other => other.group === group && other.kind !== 'guard' && moving(other.kind)
		)
		const ward = wards[guard.id % Number.max(1, wards.length)]
		if (ward === undefined) return toward(guard, {x: baseOf(guard).x - 3, z: baseOf(guard).z + 3}, speed, 3)
		const angle = (guard.id % 6) * (Math.PI / 3)
		return toward(guard, {x: ward.x + Math.sin(angle) * 2.5, z: ward.z + Math.cos(angle) * 2.5}, speed * 1.15, 4)
	}

	function buildIntent(builder: Entity, speed: number, routine: Extract<Routine, {_tag: 'Build'}>, now: number) {
		const step = toward(builder, routine.at, speed, 2)
		if (step.distance > 1) return step
		const player = playerOf(builder.owner)
		const cost = STATS[routine.structure].cost
		if (player === undefined || player.ore < cost) {
			log(teamOf(builder.owner), {
				at: routine.at,
				drone: builder.id,
				text: `${CODES.builder}-${builder.id} needs ${cost} ore for a ${routine.structure}`,
				time: now,
				tone: 'info'
			})
			return {routine: {_tag: 'Idle'}, x: 0, z: 0} satisfies Intent
		}
		player.ore -= cost
		spawn(
			routine.structure,
			builder.owner,
			{x: Math.floor(routine.at.x) + 0.5, z: Math.floor(routine.at.z) + 0.5},
			'structures',
			{_tag: 'Idle'}
		)
		log(player.team, {at: routine.at, text: `${routine.structure} built`, time: now, tone: 'info'})
		return {routine: {_tag: 'Idle'}, x: 0, z: 0} satisfies Intent
	}

	function trackIntent(tracker: Entity, speed: number, name: string) {
		const target = pipe(
			playerNamed(name),
			Option.flatMap(player =>
				Array.findFirst(
					nearby(tracker.x, tracker.z, STATS[tracker.kind].sight),
					other => other.owner === player.id && other.kind !== 'glitch'
				)
			),
			Option.getOrUndefined
		)
		if (target !== undefined) {
			const step = toward(tracker, target, speed, 6)
			if (step.distance < STATS[tracker.kind].sight * 0.6) return {x: 0, z: 0}
			return step
		}
		const last = pipe(
			playerNamed(name),
			Option.map(player => memoryOf(teamOf(tracker.owner), `seen:${player.id}`)),
			Option.getOrUndefined
		)
		if (last?._tag !== 'Sighting') return {routine: {_tag: 'Search', player: name}, x: 0, z: 0} satisfies Intent
		const step = toward(tracker, last.at, speed, 3)
		if (step.distance < 3) return {routine: {_tag: 'Search', player: name}, x: 0, z: 0} satisfies Intent
		return step
	}

	function glitchIntent(glitch: Entity, speed: number) {
		const prey = pipe(
			nearby(glitch.x, glitch.z, STATS.glitch.sight),
			Array.filter(other => other.kind !== 'glitch'),
			Array.map(other => ({
				distance: Math.hypot(other.x - glitch.x, other.z - glitch.z) - bit(other.id === glitch.task.ref) * 6,
				other
			})),
			Array.sort(byDistance),
			Array.head,
			Option.map(found => found.other),
			Option.orElse(() => MutableHashMap.get(entities, glitch.task.ref)),
			Option.getOrUndefined
		)
		if (prey === undefined) return toward(glitch, glitch.task, speed * 0.6, 3)
		return toward(glitch, prey, speed, 1.5)
	}

	function searchPoint(base: Point, since: number) {
		const radius = Number.min(3000, 80 + (counters.tick - since) / 5)
		const angle = random() * Math.PI * 2
		const distance = radius * (0.4 + random() * 0.6)
		return {x: base.x + Math.sin(angle) * distance, z: base.z + Math.cos(angle) * distance}
	}

	// A drone has arrived within reach, or nearby once others crowding the spot hold it still.
	function arrive(drone: Entity, target: Point, speed: number, reach: number) {
		const step = toward(drone, target, speed, 3)
		if (step.distance < reach || (step.distance < reach + 3 && Math.hypot(drone.vx, drone.vz) < 0.4)) {
			return {routine: {_tag: 'Idle'}, x: 0, z: 0} satisfies Intent
		}
		return step
	}

	function patrolPoint(routine: Extract<Routine, {_tag: 'Patrol'}>) {
		const angle = random() * Math.PI * 2
		return {
			x: routine.center.x + Math.sin(angle) * routine.radius,
			z: routine.center.z + Math.cos(angle) * routine.radius
		}
	}

	function routineIntent(drone: Entity, speed: number, routine: Routine, now: number) {
		if (routine._tag === 'Goto') return arrive(drone, routine.target, speed, 1.5)
		if (routine._tag === 'Return') return arrive(drone, baseOf(drone), speed, dock(drone))
		if (routine._tag === 'Explore') return roam(drone, speed, () => frontier(drone, baseOf(drone)))
		if (routine._tag === 'Search') return roam(drone, speed, () => searchPoint(baseOf(drone), drone.task.since))
		if (routine._tag === 'Track') return trackIntent(drone, speed, routine.player)
		if (routine._tag === 'Patrol') return roam(drone, speed, () => patrolPoint(routine))
		if (routine._tag === 'Mine') return mineIntent(drone, speed)
		if (routine._tag === 'Haul') return haulIntent(drone, speed)
		if (routine._tag === 'Escort') return escortIntent(drone, speed, routine.group)
		if (routine._tag === 'Build') return buildIntent(drone, speed, routine, now)
		return {x: 0, z: 0}
	}

	function intent(drone: Entity, now: number) {
		const speed = STATS[drone.kind].speed
		if (speed === 0) return {x: 0, z: 0}
		if (drone.steerUntil > now) return {x: drone.steerX * speed, z: drone.steerZ * speed}
		if (drone.kind === 'glitch') return glitchIntent(drone, speed)
		return routineIntent(drone, speed, drone.routine, now)
	}

	function hostile(attacker: Entity, other: Entity) {
		if (attacker.kind === 'glitch') return other.kind !== 'glitch'
		if (other.kind === 'glitch') return true
		const teamId = teamOf(attacker.owner)
		return teamId !== teamOf(other.owner) && hostileTo(teamId, other.owner)
	}

	function raided(victim: Entity, now: number) {
		const teamId = teamOf(victim.owner)
		const key = routeKey(victim.task)
		const known = memoryOf(teamId, key)
		if (known !== undefined && now - known.updatedAt < 20_000) return
		const history = routeHistory(known)
		remember(teamId, {
			_tag: 'RouteAssaulted',
			at: {x: victim.x, z: victim.z},
			avoid: history.avoid,
			count: history.count + 1,
			key,
			losses: history.losses,
			updatedAt: now
		})
		MutableList.append(events, {_tag: 'Raid', at: {x: victim.x, z: victim.z}, player: victim.owner, route: key})
		log(teamId, {
			at: {x: victim.x, z: victim.z},
			drone: victim.id,
			text: `${CODES.hauler}-${victim.id} raided`,
			time: now,
			tone: 'alert'
		})
	}

	// Whoever shoots at the team becomes hostile to it, so its guards answer on sight from then on.
	function attackedBy(attacker: Entity, victim: Entity, now: number) {
		const teamId = teamOf(victim.owner)
		if (hostileTo(teamId, attacker.owner)) return
		remember(teamId, {
			_tag: 'Standing',
			key: `standing:${attacker.owner}`,
			player: nameOf(attacker.owner),
			reason: `attacked ${victim.kind}-${victim.id} near ${Math.floor(victim.x)},${Math.floor(victim.z)}`,
			stance: 'hostile',
			updatedAt: now
		})
		log(teamId, {
			at: {x: victim.x, z: victim.z},
			drone: victim.id,
			text: `${nameOf(attacker.owner)} attacked ${CODES[victim.kind]}-${victim.id} · now hostile`,
			time: now,
			tone: 'alert'
		})
	}

	function destroyed(victim: Entity, now: number) {
		remove(victim.id)
		if (victim.owner === '') return
		const teamId = teamOf(victim.owner)
		log(teamId, {
			at: {x: victim.x, z: victim.z},
			text: `${CODES[victim.kind]}-${victim.id} destroyed`,
			time: now,
			tone: 'alert'
		})
		const known = memoryOf(teamId, routeKey(victim.task))
		if (victim.kind === 'hauler' && known?._tag === 'RouteAssaulted') {
			remember(teamId, {...known, losses: known.losses + 1, updatedAt: now})
		}
	}

	function hit(attacker: Entity, id: number, damage: number, now: number) {
		const victim = entityOf(id)
		if (victim === undefined) return
		if (attacker.kind === 'glitch' && victim.kind === 'hauler') raided(victim, now)
		if (attacker.owner !== '' && victim.owner !== '' && teamOf(attacker.owner) !== teamOf(victim.owner)) {
			attackedBy(attacker, victim, now)
		}
		victim.health -= damage
		if (victim.health <= 0 && victim.kind !== 'core') destroyed(victim, now)
	}

	function combat(dt: number, now: number) {
		for (const shooter of Array.fromIterable(MutableHashMap.values(entities))) {
			shooter.cooldown = Number.max(0, shooter.cooldown - dt)
			shooter.firing = 0
			const target = pipe(
				Option.liftPredicate(shooter, armed => STATS[armed.kind].damage > 0 && armed.cooldown <= 0),
				Option.flatMap(armed =>
					pipe(
						nearby(armed.x, armed.z, STATS[armed.kind].range),
						Array.filter(other => other.id !== armed.id && hostile(armed, other)),
						Array.map(other => ({distance: Math.hypot(other.x - armed.x, other.z - armed.z), other})),
						Array.sort(byDistance),
						Array.head
					)
				),
				Option.map(found => found.other),
				Option.getOrUndefined
			)
			if (target !== undefined) {
				shooter.cooldown = 0.5
				shooter.firing = target.id
				counters.shot += 1
				recent.shots = Array.append(Array.takeRight(recent.shots, 400), {
					from: shooter.id,
					seq: counters.shot,
					to: target.id
				})
				hit(shooter, target.id, STATS[shooter.kind].damage * 0.5, now)
			}
		}
	}

	// Hard mode: glitch raiders hunt a working hauler of every player every minute or so, half as often while they are away.
	function raid(owner: string, now: number) {
		const player = playerOf(owner)
		const haulers = Array.filter(owned(owner), drone => drone.kind === 'hauler' && drone.routine._tag === 'Haul')
		const prey = haulers[Math.floor(random() * haulers.length)]
		if (player === undefined || prey === undefined) return
		if (now - player.raidAt < 75_000 * (1 + bit(player.connections === 0))) return
		player.raidAt = now + random() * 30_000
		const angle = random() * Math.PI * 2
		for (const index of Array.range(1, 2 + Math.floor(random() * 3))) {
			update(
				spawn(
					'glitch',
					'',
					{x: prey.x + Math.sin(angle) * 26 + index, z: prey.z + Math.cos(angle) * 26 - index},
					'raid',
					{_tag: 'Idle'}
				),
				{task: {phase: 'travel', ref: prey.id, since: counters.tick, x: prey.x, z: prey.z}}
			)
		}
	}

	function raids(now: number) {
		for (const owner of Array.fromIterable(MutableHashMap.keys(players))) raid(owner, now)
		for (const glitch of Array.fromIterable(MutableHashMap.values(entities))) {
			if (glitch.kind === 'glitch' && counters.tick - glitch.task.since > 3000) {
				remove(glitch.id)
			}
		}
	}

	function sighted(teamId: string, unit: Entity, other: Entity, now: number) {
		const target = team(teamId)
		const last = Option.getOrElse(MutableHashMap.get(target.seen, other.owner), () => 0)
		if (now - last <= 10_000) return
		MutableHashMap.set(target.seen, other.owner, now)
		remember(teamId, {
			_tag: 'Sighting',
			at: {x: other.x, z: other.z},
			key: `seen:${other.owner}`,
			player: nameOf(other.owner),
			updatedAt: now,
			what: `${other.kind} seen by ${unit.kind}-${unit.id}`
		})
		// Scouts searching for this player switch to tracking it.
		for (const searcher of teamEntities(teamId)) {
			if (
				searcher.routine._tag === 'Search' &&
				String.toLowerCase(searcher.routine.player) === String.toLowerCase(nameOf(other.owner))
			) {
				update(searcher.id, {routine: {_tag: 'Track', player: nameOf(other.owner)}})
			}
		}
		if (now - last <= 300_000) return
		log(teamId, {
			at: {x: other.x, z: other.z},
			drone: unit.id,
			text: `${CODES[unit.kind]}-${unit.id} spotted ${nameOf(other.owner)}`,
			time: now,
			tone: 'info'
		})
		MutableList.append(events, {
			_tag: 'Encounter',
			at: {x: other.x, z: other.z},
			name: nameOf(other.owner),
			other: other.owner,
			player: unit.owner
		})
	}

	function sightings(now: number) {
		for (const unit of Array.fromIterable(MutableHashMap.values(entities))) {
			const teamId = teamOf(unit.owner)
			const strangers = Array.filter(
				nearby(unit.x, unit.z, STATS[unit.kind].sight),
				other => unit.owner !== '' && other.owner !== '' && teamOf(other.owner) !== teamId
			)
			for (const other of strangers) sighted(teamId, unit, other, now)
		}
	}

	function move(id: number, now: number) {
		const target = entityOf(id)
		if (target === undefined) return
		const wanted: Intent = intent(target, now)
		if (wanted.routine !== undefined) update(id, {routine: wanted.routine})
		target.task = wanted.task ?? target.task
		target.vx += (wanted.x - target.vx) * (1 - Math.exp(-7 / 20))
		target.vz += (wanted.z - target.vz) * (1 - Math.exp(-7 / 20))
		const give = bit(STATS[target.kind].speed > 0)
		target.x += (target.vx / 20) * give
		target.z += (target.vz / 20) * give
		// After its step a moving unit parts from whatever it overlaps, so nothing stacks or sits inside the core.
		const push = separation(
			{id, mobile: true, size: STATS[target.kind].size, x: target.x, z: target.z},
			Array.map(nearby(target.x, target.z, 5), other => ({
				id: other.id,
				mobile: STATS[other.kind].speed > 0,
				size: STATS[other.kind].size,
				x: other.x,
				z: other.z
			}))
		)
		target.x += push.x * give
		target.z += push.z * give
		if (Math.hypot(target.vx, target.vz) > 0.3) target.heading = Math.atan2(target.vx, target.vz)
		// The flown drone sees twice as far; sight is re-marked after a quarter radius, which leaves no gaps.
		const sight = STATS[target.kind].sight * (1 + bit(target.steerUntil > now))
		const moved = Math.hypot(target.x - target.markX, target.z - target.markZ)
		if (target.owner === '' || moved <= Number.max(1.5, sight / 4)) return
		target.markX = target.x
		target.markZ = target.z
		markExplored(teamOf(target.owner), target, sight)
	}

	// A base lands on the nearest dry 9 by 9 square whose 33 by 33 surroundings are at most a tenth water.
	function landing(inviter?: Player) {
		const chosen = site(inviter)
		const square = Array.cartesian(Array.range(-4, 4), Array.range(-4, 4))
		return Option.getOrElse(
			Array.findFirst(
				Array.flatMap(Array.range(0, 50), ring =>
					Array.makeBy(Number.max(1, ring * 6), step => {
						const angle = (step / Number.max(1, ring * 6)) * Math.PI * 2
						return {
							x: Math.floor(chosen.x + Math.sin(angle) * ring * 4) + 0.5,
							z: Math.floor(chosen.z + Math.cos(angle) * ring * 4) + 0.5
						}
					})
				),
				point =>
					Array.every(square, offset => !water(point.x + offset[0], point.z + offset[1])) &&
					Array.length(Array.filter(square, offset => water(point.x + offset[0] * 4, point.z + offset[1] * 4))) <= 8
			),
			() => chosen
		)
	}

	// Strangers land at least 1,500 tiles from every base, searching farther out as the world fills; an invite lands next to the inviter.
	function site(inviter?: Player) {
		if (inviter !== undefined) return {x: inviter.base.x + 22, z: inviter.base.z + 6}
		if (MutableHashMap.isEmpty(players)) return {x: 0.5, z: 0.5}
		const bases = Array.map(Array.fromIterable(MutableHashMap.values(players)), other => other.base)
		const candidates = Array.makeBy(48, attempt => {
			const angle = random() * Math.PI * 2
			const distance = (2500 + random() * 2500) * (1 + Math.floor(attempt / 8) * 0.5)
			return {x: Math.floor(Math.sin(angle) * distance) + 0.5, z: Math.floor(Math.cos(angle) * distance) + 0.5}
		})
		// Past the farthest base by 1,500 tiles is always far enough from every base.
		return Option.getOrElse(
			Array.findFirst(candidates, point =>
				Array.every(bases, base => Math.hypot(base.x - point.x, base.z - point.z) >= 1500)
			),
			() => {
				const angle = random() * Math.PI * 2
				const distance = Array.reduce(bases, 0, (reach, base) => Number.max(reach, Math.hypot(base.x, base.z))) + 1500
				return {x: Math.floor(Math.sin(angle) * distance) + 0.5, z: Math.floor(Math.cos(angle) * distance) + 0.5}
			}
		)
	}

	// Someone already playing who opens an invite moves their whole base next to the inviter and joins the team.
	function transfer(id: string, inviter: Player, now: number) {
		const player = playerOf(id)
		if (player === undefined) return
		const target = landing(inviter)
		for (const entity of owned(player.id)) {
			entity.x += target.x - player.base.x
			entity.z += target.z - player.base.z
			entity.markX = Infinity
			update(entity.id, {routine: entity.routine})
		}
		player.color =
			Array.length(
				Array.filter(Array.fromIterable(MutableHashMap.values(players)), other => other.team === inviter.team)
			) % TEAM_COLORS.length
		player.team = inviter.team
		player.base = target
		recent.stale = true
		for (const connection of MutableHashMap.values(connections)) {
			if (connection.player === player.id) connection.explored = 0
		}
		markExplored(inviter.team, target, 24)
		log(inviter.team, {at: target, text: `${player.name} joined`, time: now, tone: 'info'})
	}

	function join(user: User, now: number, invite?: string) {
		const inviter = pipe(
			Option.fromUndefinedOr(invite),
			Option.flatMap(code =>
				Array.findFirst(Array.fromIterable(MutableHashMap.values(players)), other => other.team === code)
			),
			Option.getOrUndefined
		)
		const existing = playerOf(user.id)
		if (existing !== undefined) {
			existing.activeAt = now
			existing.name = user.name
			if (inviter !== undefined && inviter.team !== existing.team) transfer(existing.id, inviter, now)
			return existing
		}
		const base = landing(inviter)
		const teamId =
			inviter?.team ??
			Array.join(
				Array.makeBy(6, () => '23456789abcdefghjkmnpqrstuvwxyz'[Math.floor(random() * 31)] ?? 'x'),
				''
			)
		const player: Player = {
			activeAt: now,
			base,
			color:
				Array.length(Array.filter(Array.fromIterable(MutableHashMap.values(players)), other => other.team === teamId)) %
				TEAM_COLORS.length,
			connections: 0,
			id: user.id,
			name: user.name,
			ore: 120,
			raidAt: now + 120_000,
			team: teamId
		}
		MutableHashMap.set(players, user.id, player)
		spawn('core', user.id, base, 'base', {_tag: 'Idle'})
		for (const start of STARTING_FLEET) {
			spawn(
				start.kind,
				user.id,
				{x: base.x + Math.sin(start.angle) * 4, z: base.z + Math.cos(start.angle) * 4},
				DEFAULT_ROUTINES[start.kind].group,
				DEFAULT_ROUTINES[start.kind].routine
			)
		}
		markExplored(teamId, base, 24)
		log(teamId, {at: base, text: `${user.name} landed`, time: now, tone: 'info'})
		return player
	}

	function visible(teamId: string) {
		const units = teamEntities(teamId)
		const seen = MutableHashMap.fromIterable(Array.map(units, unit => [unit.id, unit] as const))
		for (const unit of units) {
			for (const other of nearby(unit.x, unit.z, STATS[unit.kind].sight)) MutableHashMap.set(seen, other.id, other)
		}
		return Array.fromIterable(MutableHashMap.values(seen))
	}

	function info(entity: Entity) {
		return {
			cargo: Math.floor(entity.cargo),
			color: playerOf(entity.owner)?.color ?? 0,
			group: entity.group,
			id: entity.id,
			kind: entity.kind,
			owner: playerOf(entity.owner)?.name ?? '',
			routine: routineLabel(entity.routine)
		} satisfies EntityInfo
	}

	function hud(player: Player, core: Hud['core']) {
		const target = team(player.team)
		return {
			base: player.base,
			chat: Option.getOrElse(MutableHashMap.get(chats, player.id), () => []),
			core,
			invite: player.team,
			log: target.log,
			memory: Array.sort(Array.fromIterable(MutableHashMap.values(target.memory)), byRecent),
			ore: player.ore,
			players: Array.map(Array.fromIterable(MutableHashMap.values(players)), other => other.name),
			team: Array.map(
				Array.filter(Array.fromIterable(MutableHashMap.values(players)), other => other.team === player.team),
				member => ({color: member.color, name: member.name, online: member.connections > 0})
			),
			you: player.name
		} satisfies Hud
	}

	function exploredSince(target: Team, since: number) {
		return Array.map(
			Array.filter(Array.fromIterable(target.chunks), entry => entry[1].version > since),
			entry => ({...parseKey(entry[0]), bits: Uint8Array.from(entry[1].bits)})
		) satisfies Explored[]
	}

	function frame(id: number, now: number, core: Hud['core']) {
		const connection = Option.getOrUndefined(MutableHashMap.get(connections, id))
		const player = playerOf(connection?.player ?? '')
		if (connection === undefined || player === undefined) return undefined
		const target = team(player.team)
		const seen = visible(player.team)
		const positions = new Float32Array(seen.length * STRIDE)
		Array.forEach(seen, (entity, index) =>
			positions.set(
				[
					entity.id,
					entity.x,
					entity.z,
					entity.heading,
					entity.health / STATS[entity.kind].health,
					bit(entity.cargo > 0) * FLAG_CARGO + bit(entity.steerUntil > now) * FLAG_CONTROLLED
				],
				index * STRIDE
			)
		)
		const changed = Array.filter(
			seen,
			entity => !Option.contains(MutableHashMap.get(connection.known, entity.id), entity.version)
		)
		for (const entity of changed) MutableHashMap.set(connection.known, entity.id, entity.version)
		const ids = MutableHashMap.fromIterable(Array.map(seen, entity => [entity.id, true] as const))
		const gone = Array.filter(
			Array.fromIterable(MutableHashMap.keys(connection.known)),
			known => !MutableHashMap.has(ids, known)
		)
		for (const known of gone) MutableHashMap.remove(connection.known, known)
		const discovered = exploredSince(target, connection.explored)
		const shots = Array.filter(recent.shots, shot => shot.seq > connection.shots && MutableHashMap.has(ids, shot.from))
		// A team learns of depleted ore only on ground it has explored: live changes there, and the history of each chunk it explores.
		const depletions = Array.appendAll(
			Array.map(
				Array.filter(
					recent.depletions,
					depletion => depletion.seq > connection.depleted && isExplored(player.team, depletion.at.x, depletion.at.z)
				),
				depletion => depletion.at
			),
			Array.flatMap(discovered, chunk =>
				Option.getOrElse(MutableHashMap.get(depletedChunks, chunkKey(chunk.cx, chunk.cz)), () => [])
			)
		)
		const withHud = now - connection.hudAt > 1000
		connection.explored = target.seq
		connection.shots = counters.shot
		connection.depleted = counters.depletion
		if (withHud) connection.hudAt = now
		const base = {
			at: now,
			depleted: depletions,
			entities: Array.map(changed, info),
			explored: discovered,
			gone,
			positions: new Uint8Array(positions.buffer),
			shots: Array.map(shots, shot => [shot.from, shot.to] as const)
		}
		// The HUD rides along once a second; positions every frame.
		return {...base, ...(withHud && {hud: hud(player, core)})}
	}

	function select(owner: string, selector: Selector) {
		const matched = Array.filter(
			owned(owner),
			drone =>
				moving(drone.kind) &&
				// Models fill unused selector fields with empty values; those select nothing.
				(Array.isReadonlyArrayEmpty(selector.ids ?? []) || Array.contains(selector.ids ?? [], drone.id)) &&
				(String.isEmpty(selector.group ?? '') || drone.group === selector.group) &&
				(selector.kind === undefined || drone.kind === selector.kind)
		)
		return Array.take(matched, selector.count ?? matched.length)
	}

	// A destination must be somewhere the team has seen or remembers: nobody flies to coordinates it could not know.
	function reachable(teamId: string, point: Point) {
		return (
			isExplored(teamId, Math.floor(point.x), Math.floor(point.z)) ||
			Array.some(
				Array.fromIterable(MutableHashMap.values(team(teamId).memory)),
				entry =>
					(entry._tag === 'Place' || entry._tag === 'Sighting') &&
					Math.hypot(entry.at.x - point.x, entry.at.z - point.z) < 12
			)
		)
	}

	function assign(player: Player, action: Extract<Action, {_tag: 'Assign'}>) {
		if (Array.some(destinations(action.routine), point => !reachable(player.team, point))) {
			return {ids: [], ok: false, summary: 'that location is unknown to the team'}
		}
		// The selector's set fields, as the player would read them; an empty selector would match the whole fleet, which no single order means.
		const named = [
			...Array.map(
				Array.filter([action.selector.ids ?? []], Array.isReadonlyArrayNonEmpty),
				ids =>
					`id ${Array.join(
						Array.map(ids, id => `${id}`),
						'/'
					)}`
			),
			...Option.toArray(Option.fromUndefinedOr(action.selector.kind)),
			...Array.map(Array.filter([action.selector.group ?? ''], String.isNonEmpty), group => `in ${group}`)
		]
		if (Array.isArrayEmpty(named)) return {ids: [], ok: false, summary: 'name the drones by ids, group or kind'}
		const matched = select(player.id, action.selector)
		if (!Array.isReadonlyArrayNonEmpty(matched)) {
			return {ids: [], ok: false, summary: `no drone is ${Array.join(named, ' and ')}`}
		}
		const chosen = Array.filter(matched, drone =>
			Array.contains(['Idle', 'Return', 'Goto', ...ROLES[drone.kind]], action.routine._tag)
		)
		if (!Array.isReadonlyArrayNonEmpty(chosen)) {
			return {ids: [], ok: false, summary: `no selected drone can ${routineLabel(action.routine)}`}
		}
		// An order hands a drone you are flying back to its routine.
		for (const drone of chosen) {
			update(drone.id, {group: action.group ?? drone.group, routine: action.routine})
			drone.steerUntil = 0
		}
		return {
			ids: Array.map(chosen, drone => drone.id),
			ok: true,
			summary: `${Array.join(
				Array.map(Array.take(chosen, 4), drone => `${CODES[drone.kind]}-${drone.id}`),
				', '
			)}${Array.join(
				Array.filter([` +${chosen.length - 4}`], () => chosen.length > 4),
				''
			)} → ${String.toLowerCase(routineLabel(action.routine))}`
		}
	}

	function fabricate(owner: string, action: Extract<Action, {_tag: 'Fabricate'}>, now: number) {
		const player = playerOf(owner)
		if (player === undefined) return {ok: false, summary: 'unknown player'}
		const fleet = Array.length(Array.filter(owned(player.id), drone => moving(drone.kind)))
		const count = Number.clamp(Math.floor(action.count), {maximum: Number.max(0, 80 - fleet), minimum: 0})
		const built = Number.min(count, Math.floor(player.ore / STATS[action.kind].cost))
		if (built <= 0) return {ok: false, summary: `cannot fabricate ${action.kind}: not enough ore or the fleet is full`}
		for (const index of Array.range(1, built)) {
			const angle = random() * Math.PI * 2
			spawn(
				action.kind,
				player.id,
				{x: player.base.x + Math.sin(angle) * (3 + index * 0.1), z: player.base.z + Math.cos(angle) * 3},
				DEFAULT_ROUTINES[action.kind].group,
				DEFAULT_ROUTINES[action.kind].routine
			)
		}
		player.ore -= built * STATS[action.kind].cost
		log(player.team, {text: `fabricated ${built} ${action.kind}`, time: now, tone: 'info'})
		return {ok: true, summary: `fabricated ${built}/${count} ${action.kind}`}
	}

	function rememberAction(player: Player, action: Extract<Action, {_tag: 'Remember'}>, now: number) {
		const named = Option.getOrUndefined(Option.flatMap(Option.fromUndefinedOr(action.player), playerNamed))
		if (action.stance !== undefined && named !== undefined) {
			remember(player.team, {
				_tag: 'Standing',
				key: `standing:${named.id}`,
				player: named.name,
				reason: action.text,
				stance: action.stance,
				updatedAt: now
			})
			return {ok: true, summary: `${named.name} marked ${action.stance}`}
		}
		if (action.at !== undefined && action.name !== undefined) {
			remember(player.team, {
				_tag: 'Place',
				at: action.at,
				key: `place:${slug(action.name)}`,
				name: action.name,
				updatedAt: now
			})
			return {ok: true, summary: `saved place ${action.name}`}
		}
		remember(player.team, {
			_tag: 'Note',
			...(action.at !== undefined && {at: action.at}),
			key: `note:${slug(action.text)}`,
			text: action.text,
			updatedAt: now
		})
		return {ok: true, summary: 'noted'}
	}

	function relocate(owner: string, target: Point, now: number) {
		const player = playerOf(owner)
		if (player === undefined) return {ok: false, summary: 'unknown player'}
		if (!reachable(player.team, target)) return {ok: false, summary: 'that location is unknown to the team'}
		if (player.ore < 100) return {ok: false, summary: 'relocating the base costs 100 ore'}
		player.ore -= 100
		player.base = target
		const core = Option.getOrUndefined(Array.findFirst(owned(player.id), structure => structure.kind === 'core'))
		if (core !== undefined) {
			core.x = target.x
			core.z = target.z
		}
		markExplored(player.team, target, 24)
		log(player.team, {at: target, text: 'base relocated', time: now, tone: 'info'})
		return {ok: true, summary: 'base relocated'}
	}

	// ids are the drones an order moved.
	function act(owner: string, action: Action, now: number) {
		const player = playerOf(owner)
		if (player === undefined) return {ids: [], ok: false, summary: 'unknown player'}
		if (action._tag === 'Assign') return assign(player, action)
		if (action._tag === 'Fabricate') return {ids: [], ...fabricate(owner, action, now)}
		if (action._tag === 'Remember') return {ids: [], ...rememberAction(player, action, now)}
		if (action._tag === 'Relocate') return {ids: [], ...relocate(owner, action.target, now)}
		const removed = MutableHashMap.has(team(player.team).memory, action.key)
		MutableHashMap.remove(team(player.team).memory, action.key)
		team(player.team).seq += 1
		return {ids: [], ok: removed, summary: `forgot ${action.key}`}
	}

	// The farthest explored tile each way: real destinations for "go north", since screen up is -z.
	function farthest(teamId: string, base: Point) {
		const edge = {east: base, north: base, south: base, west: base}
		for (const chunk of MutableHashMap.values(team(teamId).chunks)) {
			for (const tile of Array.filter(Array.range(0, CHUNK_TILES - 1), index => explored(chunk.bits, index))) {
				const point = {x: chunk.cx * CHUNK + (tile % CHUNK), z: chunk.cz * CHUNK + Math.floor(tile / CHUNK)}
				if (point.z < edge.north.z) edge.north = point
				if (point.z > edge.south.z) edge.south = point
				if (point.x > edge.east.x) edge.east = point
				if (point.x < edge.west.x) edge.west = point
			}
		}
		return edge
	}

	// What CORE knows when it plans: the drone the signal is on, the fleet with positions, the explored edges, memory and events.
	function summary(owner: string, drone?: number) {
		const player = playerOf(owner)
		if (player === undefined) return ''
		const viewer = Option.filter(Option.fromUndefinedOr(entityOf(drone ?? -1)), unit => unit.owner === owner)
		// Directions in the context count from the drone the player is on, so CORE can answer in the player's frame.
		const origin = Option.getOrElse(viewer, () => player.base)
		const groups = pipe(
			owned(owner),
			Array.filter(unit => moving(unit.kind)),
			Array.groupBy(unit => `${unit.group}: ${unit.kind} ${routineLabel(unit.routine)}`),
			Record.toEntries,
			Array.map(
				entry =>
					`- ${entry[0]} ×${entry[1].length}: ${Array.join(
						Array.map(
							Array.take(entry[1], 8),
							unit =>
								`${CODES[unit.kind]}-${unit.id} (id ${unit.id}) at ${Math.floor(unit.x)},${Math.floor(unit.z)}, ${whereFrom(origin, unit)}`
						),
						'; '
					)}`
			)
		)
		const focused = Option.match(viewer, {
			onNone: () => 'The player is looking at the base; directions count from it.',
			onSome: unit =>
				`The player is on ${CODES[unit.kind]}-${unit.id} (${unit.kind}, id ${unit.id}) at ${Math.floor(unit.x)},${Math.floor(unit.z)}, ${routineLabel(unit.routine)}, ${whereFrom(player.base, unit)} from base. "Here", "this drone" and "me" mean it; directions count from it.`
		})
		const structures = Array.map(
			Array.filter(owned(owner), structure => !moving(structure.kind)),
			structure => `${structure.kind} at ${Math.floor(structure.x)},${Math.floor(structure.z)}`
		)
		const others = Array.filter(Array.fromIterable(MutableHashMap.values(players)), other => other.id !== owner)
		const edge = farthest(player.team, player.base)
		return Array.join(
			[
				`You: ${player.name}, ore ${player.ore}, base at ${Math.floor(player.base.x)},${Math.floor(player.base.z)} (${whereFrom(origin, player.base)})`,
				focused,
				`Farthest explored: ${Array.join(
					Array.map(
						Record.toEntries(edge),
						entry => `${entry[0]} ${Math.floor(entry[1].x)},${Math.floor(entry[1].z)} (${whereFrom(origin, entry[1])})`
					),
					'; '
				)}`,
				`Fleet:\n${Array.join(groups, '\n')}`,
				`Structures: ${Array.join(structures, '; ')}`,
				`Teammates: ${Array.join(
					Array.map(
						Array.filter(others, other => other.team === player.team),
						other => other.name
					),
					', '
				)}`,
				`Other players: ${Array.join(
					Array.take(
						Array.map(
							Array.filter(others, other => other.team !== player.team),
							other => other.name
						),
						40
					),
					', '
				)}`,
				`Team memory (key: fact):\n${Array.join(
					Array.map(
						Array.fromIterable(MutableHashMap.values(team(player.team).memory)),
						entry => `- ${entry.key}: ${describeMemory(entry)}`
					),
					'\n'
				)}`,
				`Recent events:\n${Array.join(
					Array.map(team(player.team).log, entry =>
						Option.match(Option.fromUndefinedOr(entry.at), {
							onNone: () => entry.text,
							onSome: at => `${entry.text} at ${Math.floor(at.x)},${Math.floor(at.z)}`
						})
					),
					'\n'
				)}`
			],
			'\n\n'
		)
	}

	function restore(state: Saved, now: number) {
		for (const key of state.depleted) {
			const tile = parseKey(key)
			exhaust(key, {x: tile.cx, z: tile.cz})
		}
		for (const player of state.players) {
			MutableHashMap.set(players, player.id, {...player, connections: 0, raidAt: now + 120_000})
		}
		for (const entity of state.entities) {
			counters.id = entity.id
			spawn(entity.kind, entity.owner, entity, entity.group, entity.routine)
			const restored = entityOf(entity.id)
			if (restored !== undefined) {
				restored.cargo = entity.cargo
				restored.health = entity.health
			}
		}
		counters.id = state.nextId
		for (const memory of state.memory) {
			for (const entry of memory.entries) MutableHashMap.set(team(memory.team).memory, entry.key, entry)
		}
		for (const map of state.explored) {
			for (const chunk of map.chunks) {
				MutableHashMap.set(team(map.team).chunks, chunkKey(chunk.cx, chunk.cz), {
					bits: Uint8Array.from(chunk.bits),
					count: Array.reduce(
						Array.range(0, CHUNK_TILES - 1),
						0,
						(total, tile) => total + bit(explored(chunk.bits, tile))
					),
					cx: chunk.cx,
					cz: chunk.cz,
					version: 1
				})
			}
		}
	}

	return {
		act,
		// CORE's reroute: miners keep away from this route from now on and pick new ore.
		avoid(owner: string, route: string, now: number) {
			const player = playerOf(owner)
			const known = memoryOf(player?.team ?? '', route)
			if (player === undefined || known?._tag !== 'RouteAssaulted') return
			remember(player.team, {...known, avoid: true, updatedAt: now})
			for (const miner of owned(owner)) {
				if (miner.routine._tag === 'Mine') update(miner.id, {routine: miner.routine})
			}
		},
		// The last 20 lines of a player's conversation with CORE, which its next answer reads.
		chat: (owner: string) => Option.getOrElse(MutableHashMap.get(chats, owner), () => []),
		connect(user: User, now: number, invite?: string) {
			const player = join(user, now, invite)
			player.connections += 1
			counters.connection += 1
			MutableHashMap.set(connections, counters.connection, {
				depleted: counters.depletion,
				explored: 0,
				hudAt: 0,
				known: MutableHashMap.empty(),
				player: player.id,
				shots: counters.shot
			})
			return counters.connection
		},
		disconnect(id: number, now: number) {
			const player = pipe(
				MutableHashMap.get(connections, id),
				Option.flatMap(connection => MutableHashMap.get(players, connection.player)),
				Option.getOrUndefined
			)
			MutableHashMap.remove(connections, id)
			if (player === undefined) return
			player.connections = Number.max(0, player.connections - 1)
			player.activeAt = now
		},
		drain: () => MutableList.takeAll(events),
		frame,
		idleHours: (owner: string, now: number) => (now - (playerOf(owner)?.activeAt ?? now)) / 3_600_000,
		restore: (now: number) => Option.map(saved, state => restore(state, now)),
		say(owner: string, turn: Turn) {
			MutableHashMap.set(
				chats,
				owner,
				Array.append(
					Array.takeRight(
						Option.getOrElse(MutableHashMap.get(chats, owner), () => []),
						19
					),
					turn
				)
			)
		},
		snapshot() {
			return {
				depleted: Array.fromIterable(MutableHashMap.keys(depleted)),
				entities: Array.map(
					Array.filter(Array.fromIterable(MutableHashMap.values(entities)), entity => entity.kind !== 'glitch'),
					entity => ({
						cargo: entity.cargo,
						group: entity.group,
						health: entity.health,
						id: entity.id,
						kind: entity.kind,
						owner: entity.owner,
						routine: entity.routine,
						x: entity.x,
						z: entity.z
					})
				),
				explored: Array.map(Array.fromIterable(teams), entry => ({
					chunks: exploredSince(entry[1], -1),
					team: entry[0]
				})),
				memory: Array.map(Array.fromIterable(teams), entry => ({
					entries: Array.fromIterable(MutableHashMap.values(entry[1].memory)),
					team: entry[0]
				})),
				nextId: counters.id,
				players: Array.map(Array.fromIterable(MutableHashMap.values(players)), player => ({
					activeAt: player.activeAt,
					base: player.base,
					color: player.color,
					id: player.id,
					name: player.name,
					ore: player.ore,
					team: player.team
				}))
			} satisfies Saved
		},
		steer(owner: string, input: {drone: number; px: number; pz: number; x: number; z: number}, now: number) {
			const drone = entityOf(input.drone)
			if (drone?.owner !== owner) return
			const scale = 1 / Number.max(1, Math.hypot(input.x, input.z))
			drone.steerX = input.x * scale
			drone.steerZ = input.z * scale
			drone.steerUntil = now + 450
			// The client predicts its controlled drone; its position wins while it stays within reach of the server's.
			if (Math.hypot(input.px - drone.x, input.pz - drone.z) < STATS[drone.kind].speed * 0.6) {
				drone.x = input.px
				drone.z = input.pz
			}
			const player = playerOf(owner)
			if (player !== undefined) player.activeAt = now
		},
		step(now: number) {
			counters.tick += 1
			reindex()
			for (const id of Array.fromIterable(MutableHashMap.keys(entities))) move(id, now)
			combat(1 / 20, now)
			if (counters.tick % 10 === 0) sightings(now)
			if (counters.tick % 20 === 0) raids(now)
		},
		summary,
		// Only the player's own requests count as activity; CORE's autonomous orders do not.
		touch(owner: string, now: number) {
			const player = playerOf(owner)
			if (player !== undefined) player.activeAt = now
		}
	}
}
