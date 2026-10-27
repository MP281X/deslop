import {Array, MutableHashMap, Number, Option} from 'effect'

import type {EntityKind, MemoryEntry, Point, Routine} from '#services/game/schema.ts'

// The world is a pure function of the seed: server and client generate the same tiles, so terrain never crosses the network.
const WORLD_SEED = 0x51_6e_41_4c
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const BIOME = {Frost: 2, Mesa: 1, Moss: 0}
export const CHUNK = 32
export const CHUNK_TILES = 1024
export const TICK_HZ = 20
export const FRAME_HZ = 10
// One visible entity in a frame, packed as float32: id, x, z, heading, health fraction, flags.
export const STRIDE = 6
export const FLAG_CARGO = 1
export const FLAG_CONTROLLED = 2
export const FLAG_WORKING = 4
export const TILE = {Crystal: 7, Highland: 3, Ore: 5, Plain: 2, Rock: 4, Ruin: 6, Scrap: 8, Shore: 1, Water: 0}
// What one unit of mining a tile is worth in ore: crystal seams in the high ground and scrap in ruins and wrecks pay more than ore.
export const YIELD = [0, 0, 0, 0, 0, 1, 0, 3, 2]
// size is the radius a unit keeps clear around itself; climb is the most levels it can step up or down between tiles, and floats lets it cross water. Fliers clear everything.
export const STATS = {
	builder: {
		cargo: 0,
		climb: 99,
		cost: 40,
		damage: 0,
		floats: true,
		health: 60,
		range: 0,
		sight: 7,
		size: 0.55,
		speed: 5
	},
	core: {cargo: 0, climb: 0, cost: 0, damage: 0, floats: false, health: 600, range: 0, sight: 16, size: 2.4, speed: 0},
	glitch: {
		cargo: 0,
		climb: 99,
		cost: 0,
		damage: 9,
		floats: true,
		health: 45,
		range: 2.5,
		sight: 12,
		size: 0.45,
		speed: 7.5
	},
	guard: {
		cargo: 0,
		climb: 99,
		cost: 45,
		damage: 14,
		floats: true,
		health: 100,
		range: 8,
		sight: 11,
		size: 0.6,
		speed: 7
	},
	hauler: {cargo: 24, climb: 1, cost: 35, damage: 0, floats: true, health: 80, range: 0, sight: 7, size: 0.7, speed: 6},
	miner: {cargo: 12, climb: 2, cost: 30, damage: 0, floats: false, health: 60, range: 0, sight: 7, size: 0.6, speed: 4},
	relay: {
		cargo: 0,
		climb: 0,
		cost: 40,
		damage: 0,
		floats: false,
		health: 120,
		range: 0,
		sight: 22,
		size: 0.7,
		speed: 0
	},
	scout: {
		cargo: 0,
		climb: 99,
		cost: 20,
		damage: 0,
		floats: true,
		health: 30,
		range: 0,
		sight: 15,
		size: 0.45,
		speed: 10
	},
	turret: {
		cargo: 0,
		climb: 0,
		cost: 60,
		damage: 16,
		floats: false,
		health: 220,
		range: 10,
		sight: 12,
		size: 0.8,
		speed: 0
	},
	wall: {cargo: 0, climb: 0, cost: 15, damage: 0, floats: false, health: 320, range: 0, sight: 2, size: 0.6, speed: 0}
}
export const TEAM_COLORS = ['#f08a4b', '#5eead4', '#c4b5fd', '#fde047', '#f9a8d4', '#93c5fd']
export const CODES = {
	builder: 'BD',
	core: 'CORE',
	glitch: 'GL',
	guard: 'GD',
	hauler: 'HL',
	miner: 'MN',
	relay: 'RL',
	scout: 'SC',
	turret: 'TR',
	wall: 'WL'
}

export function bit(flag: boolean) {
	if (flag) return 1
	return 0
}

type Disc = {id: number; mobile: boolean; size: number; x: number; z: number}

// Places read as distance and compass bearing from a point of view, never as raw coordinates; north is -z.
export function whereFrom(origin: {x: number; z: number}, target: {x: number; z: number}) {
	const distance = Math.hypot(target.x - origin.x, target.z - origin.z)
	if (distance < 3) return 'here'
	const sector = Number.round(Math.atan2(target.x - origin.x, origin.z - target.z) / (Math.PI / 4), 0)
	return `${Number.round(distance, 0)} m ${COMPASS[(sector + 8) % 8] ?? 'N'}`
}

// How far to move a unit out of the others it overlaps, along the line between centres; server and client prediction share it.
export function separation(unit: Disc, others: Disc[]) {
	const push = {x: 0, z: 0}
	for (const other of others) {
		const dx = unit.x - other.x
		const dz = unit.z - other.z
		// A unit takes the whole overlap with something that cannot move and half of it with another mover, which takes the other half.
		const depth = (unit.size + other.size - Math.hypot(dx, dz)) * (1 - 0.5 * bit(other.mobile))
		if (other.id !== unit.id && depth > 0) {
			// Units on the same spot part along a direction their ids pick.
			const angle = Math.atan2(dx, dz) + unit.id * 2.4 * bit(dx === 0 && dz === 0)
			push.x += Math.sin(angle) * depth
			push.z += Math.cos(angle) * depth
		}
	}
	return push
}

export function hash(seed: number, x: number, z: number) {
	const mixed = Math.imul(x | 0, 0x27_d4_eb_2d) ^ Math.imul(z | 0, 0x16_56_67_b1) ^ Math.imul(seed | 0, 0x9e_37_79_b1)
	const first = Math.imul(mixed ^ (mixed >>> 15), 0x85_eb_ca_6b)
	const second = Math.imul(first ^ (first >>> 13), 0xc2_b2_ae_35)
	return ((second ^ (second >>> 16)) >>> 0) / 4_294_967_296
}

function smooth(t: number) {
	return t * t * (3 - 2 * t)
}

function valueNoise(seed: number, x: number, z: number, scale: number) {
	const ix = Math.floor(x / scale)
	const iz = Math.floor(z / scale)
	const tx = smooth(x / scale - ix)
	const tz = smooth(z / scale - iz)
	const a = hash(seed, ix, iz)
	const b = hash(seed, ix + 1, iz)
	const c = hash(seed, ix, iz + 1)
	return a + (b - a) * tx + (c - a) * tz + (a - b - c + hash(seed, ix + 1, iz + 1)) * tx * tz
}

// Ruins are square outlines with scrap strewn inside, at most one per 48-tile cell: landmarks worth naming.
function ruinAt(x: number, z: number) {
	const cellX = Math.floor(x / 48)
	const cellZ = Math.floor(z / 48)
	if (hash(WORLD_SEED + 4, cellX, cellZ) > 0.3) return TILE.Plain
	const dx = Math.abs(x - (cellX * 48 + 6 + Math.floor(hash(WORLD_SEED + 5, cellX, cellZ) * 36)))
	const dz = Math.abs(z - (cellZ * 48 + 6 + Math.floor(hash(WORLD_SEED + 6, cellX, cellZ) * 36)))
	if (dx > 3 || dz > 3) return TILE.Plain
	const wall = dx === 3 || dz === 3 || (dx <= 1 && dz <= 1)
	if (wall && hash(WORLD_SEED + 7, x, z) > 0.25) return TILE.Ruin
	if (!wall && hash(WORLD_SEED + 9, x, z) > 0.4) return TILE.Scrap
	return TILE.Plain
}

// Wrecks are small scrap patches, about one per 20-tile cell on open ground.
function wreckAt(x: number, z: number) {
	const cellX = Math.floor(x / 20)
	const cellZ = Math.floor(z / 20)
	const dx = x - (cellX * 20 + 4 + Math.floor(hash(WORLD_SEED + 10, cellX, cellZ) * 12))
	const dz = z - (cellZ * 20 + 4 + Math.floor(hash(WORLD_SEED + 11, cellX, cellZ) * 12))
	return (
		hash(WORLD_SEED + 12, cellX, cellZ) < 0.35 && Math.abs(dx) + Math.abs(dz) <= 1 && hash(WORLD_SEED + 13, x, z) > 0.3
	)
}

function smoothstep(from: number, to: number, value: number) {
	const t = Number.clamp((value - from) / (to - from), {maximum: 1, minimum: 0})
	return t * t * (3 - 2 * t)
}

// Biome weights from a broad noise, blended across borders so relief never tears: moss lowland, red mesa, frost highland.
function climate(x: number, z: number) {
	const t = valueNoise(WORLD_SEED + 20, x, z, 190)
	const moss = 1 - smoothstep(0.42, 0.48, t)
	const frost = smoothstep(0.56, 0.62, t)
	return {frost, mesa: 1 - moss - frost, moss}
}

// Deposits by biome: ore veins in the lowland, violet crystal seams in frost high ground, scrap wrecks most often on the mesa.
function depositAt(x: number, z: number, weights: ReturnType<typeof climate>, level: number) {
	if (valueNoise(WORLD_SEED + 3, x, z, 13) > 0.8 - 0.06 * weights.moss && hash(WORLD_SEED + 8, x, z) > 0.2) {
		return TILE.Ore
	}
	if (
		level >= 3 &&
		valueNoise(WORLD_SEED + 14, x, z, 7) > 0.82 - 0.06 * weights.frost &&
		hash(WORLD_SEED + 15, x, z) > 0.35
	) {
		return TILE.Crystal
	}
	if (wreckAt(x, z) || (weights.mesa > 0.5 && wreckAt(x + 10, z + 10))) return TILE.Scrap
	return TILE.Plain
}

function groundOf(level: number) {
	if (level >= 6) return TILE.Rock
	if (level >= 3) return TILE.Highland
	return TILE.Plain
}

function biomeOf(weights: ReturnType<typeof climate>) {
	if (weights.moss >= weights.mesa && weights.moss >= weights.frost) return BIOME.Moss
	if (weights.mesa >= weights.frost) return BIOME.Mesa
	return BIOME.Frost
}

// Relief decides who goes where: moss lowland is gentle but cut by rivers only floating drones cross; mesa plateaus stand 4 levels up behind cliffs; frost rises in two-level terraces a miner climbs and a hauler cannot. Sparse ramps soften both.
export function tileAt(x: number, z: number) {
	const height =
		0.55 * valueNoise(WORLD_SEED, x, z, 72) +
		0.3 * valueNoise(WORLD_SEED + 1, x, z, 23) +
		0.15 * valueNoise(WORLD_SEED + 2, x, z, 8)
	const weights = climate(x, z)
	const biome = biomeOf(weights)
	const water = 0.33 * weights.moss + 0.26 * weights.mesa + 0.29 * weights.frost
	const river = Math.abs(valueNoise(WORLD_SEED + 23, x, z, 64) - 0.5) < 0.022 * (weights.moss + 0.7 * weights.mesa)
	if (height < water || river) return {biome, kind: TILE.Water, level: 0}
	const ramp = valueNoise(WORLD_SEED + 22, x, z, 17) > 0.8
	const edge = 0.005 + 0.07 * bit(ramp)
	const plateau = smoothstep(0.55 - edge, 0.55 + edge, valueNoise(WORLD_SEED + 21, x, z, 34))
	const relief =
		Number.clamp((height - water) / 0.45, {maximum: 1, minimum: 0}) *
			(3 * weights.moss + 2 * weights.mesa + 7 * weights.frost) +
		plateau * (4 * weights.mesa + 2 * weights.frost)
	const step = 1 + bit(weights.frost > 0.5 && !ramp)
	const level = Number.clamp(Math.floor(relief / step) * step, {maximum: 9, minimum: 0})
	if (height < water + 0.02) return {biome, kind: TILE.Shore, level}
	const ruin = ruinAt(x, z)
	if (ruin !== TILE.Plain) return {biome, kind: ruin, level}
	const deposit = depositAt(x, z, weights, level)
	if (deposit !== TILE.Plain) return {biome, kind: deposit, level}
	return {biome, kind: groundOf(level), level}
}

export function chunkTiles(cx: number, cz: number) {
	const biomes = new Uint8Array(CHUNK_TILES)
	const kinds = new Uint8Array(CHUNK_TILES)
	const levels = new Uint8Array(CHUNK_TILES)
	for (const index of Array.range(0, CHUNK_TILES - 1)) {
		const tile = tileAt(cx * CHUNK + (index % CHUNK), cz * CHUNK + Math.floor(index / CHUNK))
		biomes.set([tile.biome], index)
		kinds.set([tile.kind], index)
		levels.set([tile.level], index)
	}
	return {biomes, kinds, levels}
}

export function chunkKey(cx: number, cz: number) {
	return `${cx},${cz}`
}

export function chunkOf(value: number) {
	return Math.floor(value / CHUNK)
}

export function tileIndex(x: number, z: number) {
	return (Math.floor(z) - chunkOf(z) * CHUNK) * CHUNK + (Math.floor(x) - chunkOf(x) * CHUNK)
}

// Tiles pack into one number, which keeps lookup maps cheap; the world stays within ±32,768 tiles of the origin.
export function pack(x: number, z: number) {
	return (x + 32_768) * 65_536 + (z + 32_768)
}

export type Terrain = ReturnType<typeof makeTerrain>

// The movement contract the server and the client's prediction share. Tiles are generated once per chunk and kept, up to 12,000 chunks (36 MB), so movement reads them for the price of a lookup.
export function makeTerrain() {
	const chunks = MutableHashMap.empty<number, ReturnType<typeof chunkTiles>>()
	// The last chunk read: neighbouring reads mostly land in the same one.
	const last = {key: pack(0, 0), tiles: chunkTiles(0, 0)}
	return {
		tile(x: number, z: number) {
			const key = pack(chunkOf(x), chunkOf(z))
			if (key !== last.key) {
				last.key = key
				last.tiles = Option.getOrElse(MutableHashMap.get(chunks, key), () => {
					if (MutableHashMap.size(chunks) > 12_000) MutableHashMap.clear(chunks)
					const generated = chunkTiles(chunkOf(x), chunkOf(z))
					MutableHashMap.set(chunks, key, generated)
					return generated
				})
			}
			const index = tileIndex(x, z)
			return {kind: last.tiles.kinds[index] ?? TILE.Water, level: last.tiles.levels[index] ?? 0}
		}
	}
}

// Whether a unit of this kind can step from one tile onto another: within its climb, and onto water only if it floats. A unit already somewhere it cannot be may leave freely.
export function passable(terrain: Terrain, kind: EntityKind, from: Point, to: Point) {
	const stats = STATS[kind]
	if (stats.climb >= 99) return true
	const source = terrain.tile(Math.floor(from.x), Math.floor(from.z))
	const target = terrain.tile(Math.floor(to.x), Math.floor(to.z))
	if (source.kind === TILE.Water && !stats.floats) return true
	if (target.kind === TILE.Water && !stats.floats) return false
	return Math.abs(target.level - source.level) <= stats.climb
}

// Moves a unit by a step, each axis on its own so it slides along a cliff instead of stopping; its front edge leads, so it never overlaps a wall it cannot climb. A long move goes in substeps under half a tile, so nothing jumps a narrow river.
export function stride(terrain: Terrain, kind: EntityKind, from: Point, dx: number, dz: number) {
	const reach = STATS[kind].size * 0.6
	const steps = Math.ceil(Number.max(Math.abs(dx), Math.abs(dz)) / 0.4)
	return Array.reduce(Array.range(1, Number.max(1, steps)), from, point => {
		const x =
			point.x +
			(dx / Number.max(1, steps)) *
				bit(
					passable(terrain, kind, point, {x: point.x + dx / Number.max(1, steps) + Math.sign(dx) * reach, z: point.z})
				)
		const step = dz / Number.max(1, steps)
		return {
			x,
			z: point.z + step * bit(passable(terrain, kind, {x, z: point.z}, {x, z: point.z + step + Math.sign(dz) * reach}))
		}
	})
}

export function explored(bits: Uint8Array, index: number) {
	return ((bits[index >> 3] ?? 0) & (1 << (index & 7))) !== 0
}

export function routineLabel(routine: Routine) {
	if (routine._tag === 'Search' || routine._tag === 'Track') return `${routine._tag} ${routine.player}`
	if (routine._tag === 'Escort') return `Escort ${routine.group}`
	if (routine._tag === 'Build') return `Build ${routine.structure}`
	return routine._tag
}

function at(point: {x: number; z: number}) {
	return `${Math.floor(point.x)},${Math.floor(point.z)}`
}

export function describeMemory(entry: MemoryEntry) {
	if (entry._tag === 'Standing') return `${entry.player} is ${entry.stance}: ${entry.reason}`
	if (entry._tag === 'Sighting') return `${entry.player} last seen at ${at(entry.at)} (${entry.what})`
	if (entry._tag === 'RouteAssaulted') {
		const line = `route near ${at(entry.at)} raided ${entry.count}x, ${entry.losses} lost`
		if (entry.avoid) return `${line}, avoided`
		return line
	}
	if (entry._tag === 'Place') return `${entry.name} at ${at(entry.at)}`
	return entry.text
}
