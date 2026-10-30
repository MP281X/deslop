import {Array, MutableHashMap, MutableHashSet, MutableList, Number, Option, Record, String} from 'effect'

import * as THREE from 'three'

import {
	BIOME_SHAPE,
	CHUNK,
	GROUND,
	GROUND_COLOR,
	GROUND_LIP,
	LEVEL,
	LIQUID,
	ORES,
	ORE_REF,
	STRATA,
	chunkOf,
	tileGround,
	tileKey
} from '#services/world/lib/utils.ts'
import type {Chunk, Prop} from '#services/world/lib/utils.ts'
import {Material} from '#services/world/schema.ts'
import type {Edit} from '#services/world/schema.ts'

// Tiles of neighbouring chunks loaded round the one being built: the ore stain spreads three tiles and cliff colours blend over four.
const PAD = 6
// Each side of a tile: its direction and the two corners on it, as (x, z) offsets within the tile.
const SIDES = [
	{ax: 0, az: 0, bx: 1, bz: 0, dx: 0, dz: -1},
	{ax: 1, az: 0, bx: 1, bz: 1, dx: 1, dz: 0},
	{ax: 1, az: 1, bx: 0, bz: 1, dx: 0, dz: 1},
	{ax: 0, az: 1, bx: 0, bz: 0, dx: -1, dz: 0}
]
const AROUND = [
	{x: 1, z: 0},
	{x: -1, z: 0},
	{x: 0, z: 1},
	{x: 0, z: -1},
	{x: 1, z: 1},
	{x: -1, z: 1},
	{x: 1, z: -1},
	{x: -1, z: -1}
]
const CORNER_OFFSETS = [
	{x: 0, z: 0},
	{x: 1, z: 0},
	{x: 0, z: 1},
	{x: 1, z: 1}
]
const LIQUID_TRIANGLES = [
	{a: 0, b: 0},
	{a: 0, b: 1},
	{a: 1, b: 0},
	{a: 1, b: 0},
	{a: 0, b: 1},
	{a: 1, b: 1}
]
// Prop colours by role, from the atlas palette.
const ROLE = {
	cactus: '#a6c78f',
	cave: '#3b322d',
	concrete: '#ece6db',
	leaf: '#a9cf8c',
	leaf2: '#93c27d',
	moss: '#a3c98a',
	rock: '#ddd4c6',
	trunk: '#b39478'
}
const BARK = '#a88c6f'
const CAP_HUES = ['#e6a6c4', '#b9a3e3', '#9fd6cf']
const PLANTS = ['tree', 'pine', 'shrub', 'shrubDry', 'maple']
const TUFTY = [
	GROUND.grass,
	GROUND.grass2,
	GROUND.ruingrass,
	GROUND.karstgrass,
	GROUND.marsh,
	GROUND.karstmoss,
	GROUND.paddy,
	GROUND.paddy2,
	GROUND.autumn,
	GROUND.autumn2,
	GROUND.tundra,
	GROUND.frostmoss
]
const REEDY = [GROUND.reeds, GROUND.mud2]
const WET = [GROUND.mud, GROUND.marsh, GROUND.moss, GROUND.paddy2]
const SALTY = [GROUND.salt, GROUND.salt2, GROUND.saltpink, GROUND.saltochre]
const SNOWY = [GROUND.snow, GROUND.snow2, GROUND.snowroad]

type Rgb = [number, number, number]
type Vec = [number, number, number]
type Shape = {colors: Float32Array; normals: Float32Array; positions: Float32Array}
type Sink = 'glow' | 'props' | 'terrain'
type Piece = {colour: string; geometry: THREE.BufferGeometry; shade?: (y: number, ny: number) => number}
type Side = {ax: number; az: number; bx: number; bz: number; dx: number; dz: number}
type Species = 'acacia' | 'birch' | 'bush' | 'fir' | 'maple' | 'oak' | 'poplar' | 'shrub' | 'spruce'
type Area = {
	amount: Float32Array
	biome: Uint8Array
	corners: Float32Array
	deck: Float32Array
	ground: Uint8Array
	liquid: Uint8Array
	ore: Uint8Array
	props: Chunk['props']
	surface: Float32Array
	wear: Float32Array
	x0: number
	z0: number
}
type Stain = {density: Float32Array; ores: Uint8Array; worked: Float32Array; x0: number; z0: number}
type Wall = {bottoms: number[]; polygon: [number, number][]; tops: number[]}
type Lists = MutableHashMap.MutableHashMap<string, MutableList.MutableList<number>>

// What a chunk's builder knows beyond the generator: edits and the ore left, by tile key, and the props the colonies cleared, by id.
export type Overlay = {
	amounts: MutableHashMap.MutableHashMap<number, number>
	cleared: MutableHashSet.MutableHashSet<number>
	edits: MutableHashMap.MutableHashMap<number, Edit>
}

export type Built = ReturnType<typeof buildChunk>

function rgb(hex: string) {
	const colour = new THREE.Color(hex)
	return [colour.r, colour.g, colour.b] satisfies Rgb
}

function sink(capacity: number) {
	return {
		colors: new Float32Array(capacity * 3),
		count: 0,
		normals: new Float32Array(capacity * 3),
		positions: new Float32Array(capacity * 3)
	}
}

const TAU = Math.PI * 2
const SIZE = CHUNK + PAD * 2
const CELLS = SIZE * SIZE
const ROWS = Array.range(0, SIZE - 1)
const INNER = Array.range(PAD, PAD + CHUNK - 1)
const TOPS = Array.map(GROUND_COLOR, rgb)
const STRATA_RGB = Array.map(STRATA, list => Array.map(list, rgb))
const ORE_TINTS = Array.map(Material.literals, material => rgb(ORES[material].tint))
const ROAD = rgb('#e6d6b6')
const WORKED = rgb('#6e5c4c')
const MOSS = rgb('#a9c58e')
const EVERY_BIOME = Array.range(0, BIOME_SHAPE.length - 1)
const WHITE = rgb('#ffffff')
const SCRATCH = {glow: sink(4096), props: sink(4096), terrain: sink(4096)}
const SHAPES = MutableHashMap.empty<string, Shape>()
const NORMAL = new THREE.Matrix3()
const POINT = new THREE.Vector3()
const EULER = new THREE.Euler()
const QUATERNION = new THREE.Quaternion()

function flag(value: boolean) {
	if (value) return 1
	return 0
}

function mix(from: number, to: number, t: number) {
	return from + (to - from) * t
}

function clamp(value: number, low: number, high: number) {
	return Number.min(Number.max(value, low), high)
}

function highest(values: number[]) {
	return Array.reduce(values, -Infinity, (best, value) => Number.max(best, value))
}

function lowest(values: number[]) {
	return Array.reduce(values, Infinity, (best, value) => Number.min(best, value))
}

function smoothstep(from: number, to: number, x: number) {
	const t = clamp((x - from) / (to - from), 0, 1)
	return t * t * (3 - 2 * t)
}

function blend(from: Rgb, to: Rgb, t: number) {
	return [mix(from[0], to[0], t), mix(from[1], to[1], t), mix(from[2], to[2], t)] satisfies Rgb
}

function scaled(colour: Rgb, by: number) {
	return [colour[0] * by, colour[1] * by, colour[2] * by] satisfies Rgb
}

// The renderer's own scatter: decoration only, so it need not match the generator's integer hashing.
function dither(x: number, y: number) {
	const value = Math.sin(x * 127.1 + y * 311.7) * 43_758.5453
	return value - Math.floor(value)
}

function valueNoise(x: number, z: number, salt: number) {
	const ix = Math.floor(x)
	const iz = Math.floor(z)
	const fx = (x - ix) * (x - ix) * (3 - 2 * (x - ix))
	const fz = (z - iz) * (z - iz) * (3 - 2 * (z - iz))
	function corner(a: number, b: number) {
		return dither(a + salt * 31.7, b + salt * 17.1)
	}
	return mix(mix(corner(ix, iz), corner(ix + 1, iz), fx), mix(corner(ix, iz + 1), corner(ix + 1, iz + 1), fx), fz)
}

function fbm(x: number, z: number, salt: number) {
	return (
		valueNoise(x, z, salt) * 0.55 +
		valueNoise(x * 2.03, z * 2.03, salt + 3) * 0.3 +
		valueNoise(x * 4.1, z * 4.1, salt + 7) * 0.15
	)
}

// Mulberry32: a seeded stream of numbers in [0, 1).
function randomOf(seed: number) {
	const state = {seed}
	return () => {
		state.seed = (state.seed + 0x6d_2b_79_f5) >>> 0
		const first = Math.imul(state.seed ^ (state.seed >>> 15), state.seed | 1)
		const second = first ^ (first + Math.imul(first ^ (first >>> 7), first | 61))
		return ((second ^ (second >>> 14)) >>> 0) / 4_294_967_296
	}
}

function reserve(name: Sink, vertices: number) {
	const target = SCRATCH[name]
	const needed = (target.count + vertices) * 3
	if (needed <= target.positions.length) return
	const capacity = Number.max(needed, target.positions.length * 2)
	for (const attribute of ['positions', 'normals', 'colors'] as const) {
		const grown = new Float32Array(capacity)
		grown.set(target[attribute])
		target[attribute] = grown
	}
}

function vertex(name: Sink, point: Vec, normal: Vec, colour: Rgb) {
	reserve(name, 1)
	const target = SCRATCH[name]
	const at = target.count * 3
	target.positions.set(point, at)
	target.normals.set(normal, at)
	target.colors.set(colour, at)
	target.count += 1
}

// A flat-shaded triangle in world units.
function triangle(name: Sink, points: [Vec, Vec, Vec], colours: [Rgb, Rgb, Rgb]) {
	const a = points[0]
	const ab = [points[1][0] - a[0], points[1][1] - a[1], points[1][2] - a[2]] satisfies Vec
	const ac = [points[2][0] - a[0], points[2][1] - a[1], points[2][2] - a[2]] satisfies Vec
	const nx = ab[1] * ac[2] - ab[2] * ac[1]
	const ny = ab[2] * ac[0] - ab[0] * ac[2]
	const nz = ab[0] * ac[1] - ab[1] * ac[0]
	const length = Math.hypot(nx, ny, nz) || 1
	const normal = [nx / length, ny / length, nz / length] satisfies Vec
	vertex(name, a, normal, colours[0])
	vertex(name, points[1], normal, colours[1])
	vertex(name, points[2], normal, colours[2])
}

function take(name: Sink) {
	const target = SCRATCH[name]
	const size = target.count * 3
	const out = {
		colors: new Float32Array(target.colors.subarray(0, size)),
		normals: new Float32Array(target.normals.subarray(0, size)),
		positions: new Float32Array(target.positions.subarray(0, size))
	}
	target.count = 0
	return out
}

/* ───────── the area: the chunk and a ring of its neighbours, edits and ore left applied ───────── */

function loadArea(chunkAt: (cx: number, cz: number) => Chunk, overlay: Overlay, cx: number, cz: number) {
	const area = {
		amount: new Float32Array(CELLS),
		biome: new Uint8Array(CELLS),
		corners: new Float32Array(CELLS * 4),
		deck: new Float32Array(CELLS),
		ground: new Uint8Array(CELLS),
		liquid: new Uint8Array(CELLS),
		ore: new Uint8Array(CELLS),
		props: Array.filter(chunkAt(cx, cz).props, prop => !MutableHashSet.has(overlay.cleared, prop.id)),
		surface: new Float32Array(CELLS),
		wear: new Float32Array(CELLS),
		x0: cx * CHUNK - PAD,
		z0: cz * CHUNK - PAD
	} satisfies Area
	for (const k of Array.range(0, CELLS - 1)) {
		const x = area.x0 + (k % SIZE)
		const z = area.z0 + Math.floor(k / SIZE)
		const at = chunkOf(x, z)
		const chunk = chunkAt(at.cx, at.cz)
		const key = tileKey(x, z)
		const tile = tileGround(chunk, at.index, MutableHashMap.get(overlay.edits, key))
		area.corners.set(tile.corners, k * 4)
		area.deck[k] = Option.getOrElse(tile.deck, () => Infinity)
		area.ground[k] = tile.ground
		area.liquid[k] = tile.liquid
		area.surface[k] = tile.surface
		area.biome[k] = chunk.biome[at.index] ?? 0
		area.ore[k] = chunk.ore[at.index] ?? 0
		area.amount[k] = Option.getOrElse(MutableHashMap.get(overlay.amounts, key), () => chunk.amount[at.index] ?? 0)
		if (tile.ground === GROUND.road) area.wear[k] = 0.5
		if (tile.road) area.wear[k] = 1
	}
	return area
}

function cell(i: number, j: number) {
	return clamp(j, 0, SIZE - 1) * SIZE + clamp(i, 0, SIZE - 1)
}

function cornerLevel(area: Area, i: number, j: number, cx: number, cz: number) {
	return area.corners[cell(i, j) * 4 + cz * 2 + cx] ?? 0
}

function tileCorners(area: Area, i: number, j: number) {
	return Array.map(CORNER_OFFSETS, offset => cornerLevel(area, i, j, offset.x, offset.z))
}

// A neighbour's corner that touches this tile's corner (cx, cz) across the side (dx, dz).
function facing(side: {dx: number; dz: number}, cx: number, cz: number) {
	return {x: Math.abs(flag(side.dx !== 0) - cx), z: Math.abs(flag(side.dz !== 0) - cz)}
}

// Ground height in world units at an area point.
function heightAt(area: Area, px: number, pz: number) {
	const i = clamp(Math.floor(px), 0, SIZE - 1)
	const j = clamp(Math.floor(pz), 0, SIZE - 1)
	const fx = clamp(px - i, 0, 1)
	const fz = clamp(pz - j, 0, 1)
	return (
		mix(
			mix(cornerLevel(area, i, j, 0, 0), cornerLevel(area, i, j, 1, 0), fx),
			mix(cornerLevel(area, i, j, 0, 1), cornerLevel(area, i, j, 1, 1), fx),
			fz
		) * LEVEL
	)
}

/* ───────── cliff colours: each wall's palette is the biomes' share over the 9 × 9 tiles round it ───────── */

function biomeShares(area: Area) {
	const rows = new Float32Array(CELLS * BIOME_SHAPE.length)
	const shares = new Float32Array(CELLS * BIOME_SHAPE.length)
	function addShares(span: {at: number; count: number; from: number}) {
		for (const biome of EVERY_BIOME) {
			shares[span.at + biome] = (shares[span.at + biome] ?? 0) + (rows[span.from + biome] ?? 0) / span.count
		}
	}
	for (const j of ROWS) {
		for (const i of ROWS) {
			const span = Array.filter(Array.range(i - 4, i + 4), a => a >= 0 && a < SIZE)
			for (const a of span) {
				const at = (j * SIZE + i) * BIOME_SHAPE.length + (area.biome[j * SIZE + a] ?? 0)
				rows[at] = (rows[at] ?? 0) + 1 / span.length
			}
		}
	}
	for (const j of ROWS) {
		for (const i of ROWS) {
			const span = Array.filter(Array.range(j - 4, j + 4), b => b >= 0 && b < SIZE)
			for (const b of span) {
				addShares({
					at: (j * SIZE + i) * BIOME_SHAPE.length,
					count: span.length,
					from: (b * SIZE + i) * BIOME_SHAPE.length
				})
			}
		}
	}
	return shares
}

function bandColour(biome: number, level: number, xm: number) {
	const list = STRATA_RGB[biome] ?? []
	const band = list[((level % list.length) + list.length) % list.length] ?? ROAD
	// Ruin walls grow moss in patches.
	if (biome === 5 && dither(Math.floor(xm * 2), level) > 0.85) return blend(band, MOSS, 0.5)
	return band
}

/* ───────── ore fields drawn like a biome border: blurred fill, a noisy threshold, worked ground the same way ───────── */

function blurPass(from: Float32Array) {
	const across = new Float32Array(CELLS)
	const out = new Float32Array(CELLS)
	for (const j of ROWS) {
		for (const i of ROWS) {
			across[j * SIZE + i] =
				((from[cell(i - 1, j)] ?? 0) + 2 * (from[j * SIZE + i] ?? 0) + (from[cell(i + 1, j)] ?? 0)) / 4
		}
	}
	for (const j of ROWS) {
		for (const i of ROWS) {
			out[j * SIZE + i] =
				((across[cell(i, j - 1)] ?? 0) + 2 * (across[j * SIZE + i] ?? 0) + (across[cell(i, j + 1)] ?? 0)) / 4
		}
	}
	return out
}

function blur(source: Float32Array) {
	return blurPass(blurPass(source))
}

// Each empty tile takes the first ore among its eight neighbours.
function spreadOres(before: Uint8Array) {
	return Uint8Array.from(Array.range(0, CELLS - 1), k => {
		const own = before[k] ?? 0
		if (own > 0) return own
		const i = k % SIZE
		const j = Math.floor(k / SIZE)
		return Option.getOrElse(
			Array.findFirst(
				Array.map(
					Array.filter(AROUND, near => i + near.x >= 0 && j + near.z >= 0 && i + near.x < SIZE && j + near.z < SIZE),
					near => before[(j + near.z) * SIZE + i + near.x] ?? 0
				),
				ore => ore > 0
			),
			() => 0
		)
	})
}

function oreStain(area: Area) {
	const fill = new Float32Array(CELLS)
	const worked = new Float32Array(CELLS)
	for (const k of Array.range(0, CELLS - 1)) {
		const ore = area.ore[k] ?? 0
		const amount = area.amount[k] ?? 0
		if (ore > 0 && amount > 0) fill[k] = 0.45 + 0.55 * Number.min(1, Math.sqrt(amount / (ORE_REF[ore] ?? 1)))
		if (ore > 0 && amount <= 0) worked[k] = 1
	}
	// The ore a tile round a field stains with: its own, or a neighbour's two tiles out.
	return {
		density: blur(fill),
		ores: spreadOres(spreadOres(area.ore)),
		worked: blur(worked),
		x0: area.x0,
		z0: area.z0
	} satisfies Stain
}

function bilinear(field: Float32Array, px: number, pz: number) {
	const x = px - 0.5
	const z = pz - 0.5
	const i = Math.floor(x)
	const j = Math.floor(z)
	return mix(
		mix(field[cell(i, j)] ?? 0, field[cell(i + 1, j)] ?? 0, x - i),
		mix(field[cell(i, j + 1)] ?? 0, field[cell(i + 1, j + 1)] ?? 0, x - i),
		z - j
	)
}

// How stained (s) and how worked (w) the ground is at an area point; zero far from any field.
function stainAt(stain: Stain, px: number, pz: number) {
	const density = bilinear(stain.density, px, pz)
	const worked = bilinear(stain.worked, px, pz)
	if (density < 1e-3 && worked < 1e-3) return {s: 0, w: 0}
	const wx = px + stain.x0
	const wz = pz + stain.z0
	const wobble = fbm(wx * 1.2, wz * 1.2, 11) - 0.5 + 0.4 * (valueNoise(wx * 3.3, wz * 3.3, 5) - 0.5)
	return {s: smoothstep(0.3, 0.68, density + 0.62 * wobble), w: smoothstep(0.3, 0.68, worked + 0.62 * wobble)}
}

// Four sub-quads per tile side where a stain may reach, so its edge can wander inside a tile; two elsewhere.
function subdivisions(stain: Stain, i: number, j: number) {
	const near = Array.some(Array.range(-1, 1), b =>
		Array.some(
			Array.range(-1, 1),
			a => (stain.density[cell(i + a, j + b)] ?? 0) > 1e-3 || (stain.worked[cell(i + a, j + b)] ?? 0) > 1e-3
		)
	)
	if (near) return 4
	return 2
}

/* ───────── the terrain mesh: tops blended across tiles, walls banded by the biomes' rock ───────── */

type Paint = {own: Rgb[]; shares: Float32Array; stain: Stain}

function ownColour(area: Area, k: number) {
	const colour = scaled(
		TOPS[area.ground[k] ?? 0] ?? ROAD,
		1 + (dither((area.x0 + (k % SIZE)) * 1.3, (area.z0 + Math.floor(k / SIZE)) * 2.1) - 0.5) * 0.06
	)
	if (area.ground[k] === GROUND.saltcrack) return scaled(colour, 0.9)
	return colour
}

// A corner's colour: the mean of the tiles meeting there at its height and of its class, so salt cracks keep crisp edges while plain ground blends.
function cornerColour(
	area: Area,
	paint: Paint,
	corner: {gx: number; gz: number; height: number},
	fallback: Rgb,
	crack: boolean
) {
	const near = Array.filter(CORNER_OFFSETS, offset => {
		const i = corner.gx - 1 + offset.x
		const j = corner.gz - 1 + offset.z
		return (
			(area.ground[cell(i, j)] === GROUND.saltcrack) === crack &&
			Math.abs(cornerLevel(area, i, j, 1 - offset.x, 1 - offset.z) - corner.height) <= 0.2
		)
	})
	if (Array.isArrayEmpty(near)) return fallback
	return scaled(
		Array.reduce(near, [0, 0, 0] satisfies Rgb, (total, offset) => {
			const own = paint.own[cell(corner.gx - 1 + offset.x, corner.gz - 1 + offset.z)] ?? fallback
			return [total[0] + own[0], total[1] + own[1], total[2] + own[2]] satisfies Rgb
		}),
		1 / near.length
	)
}

function wearAt(area: Area, gx: number, gz: number) {
	return (
		Array.reduce(
			CORNER_OFFSETS,
			0,
			(sum, offset) => sum + (area.wear[cell(gx - 1 + offset.x, gz - 1 + offset.z)] ?? 0)
		) / 4
	)
}

function worn(colour: Rgb, wear: number) {
	if (wear > 0) return blend(colour, ROAD, wear)
	return colour
}

function painted(paint: Paint, colour: Rgb, k: number, point: {px: number; pz: number}) {
	const stain = stainAt(paint.stain, point.px, point.pz)
	const ore = paint.stain.ores[k] ?? 0
	const dug = blend(scaled(colour, 1 - 0.2 * stain.w), WORKED, 0.42 * stain.w)
	if (stain.s > 0 && ore > 0) return blend(dug, ORE_TINTS[ore - 1] ?? dug, 0.78 * stain.s)
	return dug
}

function quad(lattice: {colour: Rgb; point: Vec}[], at: number, row: number) {
	const p = lattice[at]
	const q = lattice[at + 1]
	const r = lattice[at + row]
	const s = lattice[at + row + 1]
	if (p === undefined || q === undefined || r === undefined || s === undefined) return
	triangle('terrain', [p.point, r.point, q.point], [p.colour, r.colour, q.colour])
	triangle('terrain', [q.point, r.point, s.point], [q.colour, r.colour, s.colour])
}

function topOfTile(area: Area, paint: Paint, i: number, j: number) {
	const k = j * SIZE + i
	const own = paint.own[k] ?? ROAD
	const wear = area.wear[k] ?? 0
	const levels = tileCorners(area, i, j)
	const corners = Array.map(CORNER_OFFSETS, (offset, n) =>
		worn(
			cornerColour(
				area,
				paint,
				{gx: i + offset.x, gz: j + offset.z, height: levels[n] ?? 0},
				own,
				area.ground[k] === GROUND.saltcrack
			),
			Number.min(wearAt(area, i + offset.x, j + offset.z), 0.6 + 0.4 * flag(wear > 0))
		)
	)
	const middle = worn(own, wear)
	const steps = subdivisions(paint.stain, i, j)
	const lattice = Array.flatMap(Array.range(0, steps), b =>
		Array.map(Array.range(0, steps), a => {
			const fx = a / steps
			const fz = b / steps
			const level = mix(mix(levels[0] ?? 0, levels[1] ?? 0, fx), mix(levels[2] ?? 0, levels[3] ?? 0, fx), fz)

			return {
				colour: painted(
					paint,
					blend(
						blend(blend(corners[0] ?? own, corners[1] ?? own, fx), blend(corners[2] ?? own, corners[3] ?? own, fx), fz),
						middle,
						1 - 0.5 * (Math.abs(2 * fx - 1) + Math.abs(2 * fz - 1))
					),
					k,
					{px: i + fx, pz: j + fz}
				),
				point: [area.x0 + i + fx, level * LEVEL, area.z0 + j + fz] satisfies Vec
			}
		})
	)
	for (const b of Array.range(0, steps - 1)) {
		for (const a of Array.range(0, steps - 1)) quad(lattice, b * (steps + 1) + a, steps + 1)
	}
}

// A polygon (along the edge 0..1, height) cut where keep turns false at the height at.
function cut(points: [number, number][], keep: (y: number) => boolean, at: number) {
	return Array.flatMap(points, (point, index) => {
		const following = points[(index + 1) % points.length] ?? point
		const own = Array.filter([point], kept => keep(kept[1]))
		if (keep(point[1]) === keep(following[1])) return own
		return [
			...own,
			[point[0] + ((following[0] - point[0]) * (at - point[1])) / (following[1] - point[1]), at] satisfies [
				number,
				number
			]
		]
	})
}

// The greatest vertical extent of a wall piece, which peaks at one of its vertices.
function thickness(polygon: [number, number][]) {
	if (polygon.length < 3) return 0
	return Array.reduce(polygon, 0, (widest, probe) => {
		const ys = Array.flatMap(polygon, (point, index) => {
			const following = polygon[(index + 1) % polygon.length] ?? point
			if (Math.abs(point[0] - probe[0]) < 1e-9) return [point[1]]
			if ((point[0] - probe[0]) * (following[0] - probe[0]) < 0) {
				return [point[1] + ((following[1] - point[1]) * (probe[0] - point[0])) / (following[0] - point[0])]
			}
			return []
		})
		if (Array.isArrayEmpty(ys)) return widest
		return Number.max(widest, highest(ys) - lowest(ys))
	})
}

function wallShape(ha: number, hb: number, na: number, nb: number) {
	const da = ha - na
	const db = hb - nb
	if (da >= -1e-3 && db >= -1e-3) {
		return {
			bottoms: [na, nb],
			polygon: [
				[0, ha],
				[1, hb],
				[1, nb],
				[0, na]
			],
			tops: [ha, hb]
		} satisfies Wall
	}
	// Where the two tiles cross along the edge, each owns only the triangle where it is the higher one.
	const s = da / (da - db)
	const y = mix(ha, hb, s)
	if (da > 0) {
		return {
			bottoms: [na, y],
			polygon: [
				[0, ha],
				[s, y],
				[0, na]
			],
			tops: [ha, y]
		} satisfies Wall
	}
	return {
		bottoms: [y, nb],
		polygon: [
			[s, y],
			[1, hb],
			[1, nb]
		],
		tops: [y, hb]
	} satisfies Wall
}

function wallBands(paint: Paint, piece: {k: number; lip: number; shape: Wall; xm: number; zm: number}) {
	const top = highest(piece.shape.tops)
	const bottom = lowest(piece.shape.bottoms)
	const cutAt = top - flag(top - highest(piece.shape.bottoms) > 0.5) * piece.lip
	return [
		...Array.filter(
			[{colour: scaled(paint.own[piece.k] ?? ROAD, 0.93), from: cutAt, to: top + 1}],
			band => band.from < top
		),
		...Array.flatMap(
			Array.filter(
				Array.range(Math.floor(bottom), Number.max(Math.floor(bottom), Math.ceil(cutAt) - 1)),
				level => level < cutAt
			),
			(level: number) => {
				// The biomes' rock bands at this level, weighted by their share round the wall.

				const colour = scaled(
					Array.reduce(EVERY_BIOME, [0, 0, 0] satisfies Rgb, (sum, biome) => {
						const share = paint.shares[piece.k * BIOME_SHAPE.length + biome] ?? 0
						if (share < 0.002) return sum
						const band = bandColour(biome, level, piece.xm)
						return [sum[0] + band[0] * share, sum[1] + band[1] * share, sum[2] + band[2] * share] satisfies Rgb
					}),
					1 + (dither(piece.xm * 3.1 + level, piece.zm * 1.7) - 0.5) * 0.05
				)
				return Array.filter(
					[
						{colour, from: level, to: Number.min(level + 0.82, cutAt)},
						{colour: scaled(colour, 0.9), from: level + 0.82, to: Number.min(level + 1, cutAt)}
					],
					band => band.from < cutAt
				)
			}
		)
	]
}

// A full band's own colour, or a sliver's nearest full band's.
function nearestColour(full: {colour: Rgb; index: number}[], index: number, fallback: Rgb) {
	return Array.reduce(full, {colour: fallback, distance: 1e9}, (best, other) => {
		const distance = Math.abs(other.index - index)
		if (distance < best.distance) return {colour: other.colour, distance}
		return best
	}).colour
}

function fan(points: Vec[], colour: Rgb) {
	const first = points[0]
	if (first === undefined) return
	for (const n of Array.range(1, points.length - 2)) {
		const second = points[n]
		const third = points[n + 1]
		if (second !== undefined && third !== undefined) {
			triangle('terrain', [first, second, third], [colour, colour, colour])
		}
	}
}

function wall(area: Area, paint: Paint, piece: {k: number; lip: number; shape: Wall; side: Side}) {
	const i = piece.k % SIZE
	const j = Math.floor(piece.k / SIZE)
	const ax = area.x0 + i + piece.side.ax
	const az = area.z0 + j + piece.side.az
	const bx = area.x0 + i + piece.side.bx
	const bz = area.z0 + j + piece.side.bz
	const pieces = Array.sort(
		Array.filter(
			Array.map(wallBands(paint, {...piece, xm: (ax + bx) / 2, zm: (az + bz) / 2}), band => {
				const polygon = cut(
					cut(piece.shape.polygon, y => y >= band.from - 1e-6, band.from),
					y => y <= band.to + 1e-6,
					band.to
				)
				return {...band, polygon, thick: thickness(polygon)}
			}),
			band => band.thick > 0
		),
		(first: {from: number}, second: {from: number}) => Number.sign(first.from - second.from)
	)
	const full = Array.filter(
		Array.map(pieces, (band, index) => ({colour: band.colour, index, thick: band.thick})),
		// A band thinner than 0.06 levels takes its neighbour's colour, so no hairline streak runs along a wall.
		entry => entry.thick >= 0.06
	)
	Array.forEach(pieces, (band, index) => {
		fan(
			Array.map(band.polygon, point => [mix(ax, bx, point[0]), point[1] * LEVEL, mix(az, bz, point[0])] satisfies Vec),
			nearestColour(full, index, pieces[0]?.colour ?? band.colour)
		)
	})
}

function wallsOfTile(area: Area, paint: Paint, i: number, j: number) {
	const k = j * SIZE + i
	for (const side of SIDES) {
		const ha = cornerLevel(area, i, j, side.ax, side.az)
		const hb = cornerLevel(area, i, j, side.bx, side.bz)
		const ta = facing(side, side.ax, side.az)
		const tb = facing(side, side.bx, side.bz)
		const na = cornerLevel(area, i + side.dx, j + side.dz, ta.x, ta.z)
		const nb = cornerLevel(area, i + side.dx, j + side.dz, tb.x, tb.z)
		if (ha - na > 1e-3 || hb - nb > 1e-3) {
			wall(area, paint, {
				k,
				lip: flag(GROUND_LIP[area.ground[k] ?? 0] === true) * 0.16,
				shape: wallShape(ha, hb, na, nb),
				side
			})
		}
	}
}

function terrain(area: Area, paint: Paint) {
	for (const j of INNER) {
		for (const i of INNER) {
			topOfTile(area, paint, i, j)
			wallsOfTile(area, paint, i, j)
		}
	}
	return take('terrain')
}

/* ───────── liquids: a surface per kind with the distance to the shore per vertex, and falls down to lower ground ───────── */

type LiquidLists = {
	along: MutableList.MutableList<number>
	falls: MutableList.MutableList<number>
	positions: MutableList.MutableList<number>
	shore: MutableList.MutableList<number>
}

function shoreDistance(area: Area, px: number, pz: number) {
	const i0 = Math.floor(px)
	const j0 = Math.floor(pz)
	return Array.reduce(Array.range(j0 - 3, j0 + 3), 3, (best, j) =>
		Array.reduce(Array.range(i0 - 3, i0 + 3), best, (closest, i) => {
			if ((area.liquid[cell(i, j)] ?? 0) > 0) return closest
			return Number.min(closest, Math.hypot(highest([i - px, 0, px - i - 1]), highest([j - pz, 0, pz - j - 1])))
		})
	)
}

// What a fall lands on beside a liquid tile: the neighbour's own liquid surface, else its ground.
function lowerSurface(area: Area, k: number, ground: number) {
	if ((area.liquid[k] ?? 0) > 0) return area.surface[k] ?? 0
	return ground
}

function fall(area: Area, lists: LiquidLists, at: {i: number; j: number; level: number; side: Side}) {
	const ni = at.i + at.side.dx
	const nj = at.j + at.side.dz
	const ta = facing(at.side, at.side.ax, at.side.az)
	const tb = facing(at.side, at.side.bx, at.side.bz)
	const below = lowerSurface(
		area,
		cell(ni, nj),
		Number.max(cornerLevel(area, ni, nj, ta.x, ta.z), cornerLevel(area, ni, nj, tb.x, tb.z))
	)
	if (below >= at.level - 0.05) return
	const ax = area.x0 + at.i + at.side.ax + at.side.dx * 0.012
	const az = area.z0 + at.j + at.side.az + at.side.dz * 0.012
	const bx = area.x0 + at.i + at.side.bx + at.side.dx * 0.012
	const bz = area.z0 + at.j + at.side.bz + at.side.dz * 0.012
	const drop = (at.level - below) * LEVEL
	const corners = [
		[ax, at.level * LEVEL, az, ax + az, 0],
		[bx, at.level * LEVEL, bz, bx + bz, 0],
		[ax, below * LEVEL, az, ax + az, drop],
		[bx, below * LEVEL, bz, bx + bz, drop]
	]
	for (const n of [0, 2, 1, 1, 2, 3]) {
		const point = corners[n] ?? []
		for (const value of Array.take(point, 3)) MutableList.append(lists.falls, value)
		MutableList.append(lists.along, point[3] ?? 0)
		MutableList.append(lists.along, point[4] ?? 0)
		MutableList.append(lists.along, drop)
	}
}

function liquidTile(area: Area, lists: LiquidLists, i: number, j: number) {
	const level = area.surface[j * SIZE + i] ?? 0
	for (const b of [0, 1, 2]) {
		for (const a of [0, 1, 2]) {
			for (const corner of LIQUID_TRIANGLES) {
				const px = i + (a + corner.a) / 3
				const pz = j + (b + corner.b) / 3
				MutableList.append(lists.positions, area.x0 + px)
				MutableList.append(lists.positions, level * LEVEL)
				MutableList.append(lists.positions, area.z0 + pz)
				MutableList.append(lists.shore, shoreDistance(area, px, pz))
			}
		}
	}
	for (const side of SIDES) fall(area, lists, {i, j, level, side})
}

function liquids(area: Area) {
	return Array.map(
		Array.filter(
			Array.filter(Record.values(LIQUID), kind => kind !== LIQUID.none),
			kind => Array.some(INNER, j => Array.some(INNER, i => area.liquid[j * SIZE + i] === kind))
		),
		kind => {
			const lists = {
				along: MutableList.make<number>(),
				falls: MutableList.make<number>(),
				positions: MutableList.make<number>(),
				shore: MutableList.make<number>()
			}
			for (const j of INNER) {
				for (const i of INNER) {
					if (area.liquid[j * SIZE + i] === kind) liquidTile(area, lists, i, j)
				}
			}
			return {
				along: Float32Array.from(MutableList.toArray(lists.along)),
				falls: Float32Array.from(MutableList.toArray(lists.falls)),
				kind,
				positions: Float32Array.from(MutableList.toArray(lists.positions)),
				shore: Float32Array.from(MutableList.toArray(lists.shore))
			}
		}
	)
}

/* ───────── shapes for props: three's primitives flattened once, stamped into a chunk's merged mesh ───────── */

function unindexed(geometry: THREE.BufferGeometry) {
	if (geometry.index === null) return geometry
	return geometry.toNonIndexed()
}

function shapeOf(key: string, make: () => Shape) {
	return Option.getOrElse(MutableHashMap.get(SHAPES, key), () => {
		const shape = make()
		MutableHashMap.set(SHAPES, key, shape)
		return shape
	})
}

function geometryShape(
	geometry: THREE.BufferGeometry,
	colour: Rgb,
	shade: (y: number, ny: number) => number = () => 1
) {
	const flat = unindexed(geometry)
	if (!flat.hasAttribute('normal')) flat.computeVertexNormals()
	const positions = Float32Array.from(flat.getAttribute('position').array)
	const normals = Float32Array.from(flat.getAttribute('normal').array)
	const colors = new Float32Array(positions.length)
	for (const n of Array.range(0, positions.length / 3 - 1)) {
		colors.set(scaled(colour, shade(positions[n * 3 + 1] ?? 0, normals[n * 3 + 1] ?? 0)), n * 3)
	}
	return {colors, normals, positions} satisfies Shape
}

// Faces of a shape whose vertices moved, shaded flat.
function faceted(geometry: THREE.BufferGeometry) {
	const flat = unindexed(geometry)
	flat.deleteAttribute('normal')
	flat.computeVertexNormals()
	return flat
}

function concat(shapes: Shape[]) {
	const size = Array.reduce(shapes, 0, (sum, shape) => sum + shape.positions.length)
	const out = {colors: new Float32Array(size), normals: new Float32Array(size), positions: new Float32Array(size)}
	Array.reduce(shapes, 0, (at, shape) => {
		out.colors.set(shape.colors, at)
		out.normals.set(shape.normals, at)
		out.positions.set(shape.positions, at)
		return at + shape.positions.length
	})
	return out satisfies Shape
}

function primitive(key: string, make: () => THREE.BufferGeometry) {
	return shapeOf(key, () => geometryShape(make(), WHITE))
}

function cylinder(top: number, bottom: number, height: number, segments: number) {
	return primitive(
		`cy${top},${bottom},${height},${segments}`,
		() => new THREE.CylinderGeometry(top, bottom, height, segments)
	)
}

function sphere(radius: number, width: number, height: number) {
	return primitive(`sp${radius},${width},${height}`, () => new THREE.SphereGeometry(radius, width, height))
}

function box() {
	return primitive('box', () => new THREE.BoxGeometry(1, 1, 1))
}

function rock() {
	return primitive('rock', () => new THREE.DodecahedronGeometry(1, 0))
}

function matrixOf(position: Vec, rotation: Vec, scale: Vec) {
	EULER.set(rotation[0], rotation[1], rotation[2])
	QUATERNION.setFromEuler(EULER)
	return new THREE.Matrix4().compose(
		new THREE.Vector3(position[0], position[1], position[2]),
		QUATERNION,
		new THREE.Vector3(scale[0], scale[1], scale[2])
	)
}

function stamp(name: Sink, shape: Shape, matrix: THREE.Matrix4, colour: Rgb) {
	reserve(name, shape.positions.length / 3)
	const target = SCRATCH[name]
	NORMAL.getNormalMatrix(matrix)
	const flip = flag(matrix.determinant() < 0)
	for (const n of Array.range(0, shape.positions.length / 3 - 1)) {
		// A mirrored part winds its triangles the other way round.
		const source = n + flip * (2 - 2 * (n % 3))
		const at = target.count * 3
		POINT.fromArray(shape.positions, source * 3).applyMatrix4(matrix)
		POINT.toArray(target.positions, at)
		POINT.fromArray(shape.normals, source * 3)
			.applyMatrix3(NORMAL)
			.normalize()
		POINT.toArray(target.normals, at)
		target.colors[at] = colour[0] * (shape.colors[source * 3] ?? 1)
		target.colors[at + 1] = colour[1] * (shape.colors[source * 3 + 1] ?? 1)
		target.colors[at + 2] = colour[2] * (shape.colors[source * 3 + 2] ?? 1)
		target.count += 1
	}
}

function roleColour(role: string) {
	if (String.startsWith('#')(role)) return rgb(role)
	return rgb(
		Option.getOrElse(
			Option.map(
				Array.findFirst(Record.toEntries(ROLE), entry => entry[0] === role),
				entry => entry[1]
			),
			() => ROLE.rock
		)
	)
}

// A part of a prop, placed in the prop's own frame and stamped through the prop's placement.
function part(
	place: THREE.Matrix4,
	shape: Shape,
	colour: string,
	at: {position: Vec; rotation?: Vec; scale?: Vec; target?: Sink}
) {
	const local = matrixOf(at.position, at.rotation ?? [0, 0, 0], at.scale ?? [1, 1, 1])
	stamp(at.target ?? 'props', shape, new THREE.Matrix4().multiplyMatrices(place, local), roleColour(colour))
}

/* ───────── trees: flat-shaded lobes and trunks, one baked shape per species variant ───────── */

function lobe(radius: number, seed: number, at: Vec, scale: Vec, detail: number) {
	const geometry = new THREE.IcosahedronGeometry(1, detail)
	const positions = geometry.getAttribute('position')
	for (const n of Array.range(0, positions.count - 1)) {
		const px = positions.getX(n)
		const py = positions.getY(n)
		const pz = positions.getZ(n)
		const jitter = 1 + (dither(px * 3.1 + pz * 1.7 + seed, py * 2.3 + seed * 0.37) - 0.5) * 0.3
		positions.setXYZ(
			n,
			px * radius * scale[0] * jitter + at[0],
			py * radius * scale[1] * jitter + at[1],
			pz * radius * scale[2] * jitter + at[2]
		)
	}
	return geometry
}

function leaves(
	colour: string,
	top: number,
	crown: {at: Vec; detail?: number; radius: number; scale: Vec; seed: number}
) {
	return {
		colour,
		geometry: lobe(crown.radius, crown.seed, crown.at, crown.scale, crown.detail ?? 1),
		// Leaves darken toward the underside and the inside of the crown.
		shade: (y: number, ny: number) => 0.78 + 0.26 * clamp(y / top, 0, 1) + 0.08 * ny
	} satisfies Piece
}

function limb(shape: {
	at: Vec
	bottom: number
	height: number
	rx?: number
	rz?: number
	segments: number
	top: number
}) {
	return new THREE.CylinderGeometry(shape.top, shape.bottom, shape.height, shape.segments, 1)
		.translate(0, shape.height / 2, 0)
		.rotateX(shape.rx ?? 0)
		.rotateZ(shape.rz ?? 0)
		.translate(shape.at[0], shape.at[1], shape.at[2])
}

// One tier of a conifer: needles darker at the bottom, and a smaller cone on top, snow or a lighter green.
function tier(
	shape: {radius: number; segments: number; snow: string; top: number; turn: number; y: number},
	colour: string,
	height: number
) {
	function cone(radius: number, tall: number, y: number) {
		return new THREE.ConeGeometry(radius, tall, shape.segments, 1, false)
			.rotateY(shape.turn)
			.translate(0, y + tall / 2, 0)
	}
	return [
		{
			colour,
			geometry: cone(shape.radius, height, shape.y),
			shade: (y: number) => 0.82 + 0.2 * clamp((y - shape.y) / height, 0, 1)
		},
		{
			colour: shape.snow,
			geometry: cone(shape.radius * shape.top * 1.05, height * shape.top, shape.y + height * (1 - shape.top) + 0.004)
		}
	] satisfies Piece[]
}

const SPECIES: Record<Species, (seed: number, snow: string) => Piece[]> = {
	acacia: (seed: number) => {
		const random = randomOf(seed)
		const lean = (random() - 0.5) * 0.5
		const tx = -Math.sin(lean) * 0.5
		const ty = Math.cos(lean) * 0.5
		return [
			{colour: BARK, geometry: limb({at: [0, 0, 0], bottom: 0.055, height: 0.5, rz: lean, segments: 6, top: 0.035})},
			{
				colour: BARK,
				geometry: limb({at: [tx, ty - 0.02, 0], bottom: 0.03, height: 0.28, rx: 0.2, rz: 0.7, segments: 5, top: 0.02})
			},
			{
				colour: BARK,
				geometry: limb({at: [tx, ty - 0.02, 0], bottom: 0.03, height: 0.28, rx: -0.3, rz: -0.8, segments: 5, top: 0.02})
			},
			...Array.map(Array.range(0, 4), k => {
				const angle = (k / 5) * TAU + random()
				const distance = flag(k > 0) * 0.24
				return leaves('#b4c27a', 1, {
					at: [tx + Math.cos(angle) * distance, ty + 0.2 + random() * 0.04, Math.sin(angle) * distance],
					radius: 0.26 - flag(k > 0) * 0.06,
					scale: [1, 0.38, 1],
					seed: seed + k
				})
			})
		]
	},
	birch: (seed: number) => {
		const random = randomOf(seed)
		return [
			{colour: '#efe9df', geometry: limb({at: [0, 0, 0], bottom: 0.04, height: 0.95, segments: 6, top: 0.026})},
			...Array.map([0.22, 0.41, 0.58], y => ({
				colour: '#6f6862',
				geometry: limb({at: [0, y, 0], bottom: 0.0415, height: 0.025, segments: 6, top: 0.04})
			})),
			...Array.map(Array.range(0, 3), k => {
				const angle = (k / 4) * TAU + random()
				const distance = flag(k > 0) * 0.13
				return leaves('#bcd98f', 1.2, {
					at: [Math.cos(angle) * distance, 0.82 + k * 0.06 + random() * 0.05, Math.sin(angle) * distance],
					radius: 0.17 - flag(k > 0) * 0.03,
					scale: [1, 1.15, 1],
					seed: seed + k
				})
			})
		]
	},
	bush: (seed: number) => {
		const random = randomOf(seed)
		return Array.map(Array.range(0, 3), k => {
			const angle = (k / 4) * TAU + random()
			const distance = flag(k > 0) * 0.13
			return leaves('#93c27b', 0.3, {
				at: [Math.cos(angle) * distance, 0.15 - flag(k > 0) * 0.05, Math.sin(angle) * distance],
				radius: 0.16 - flag(k > 0) * (0.04 - random() * 0.03),
				scale: [1, 0.8, 1],
				seed: seed + k
			})
		})
	},
	fir: (seed: number, snow: string) => [
		{colour: BARK, geometry: limb({at: [0, 0, 0], bottom: 0.05, height: 0.24, segments: 6, top: 0.035})},
		...Array.flatMap(Array.range(0, 2), k =>
			tier(
				{radius: 0.44 - k * 0.1, segments: 8, snow, top: 0.45, turn: dither(seed, k) * TAU, y: 0.14 + k * 0.24},
				'#9cc4ad',
				0.4
			)
		)
	],
	// A maple in autumn: a broad, layered crown in one of the season's colours, a leaf or two of the next.
	maple: (seed: number) => {
		const random = randomOf(seed)
		const hues = ['#e8743f', '#f0a040', '#d9553a', '#f2c14e']
		const main = Array.getUnsafe(hues, Math.abs(seed) % hues.length)
		return [
			{colour: '#8f7560', geometry: limb({at: [0, 0, 0], bottom: 0.06, height: 0.46, segments: 7, top: 0.04})},
			{
				colour: '#8f7560',
				geometry: limb({at: [0, 0.32, 0], bottom: 0.028, height: 0.24, rz: -0.7, segments: 5, top: 0.02})
			},
			leaves(main, 1.1, {at: [0, 0.72, 0], radius: 0.34, scale: [1.15, 0.8, 1.15], seed}),
			...Array.map(Array.range(0, 3), k => {
				const angle = (k / 4) * TAU + random() * 0.8
				return leaves(Array.getUnsafe(hues, Math.abs(seed + k * flag(random() > 0.7)) % hues.length), 1.1, {
					at: [Math.cos(angle) * 0.22, 0.58 + random() * 0.16, Math.sin(angle) * 0.22],
					radius: 0.2 + random() * 0.05,
					scale: [1, 0.8, 1],
					seed: seed + k + 1
				})
			})
		]
	},
	oak: (seed: number) => {
		const random = randomOf(seed)
		return [
			{colour: BARK, geometry: limb({at: [0, 0, 0], bottom: 0.07, height: 0.5, segments: 7, top: 0.045})},
			{colour: BARK, geometry: limb({at: [0, 0.36, 0], bottom: 0.03, height: 0.26, rz: 0.8, segments: 5, top: 0.02})},
			{
				colour: BARK,
				geometry: limb({at: [0, 0.4, 0], bottom: 0.03, height: 0.24, rx: 0.7, rz: -0.4, segments: 5, top: 0.02})
			},
			leaves('#9fca84', 1.1, {at: [0, 0.74, 0], radius: 0.3, scale: [1, 1, 1], seed}),
			...Array.map(Array.range(0, 4), k => {
				const angle = (k / 5) * TAU + random() * 0.6
				const distance = 0.2 + random() * 0.06
				const radius = 0.19 + random() * 0.05
				return leaves('#9fca84', 1.1, {
					at: [Math.cos(angle) * distance, 0.6 + random() * 0.14, Math.sin(angle) * distance],
					radius,
					scale: [1, 1, 1],
					seed: seed + k + 1
				})
			}),
			leaves('#9fca84', 1.1, {
				at: [random() * 0.08 - 0.04, 0.98, random() * 0.08 - 0.04],
				radius: 0.17,
				scale: [1, 1, 1],
				seed: seed + 9
			})
		]
	},
	poplar: (seed: number) => [
		{colour: BARK, geometry: limb({at: [0, 0, 0], bottom: 0.05, height: 0.34, segments: 6, top: 0.035})},
		...Array.map(
			[
				{radius: 0.2, stretch: 1.5, y: 0.55},
				{radius: 0.18, stretch: 1.5, y: 0.86},
				{radius: 0.13, stretch: 1.5, y: 1.14},
				{radius: 0.08, stretch: 1.4, y: 1.33}
			],
			(row, k) =>
				leaves('#86b874', 1.4, {at: [0, row.y, 0], radius: row.radius, scale: [1, row.stretch, 1], seed: seed + k})
		)
	],
	shrub: (seed: number) => {
		const random = randomOf(seed)
		return Array.map(Array.range(0, 2), k => {
			const angle = (k / 3) * TAU + random()
			const distance = flag(k > 0) * 0.09
			return leaves('#c2bf86', 0.2, {
				at: [Math.cos(angle) * distance, 0.07, Math.sin(angle) * distance],
				detail: 0,
				radius: 0.1 + random() * 0.03,
				scale: [1, 0.7, 1],
				seed: seed + k
			})
		})
	},
	spruce: (seed: number, snow: string) => [
		{colour: BARK, geometry: limb({at: [0, 0, 0], bottom: 0.045, height: 0.3, segments: 6, top: 0.03})},
		...Array.flatMap(Array.range(0, 4), k =>
			tier(
				{radius: 0.36 - k * 0.062, segments: 7, snow, top: 0.5, turn: dither(seed, k) * TAU, y: 0.16 + k * 0.17},
				'#8bb8a1',
				0.34
			)
		)
	]
}

// A conifer's top tier: snow on snowy ground, a lighter green elsewhere.
function tipOf(snowy: boolean) {
	if (snowy) return '#f6f9fa'
	return '#a9cdb9'
}

/* ───────── the generator's props, merged per chunk with vertex colours; glowing bits apart ───────── */

function speciesOf(area: Area, prop: Prop, k: number) {
	if (prop.kind === 'pine' && dither(prop.x, prop.z) < 0.6) return 'spruce'
	if (prop.kind === 'pine') return 'fir'
	if (prop.kind === 'shrub') return 'bush'
	if (prop.kind === 'shrubDry') return 'shrub'
	if (prop.kind === 'maple') return 'maple'
	const biome = area.biome[k] ?? 0
	if (biome === 2 || biome === 8 || biome === 4) return 'acacia'
	const u = fbm(prop.x * 0.6, prop.z * 0.6, 21)
	if (u > 0.58) return 'poplar'
	if (u > 0.5) return 'birch'
	if (dither(prop.z, prop.x) < 0.22) return 'bush'
	return 'oak'
}

function placement(x: number, y: number, z: number, yaw: number, scale: number) {
	return matrixOf([x, y, z], [0, yaw, 0], [scale, scale, scale])
}

function plant(area: Area, prop: Prop, place: THREE.Matrix4, k: number) {
	const tint = (dither(prop.x * 3.3, prop.z * 1.7) - 0.5) * 0.12
	const species = speciesOf(area, prop, k)
	const variant = prop.id % 3
	const snowy = Array.contains(SNOWY, area.ground[k] ?? 0)

	stamp(
		'props',
		shapeOf(`tree:${species}:${variant}:${snowy}`, () =>
			concat(
				Array.map(SPECIES[species](11 + variant * 17, tipOf(snowy)), piece =>
					geometryShape(faceted(piece.geometry), rgb(piece.colour), piece.shade)
				)
			)
		),
		place,
		[1 + tint * 0.5, 1 + tint * 0.2, 1 - tint * 0.3]
	)
}

function cactus(place: THREE.Matrix4) {
	part(place, cylinder(0.05, 0.055, 0.5, 8), 'cactus', {position: [0, 0.25, 0]})
	part(place, sphere(0.05, 8, 5), 'cactus', {position: [0, 0.5, 0]})
	for (const sx of [-1, 1]) {
		part(place, cylinder(0.03, 0.03, 0.12, 6), 'cactus', {
			position: [sx * 0.08, 0.24 + sx * 0.04, 0],
			rotation: [0, 0, -Math.PI / 2]
		})
		part(place, cylinder(0.03, 0.03, 0.16, 6), 'cactus', {position: [sx * 0.13, 0.31 + sx * 0.04, 0]})
	}
}

function snag(place: THREE.Matrix4) {
	part(place, cylinder(0.025, 0.05, 0.6, 6), 'trunk', {position: [0, 0.3, 0], rotation: [0.08, 0, 0.06]})
	part(place, cylinder(0.012, 0.02, 0.25, 5), 'trunk', {position: [0.08, 0.45, 0], rotation: [0, 0, -0.9]})
}

function mushroom(place: THREE.Matrix4, prop: Prop) {
	const top = primitive('captop', () => new THREE.SphereGeometry(0.5, 18, 8, 0, TAU, 0, Math.PI / 2))
	const under = primitive('capunder', () => new THREE.CircleGeometry(0.5, 18).rotateX(Math.PI / 2))
	part(place, cylinder(0.07, 0.1, 1, 10), '#efe5dc', {position: [0, 0.5, 0]})
	part(place, top, CAP_HUES[prop.hue ?? 0] ?? '#e6a6c4', {position: [0, 0.98, 0], scale: [1, 0.55, 1]})
	if (prop.glow === true) part(place, under, '#b8f5e4', {position: [0, 0.975, 0], target: 'glow'})
	if (prop.glow !== true) part(place, under, '#f5e3ec', {position: [0, 0.975, 0]})
	for (const k of Array.range(0, 6)) {
		const angle = k * 2.3
		const distance = 0.18 + (k % 3) * 0.08
		part(place, sphere(0.04, 6, 4), '#fbf6f2', {
			position: [
				Math.cos(angle) * distance,
				0.97 + Math.sqrt(Number.max(0, 0.25 - distance * distance)) * 0.55,
				Math.sin(angle) * distance
			]
		})
	}
}

function spire(place: THREE.Matrix4, size: number) {
	for (const k of Array.range(0, 3)) {
		const angle = k * 1.7
		const height = (0.5 + dither(k, size) * 0.6) * size
		part(place, cylinder(0.04, 0.09, 1, 6), '#fbf8f2', {
			position: [Math.cos(angle) * 0.08 * size, height / 2, Math.sin(angle) * 0.08 * size],
			rotation: [Math.cos(angle) * 0.15, 0, Math.sin(angle) * 0.15],
			scale: [size, height, size]
		})
	}
}

function vent(place: THREE.Matrix4, size: number) {
	part(place, cylinder(0.18 * size, 0.24 * size, 0.12, 8), '#4a3f3a', {position: [0, 0.06, 0]})
	part(place, cylinder(0.12 * size, 0.12 * size, 0.02, 8), '#ffb07a', {position: [0, 0.125, 0], target: 'glow'})
}

type House = {depth: number; height: number; random: () => number; width: number}

// Shrubs on a ruin's roof, vines down its front and rubble at its foot.
function overgrowth(place: THREE.Matrix4, house: House) {
	const shrub = primitive('shrub', () => new THREE.IcosahedronGeometry(0.16, 0))
	for (const role of ['moss', 'leaf', 'moss']) {
		part(place, shrub, role, {
			position: [
				(house.random() - 0.5) * house.width * 0.7,
				house.height + 0.08,
				(house.random() - 0.5) * house.depth * 0.7
			],
			rotation: [house.random(), house.random() * 3, 0],
			scale: [1.2, 0.6, 1.2]
		})
	}
	Array.forEach(Array.range(0, 3), () => {
		const tall = house.height * (0.3 + house.random() * 0.5)
		part(place, box(), 'leaf2', {
			position: [(house.random() - 0.5) * house.width * 0.9, house.height * 0.7, house.depth / 2 + 0.02],
			scale: [0.06, tall, 0.02]
		})
	})
	Array.forEach(Array.range(0, 4), () => {
		part(place, rock(), 'concrete', {
			position: [(house.random() - 0.5) * house.width * 1.3, 0.04, house.depth / 2 + 0.15 + house.random() * 0.2],
			rotation: [house.random() * 3, house.random() * 3, 0],
			scale: [0.07, 0.05, 0.06]
		})
	})
}

// A ruined block: a concrete shell with dark window holes on its front and side.
function ruin(place: THREE.Matrix4, prop: Prop) {
	const house = {
		depth: prop.dp ?? 1,
		height: prop.ht ?? 1,
		random: randomOf(prop.seed ?? 1),
		width: prop.wd ?? 1
	} satisfies House
	part(place, box(), 'concrete', {position: [0, house.height / 2, 0], scale: [house.width, house.height, house.depth]})
	part(place, box(), '#d9d1c3', {
		position: [0, house.height + 0.03, 0],
		scale: [house.width + 0.06, 0.06, house.depth + 0.06]
	})
	const rows = Array.range(0, Number.max(1, Number.round(house.height / 0.42, 0)) - 1)
	const across = Number.max(1, Number.round(house.width / 0.45, 0))
	const deep = Number.max(1, Number.round(house.depth / 0.45, 0))
	const holes = [
		...Array.flatMap(rows, y => Array.map(Array.range(0, across - 1), q => ({front: true, q, y}))),
		...Array.flatMap(rows, y => Array.map(Array.range(0, deep - 1), q => ({front: false, q, y})))
	]
	for (const hole of holes) {
		const x = -house.width / 2 + ((hole.q + 0.5) * house.width) / across
		const z = -house.depth / 2 + ((hole.q + 0.5) * house.depth) / deep
		const open = house.random() > 0.25 + 0.05 * flag(!hole.front)
		if (open && hole.front) {
			part(place, box(), 'cave', {
				position: [x, 0.22 + hole.y * 0.42, house.depth / 2 + 0.005],
				scale: [0.16, 0.2, 0.02]
			})
		}
		if (open && !hole.front) {
			part(place, box(), 'cave', {
				position: [house.width / 2 + 0.005, 0.22 + hole.y * 0.42, z],
				scale: [0.02, 0.2, 0.16]
			})
		}
	}
	overgrowth(place, house)
}

// Glass shards: a few fused blades leaning out of the sand, catching the light.
function shard(place: THREE.Matrix4, size: number) {
	const blade = primitive('blade', () => new THREE.OctahedronGeometry(1, 0).scale(0.05, 0.5, 0.12).translate(0, 0.5, 0))
	for (const k of Array.range(0, 3)) {
		const angle = k * 2.1 + size
		part(place, blade, Array.getUnsafe(['#a9e3d6', '#c5efe6', '#8fd2c4'], k % 3), {
			position: [Math.cos(angle) * 0.07, 0, Math.sin(angle) * 0.07],
			rotation: [Math.cos(angle) * 0.35, angle, Math.sin(angle) * 0.35],
			scale: [1, (0.5 + dither(k, size) * 0.6) * size, 1]
		})
	}
}

// A geyser: a cone of travertine round a steaming turquoise eye.
function geyser(place: THREE.Matrix4) {
	part(place, cylinder(0.16, 0.42, 0.18, 10), '#efe3cf', {position: [0, 0.09, 0]})
	part(place, cylinder(0.1, 0.16, 0.1, 10), '#e7c39a', {position: [0, 0.22, 0]})
	part(place, cylinder(0.08, 0.08, 0.02, 10), '#9ff0ea', {position: [0, 0.27, 0], target: 'glow'})
	for (const k of Array.range(0, 2)) {
		part(place, sphere(0.09 + k * 0.03, 8, 6), '#ffffff', {position: [k * 0.03, 0.42 + k * 0.17, -k * 0.02]})
	}
}

// A bamboo clump: green canes of different heights, ringed at their joints, a few leaves at the top.
function bamboo(place: THREE.Matrix4, size: number) {
	const random = randomOf(Math.floor(size * 1000))
	for (const k of Array.range(0, 5)) {
		const angle = k * 1.3 + random()
		const distance = 0.04 + random() * 0.12
		const tall = (0.7 + random() * 0.6) * size
		const lean: Vec = [(random() - 0.5) * 0.12, 0, (random() - 0.5) * 0.12]
		// A point a share of the way up the leaning cane.
		function up(share: number) {
			return [
				Math.cos(angle) * distance - lean[2] * tall * share,
				tall * share,
				Math.sin(angle) * distance + lean[0] * tall * share
			] satisfies Vec
		}
		part(place, cylinder(0.018, 0.022, 1, 6), Array.getUnsafe(['#8fbf5a', '#a3cc6a'], k % 2), {
			position: up(0.5),
			rotation: lean,
			scale: [1, tall, 1]
		})
		for (const joint of [0.25, 0.5, 0.75]) {
			part(place, cylinder(0.024, 0.024, 0.012, 6), '#6f9a45', {position: up(joint), rotation: lean})
		}
		part(place, sphere(0.08, 6, 4), '#9fd06a', {position: up(1), scale: [1.4, 0.5, 1]})
	}
}

// Coral: branching fingers or a fan in one of the reef's colours.
function coral(place: THREE.Matrix4, prop: Prop) {
	const colour = Array.getUnsafe(['#f29a8c', '#f5b071', '#c39be0'], prop.hue ?? 0)
	const random = randomOf(prop.id)
	if (random() < 0.4) {
		part(place, sphere(0.2, 10, 6), colour, {position: [0, 0.18, 0], scale: [1, 0.85, 0.25]})
		part(place, cylinder(0.02, 0.03, 0.1, 5), colour, {position: [0, 0.03, 0]})
		return
	}
	for (const k of Array.range(0, 5)) {
		const angle = k * 1.25 + random()
		const tall = 0.18 + random() * 0.2
		part(place, cylinder(0.022, 0.03, 1, 6), colour, {
			position: [Math.cos(angle) * 0.05, tall / 2, Math.sin(angle) * 0.05],
			rotation: [Math.sin(angle) * 0.5, 0, -Math.cos(angle) * 0.5],
			scale: [1, tall, 1]
		})
		part(place, sphere(0.032, 6, 4), colour, {
			position: [Math.cos(angle) * (0.05 + tall * 0.48), tall * 0.9, Math.sin(angle) * (0.05 + tall * 0.48)]
		})
	}
}

// A hoodoo: a column of banded red rock under a harder pale cap.
function hoodoo(place: THREE.Matrix4, size: number) {
	const tall = 0.5 * size
	part(place, cylinder(0.08, 0.13, 1, 7), '#c8634c', {position: [0, tall * 0.35, 0], scale: [size, tall * 0.7, size]})
	part(place, cylinder(0.06, 0.08, 1, 7), '#d9805f', {position: [0, tall * 0.82, 0], scale: [size, tall * 0.3, size]})
	part(place, cylinder(0.12, 0.1, 0.06, 7), '#efd9c0', {position: [0, tall * 0.98, 0], scale: [size, 1, size]})
}

// A glowing crystal: a cluster of hexagonal prisms with pointed tips.
function crystal(place: THREE.Matrix4, prop: Prop) {
	const colour = Array.getUnsafe(['#bfe9ff', '#d9c8ff', '#a6f0e4'], prop.hue ?? 0)
	const prism = primitive('prism', () => new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6).translate(0, 0.15, 0))
	const tip = primitive('prismtip', () => new THREE.ConeGeometry(0.05, 0.1, 6).translate(0, 0.35, 0))
	for (const k of Array.range(0, 3)) {
		const angle = k * 2.1
		const at = {
			position: [Math.cos(angle) * 0.05 * flag(k > 0), 0, Math.sin(angle) * 0.05 * flag(k > 0)] satisfies Vec,
			rotation: [Math.cos(angle) * 0.4 * flag(k > 0), 0, Math.sin(angle) * 0.4 * flag(k > 0)] satisfies Vec,
			scale: [prop.s, prop.s * (1 - 0.3 * flag(k > 0)), prop.s] satisfies Vec
		}
		part(place, prism, colour, at)
		part(place, tip, colour, {...at, target: 'glow'})
	}
}

function boulder(prop: Prop, y: number) {
	stamp(
		'props',
		rock(),
		matrixOf([prop.x, y + prop.s * 0.4, prop.z], [prop.yaw, prop.yaw * 2, 0], [prop.s * 1.6, prop.s, prop.s * 1.3]),
		roleColour(prop.role ?? 'rock')
	)
}

function generatorProp(area: Area, prop: Prop) {
	const px = prop.x - area.x0
	const pz = prop.z - area.z0
	const k = cell(Math.floor(px), Math.floor(pz))
	const y = heightAt(area, px, pz)
	const place = placement(prop.x, y, prop.z, prop.yaw, prop.s)
	const upright = placement(prop.x, y, prop.z, prop.yaw, 1)
	if (Array.contains(PLANTS, prop.kind)) plant(area, prop, place, k)
	if (prop.kind === 'cactus') cactus(place)
	if (prop.kind === 'snag') snag(place)
	if (prop.kind === 'cap') mushroom(place, prop)
	if (prop.kind === 'spire') spire(upright, prop.s)
	if (prop.kind === 'vent') vent(placement(prop.x, y, prop.z, 0, 1), prop.s)
	if (prop.kind === 'ruin') ruin(upright, prop)
	if (prop.kind === 'rock') boulder(prop, y)
	if (prop.kind === 'shard') shard(upright, prop.s)
	if (prop.kind === 'geyser') geyser(upright)
	if (prop.kind === 'bamboo') bamboo(upright, prop.s)
	if (prop.kind === 'coral') coral(place, prop)
	if (prop.kind === 'hoodoo') hoodoo(upright, prop.s)
	if (prop.kind === 'crystal') crystal(upright, prop)
}

// Bridges the player built: a plank deck at its level with a kerb each side.
function decks(area: Area) {
	for (const j of INNER) {
		for (const i of INNER) {
			// Infinity where no bridge crosses.
			const level = area.deck[j * SIZE + i] ?? Infinity
			if (level < Infinity) {
				const place = placement(area.x0 + i + 0.5, level * LEVEL, area.z0 + j + 0.5, 0, 1)
				part(place, box(), '#b39478', {position: [0, -0.04, 0], scale: [1.02, 0.08, 1.02]})
				part(place, box(), '#8d8681', {position: [0, 0.02, 0.46], scale: [1.02, 0.06, 0.06]})
				part(place, box(), '#8d8681', {position: [0, 0.02, -0.46], scale: [1.02, 0.06, 0.06]})
			}
		}
	}
}

/* ───────── instanced decoration: ore outcrops by how much is left, worked pits, grass, reeds, salt plates, basalt and ice ───────── */

function add(lists: Lists, key: string, instance: number[]) {
	const list = Option.getOrElse(MutableHashMap.get(lists, key), () => {
		const created = MutableList.make<number>()
		MutableHashMap.set(lists, key, created)
		return created
	})
	for (const value of instance) MutableList.append(list, value)
}

// Each instance: position, rotation (x, y, z), scale (x, y, z), shade.
function outcrop(shape: string, at: {s: number; tilt: number; x: number; y: number; yaw: number; z: number}) {
	if (shape === 'chunk') {
		return [at.x, at.y + 0.03 * at.s, at.z, at.tilt, at.yaw, at.tilt * 0.7, 0.13 * at.s, 0.13 * at.s, 0.13 * at.s]
	}
	if (shape === 'boulder') return [at.x, at.y + 0.04 * at.s, at.z, 0, at.yaw, 0, 0.17 * at.s, 0.17 * at.s, 0.17 * at.s]
	if (shape === 'oct') {
		return [at.x, at.y, at.z, at.tilt * 0.6, at.yaw, at.tilt * 0.4, 0.12 * at.s, 0.24 * at.s, 0.12 * at.s]
	}
	if (shape === 'prism') {
		return [at.x, at.y, at.z, at.tilt, at.yaw, at.tilt * 0.8, 0.11 * at.s, 0.34 * at.s, 0.11 * at.s]
	}
	if (shape === 'slab') return [at.x, at.y, at.z, 0, at.yaw, 0, 0.32 * at.s, 0.09 * at.s, 0.17 * at.s]
	if (shape === 'orb') return [at.x, at.y + 0.08 * at.s, at.z, 0, at.yaw, 0, 0.075 * at.s, 0.075 * at.s, 0.075 * at.s]
	return [at.x, at.y, at.z, 0, at.yaw, 0, 0.15 * at.s, 0.15 * at.s, 0.15 * at.s]
}

// A worked-out tile: pits and a spoil heap, no outcrops.
function workedOut(area: Area, lists: Lists, k: number, random: () => number) {
	const i = k % SIZE
	const j = Math.floor(k / SIZE)
	Array.forEach(Array.range(1, 2 + Math.floor(random() * 2)), () => {
		const x = i + 0.2 + 0.6 * random()
		const z = j + 0.2 + 0.6 * random()
		const s = 0.12 + 0.1 * random()
		add(lists, 'pit', [area.x0 + x, heightAt(area, x, z) + 0.004, area.z0 + z, 0, random() * TAU, 0, s, 1, s, 1])
	})
	if (random() >= 0.6) return
	const x = i + 0.2 + 0.6 * random()
	const z = j + 0.2 + 0.6 * random()
	const s = 0.1 + 0.06 * random()
	add(lists, 'spoil', [
		area.x0 + x,
		heightAt(area, x, z),
		area.z0 + z,
		0,
		random() * TAU,
		0,
		s * 1.4,
		s * 0.6,
		s * 1.4,
		1
	])
}

function oreTile(area: Area, stain: Stain, lists: Lists, k: number) {
	const ore = area.ore[k] ?? 0
	const i = k % SIZE
	const j = Math.floor(k / SIZE)
	const random = randomOf(((area.x0 + i) * 73_856_093) ^ ((area.z0 + j) * 19_349_663) ^ (ore * 83_492_791))
	const amount = area.amount[k] ?? 0
	if (amount <= 0) {
		workedOut(area, lists, k, random)
		return
	}
	// Outcrops cluster where the stain is deep: up to five a tile in a field's rich middle, thinning to the odd one at its rim.
	const material = Material.literals[ore - 1] ?? 'stone'
	const fill = Number.min(1, Math.sqrt(amount / (ORE_REF[ore] ?? 1)))
	const density = stain.density[k] ?? 0
	const wanted = Number.round(density * density * 5.5 * (0.5 + 0.5 * fill), 0)
	const placed = {n: 0}
	Array.forEach(Array.range(1, wanted * 3), () => {
		const x = i + 0.1 + 0.8 * random()
		const z = j + 0.1 + 0.8 * random()
		const here = stainAt(stain, x, z)
		if (placed.n >= wanted || here.s < 0.35 + 0.45 * random()) return
		placed.n += 1
		const at = {
			s: (0.7 + 0.5 * random()) * (0.55 + 0.55 * here.s) * (0.75 + 0.35 * fill),
			tilt: (random() - 0.5) * 0.7,
			x: area.x0 + x,
			y: heightAt(area, x, z),
			yaw: random() * TAU,
			z: area.z0 + z
		}
		add(lists, `ore:${material}`, [...outcrop(ORES[material].shape, at), 0.88 + 0.24 * random()])
	})
}

function flatAt(area: Area, px: number, pz: number) {
	const i = clamp(Math.floor(px), 0, SIZE - 1)
	const j = clamp(Math.floor(pz), 0, SIZE - 1)
	const corners = tileCorners(area, i, j)
	return highest(corners) - lowest(corners) < 0.6 && (area.liquid[j * SIZE + i] ?? 0) === 0
}

// Grass, reeds and salt plates from the ground kinds; grass thins out across a field's stain instead of stopping at its tiles.
function groundCover(area: Area, stain: Stain, lists: Lists, k: number) {
	const i = k % SIZE
	const j = Math.floor(k / SIZE)
	const ground = area.ground[k] ?? 0
	if ((area.liquid[k] ?? 0) > 0 || (area.wear[k] ?? 0) > 0) return
	const wetNear = Array.some(Array.take(AROUND, 4), near => area.liquid[cell(i + near.x, j + near.z)] === LIQUID.water)
	// What this ground grows, each kind thinned by its own odds.
	const grows = Array.filter(
		[
			{key: 'tuft', odds: 0.42, size: 0.7, when: Array.contains(TUFTY, ground)},
			{
				key: 'reed',
				odds: 0.5,
				size: 0.6,
				when:
					!Array.contains(TUFTY, ground) && (Array.contains(REEDY, ground) || (wetNear && Array.contains(WET, ground)))
			},
			{key: 'plate', odds: 0.1, size: 0.8, when: Array.contains(SALTY, ground)}
		],
		kind => kind.when
	)
	if (Array.isArrayEmpty(grows)) return
	const random = randomOf(Math.imul(area.x0 + i, 0x2c_1b_3c_6d) ^ Math.imul(area.z0 + j, 0x29_7a_2d_39))
	Array.forEach([0, 1, 2], () => {
		const x = i + 0.1 + random() * 0.8
		const z = j + 0.1 + random() * 0.8
		const q = random()
		const here = stainAt(stain, x, z)
		if (!flatAt(area, x, z) || here.s + here.w > 0.25 + 0.5 * random()) return
		const turn = random() * 6
		const s = random()
		for (const kind of Array.filter(grows, grow => q < grow.odds)) {
			const scale = 1 + s * kind.size - 0.2 * flag(kind.key === 'plate')
			add(lists, kind.key, [
				area.x0 + x,
				heightAt(area, x, z) + 0.005 * flag(kind.key === 'plate'),
				area.z0 + z,
				0,
				turn,
				0,
				scale,
				scale,
				scale,
				1
			])
		}
	})
}

function columns(lists: Lists, at: {bottom: number; i: number; j: number; side: Side; top: number}) {
	for (const q of [0, 1, 2]) {
		const s = (q + 0.5) / 3
		const x = mix(at.i + at.side.ax, at.i + at.side.bx, s) + at.side.dx * 0.04
		const z = mix(at.j + at.side.az, at.j + at.side.bz, s) + at.side.dz * 0.04
		// Columns stand the wall's full height, some a little proud of the rim and some broken short.
		const height =
			(at.top - at.bottom) * LEVEL * (0.86 + dither(x, z) * 0.22) + flag(dither(x * 1.7, z * 2.3) > 0.8) * 0.05
		const width = 0.95 + 0.2 * dither(z * 3.1, x)
		add(lists, 'basalt', [
			x,
			at.bottom * LEVEL,
			z,
			0,
			dither(z, x) * 3,
			0,
			width,
			height,
			width,
			0.8 + dither(x * 5.3, z * 1.9) * 0.35
		])
	}
}

function icicles(lists: Lists, at: {i: number; j: number; side: Side; top: number}) {
	for (const q of [0, 1, 2]) {
		const s = (q + 0.5) / 3
		const x = mix(at.i + at.side.ax, at.i + at.side.bx, s) + at.side.dx * 0.04
		const z = mix(at.j + at.side.az, at.j + at.side.bz, s) + at.side.dz * 0.04
		const size = 0.7 + dither(x, z) * 0.8
		if (dither(x * 2.1, z * 3.3) > 0.3) {
			add(lists, 'icicle', [x, at.top * LEVEL - 0.02, z, 0, dither(z, x) * 3, 0, size, size, size, 1])
		}
	}
}

// Basalt cliffs are columnar and frost cliffs hang icicles, where the biome holds most of the ground round them.
function wallProps(area: Area, shares: Float32Array, lists: Lists, k: number) {
	const i = k % SIZE
	const j = Math.floor(k / SIZE)
	const basalt = (shares[k * BIOME_SHAPE.length + 4] ?? 0) > 0.6
	const ice = (shares[k * BIOME_SHAPE.length + 3] ?? 0) > 0.6
	if (!basalt && !ice) return
	for (const side of SIDES) {
		const ta = facing(side, side.ax, side.az)
		const tb = facing(side, side.bx, side.bz)
		const nk = cell(i + side.dx, j + side.dz)
		const top = Number.min(cornerLevel(area, i, j, side.ax, side.az), cornerLevel(area, i, j, side.bx, side.bz))
		const bottom = Number.max(
			cornerLevel(area, i + side.dx, j + side.dz, ta.x, ta.z),
			cornerLevel(area, i + side.dx, j + side.dz, tb.x, tb.z)
		)
		const lava = area.liquid[k] === LIQUID.lava || area.liquid[nk] === LIQUID.lava
		const tall = top - bottom >= 1.6 - 0.7 * flag(area.ground[k] === GROUND.tuff)
		if (basalt && tall && !lava) columns(lists, {bottom, i: area.x0 + i, j: area.z0 + j, side, top})
		if (ice && !basalt && top - bottom >= 1.6 && area.liquid[nk] !== LIQUID.lava) {
			icicles(lists, {i: area.x0 + i, j: area.z0 + j, side, top})
		}
	}
}

function decor(area: Area, paint: Paint) {
	const lists: Lists = MutableHashMap.empty()
	for (const j of INNER) {
		for (const i of INNER) {
			const k = j * SIZE + i
			if ((area.ore[k] ?? 0) > 0) oreTile(area, paint.stain, lists, k)
			groundCover(area, paint.stain, lists, k)
			wallProps(area, paint.shares, lists, k)
		}
	}
	return Array.map(Array.fromIterable(lists), entry => ({
		data: Float32Array.from(MutableList.toArray(entry[1])),
		key: entry[0]
	}))
}

/* ───────── one chunk, everything the renderer draws for it ───────── */

export function buildChunk(chunkAt: (cx: number, cz: number) => Chunk, overlay: Overlay, cx: number, cz: number) {
	const area = loadArea(chunkAt, overlay, cx, cz)
	const paint = {
		own: Array.map(Array.range(0, CELLS - 1), k => ownColour(area, k)),
		shares: biomeShares(area),
		stain: oreStain(area)
	}
	const land = terrain(area, paint)
	for (const prop of area.props) generatorProp(area, prop)
	decks(area)
	const inner = Array.flatMap(INNER, j => Array.map(INNER, i => j * SIZE + i))
	return {
		corners: Float32Array.from(Array.flatMap(inner, k => Array.fromIterable(area.corners.subarray(k * 4, k * 4 + 4)))),
		cx,
		cz,
		// A bridge's deck level per tile, Infinity where none crosses: units on a bridge stand on it, not on the bed below.
		deck: Float32Array.from(Array.map(inner, k => area.deck[k] ?? Infinity)),
		glow: take('glow'),
		instances: decor(area, paint),
		liquid: Uint8Array.from(Array.map(inner, k => area.liquid[k] ?? 0)),
		liquids: liquids(area),
		props: take('props'),
		surface: Float32Array.from(Array.map(inner, k => area.surface[k] ?? 0)),
		terrain: land
	}
}
