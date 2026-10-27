import {Array, Number} from 'effect'

import type {MemoryEntry, Routine} from '#services/game/schema.ts'

// The world is a pure function of the seed: server and client generate the same tiles, so terrain never crosses the network.
const WORLD_SEED = 0x51_6e_41_4c
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
export const CHUNK = 32
export const CHUNK_TILES = 1024
export const TICK_HZ = 20
export const FRAME_HZ = 10
// One visible entity in a frame, packed as float32: id, x, z, heading, health fraction, flags.
export const STRIDE = 6
export const FLAG_CARGO = 1
export const FLAG_CONTROLLED = 2
export const TILE = {Crystal: 7, Highland: 3, Ore: 5, Plain: 2, Rock: 4, Ruin: 6, Scrap: 8, Shore: 1, Water: 0}
// What one unit of mining a tile is worth in ore: crystal seams in the high ground and scrap in ruins and wrecks pay more than ore.
export const YIELD = [0, 0, 0, 0, 0, 1, 0, 3, 2]
// size is the radius a unit keeps clear around itself.
export const STATS = {
	builder: {cargo: 0, cost: 40, damage: 0, health: 60, range: 0, sight: 7, size: 0.55, speed: 5},
	core: {cargo: 0, cost: 0, damage: 0, health: 600, range: 0, sight: 16, size: 2.4, speed: 0},
	glitch: {cargo: 0, cost: 0, damage: 9, health: 45, range: 2.5, sight: 12, size: 0.45, speed: 7.5},
	guard: {cargo: 0, cost: 45, damage: 14, health: 100, range: 8, sight: 11, size: 0.6, speed: 7},
	hauler: {cargo: 24, cost: 35, damage: 0, health: 80, range: 0, sight: 7, size: 0.7, speed: 6},
	miner: {cargo: 12, cost: 30, damage: 0, health: 60, range: 0, sight: 7, size: 0.6, speed: 4},
	relay: {cargo: 0, cost: 40, damage: 0, health: 120, range: 0, sight: 22, size: 0.7, speed: 0},
	scout: {cargo: 0, cost: 20, damage: 0, health: 30, range: 0, sight: 15, size: 0.45, speed: 10},
	turret: {cargo: 0, cost: 60, damage: 16, health: 220, range: 10, sight: 12, size: 0.8, speed: 0},
	wall: {cargo: 0, cost: 15, damage: 0, health: 320, range: 0, sight: 2, size: 0.6, speed: 0}
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

// Deposits: ore in clustered veins on low ground, crystal seams only in the high ground.
function depositAt(x: number, z: number, height: number) {
	if (valueNoise(WORLD_SEED + 3, x, z, 13) > 0.76 && hash(WORLD_SEED + 8, x, z) > 0.2) return TILE.Ore
	if (height > 0.56 && valueNoise(WORLD_SEED + 14, x, z, 7) > 0.8 && hash(WORLD_SEED + 15, x, z) > 0.35) {
		return TILE.Crystal
	}
	if (wreckAt(x, z)) return TILE.Scrap
	return TILE.Plain
}

function groundOf(height: number) {
	if (height > 0.7) return TILE.Rock
	if (height > 0.56) return TILE.Highland
	return TILE.Plain
}

export function tileAt(x: number, z: number) {
	const height =
		0.55 * valueNoise(WORLD_SEED, x, z, 72) +
		0.3 * valueNoise(WORLD_SEED + 1, x, z, 23) +
		0.15 * valueNoise(WORLD_SEED + 2, x, z, 8)
	if (height < 0.3) return {kind: TILE.Water, level: 0}
	const level = Number.clamp(Math.floor(((height - 0.3) / 0.5) * 5), {maximum: 4, minimum: 0})
	if (height < 0.335) return {kind: TILE.Shore, level}
	const ruin = ruinAt(x, z)
	if (ruin !== TILE.Plain) return {kind: ruin, level}
	const deposit = depositAt(x, z, height)
	if (deposit !== TILE.Plain) return {kind: deposit, level}
	return {kind: groundOf(height), level}
}

export function chunkTiles(cx: number, cz: number) {
	const kinds = new Uint8Array(CHUNK_TILES)
	const levels = new Uint8Array(CHUNK_TILES)
	for (const index of Array.range(0, CHUNK_TILES - 1)) {
		const tile = tileAt(cx * CHUNK + (index % CHUNK), cz * CHUNK + Math.floor(index / CHUNK))
		kinds.set([tile.kind], index)
		levels.set([tile.level], index)
	}
	return {kinds, levels}
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
