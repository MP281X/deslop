import {Array, MutableHashSet, MutableList, Number, Option} from 'effect'

import {Biome, Material} from '#services/world/schema.ts'
import type {Edit, Site} from '#services/world/schema.ts'

// Ground kinds in id order: a colour, and whether a cliff under it keeps a lip of its own colour (grass, snow, moss).
const GROUND_KINDS = [
	{colour: '#bcd59d', lip: true, name: 'grass'},
	{colour: '#aecd92', lip: true, name: 'grass2'},
	{colour: '#f1e2c2', lip: false, name: 'shore'},
	{colour: '#e6d6b6', lip: false, name: 'road'},
	{colour: '#aac08b', lip: true, name: 'marsh'},
	{colour: '#b39b7b', lip: false, name: 'mud'},
	{colour: '#c4ab88', lip: false, name: 'mud2'},
	{colour: '#a9c08f', lip: true, name: 'reeds'},
	{colour: '#ebb88f', lip: false, name: 'redsand'},
	{colour: '#f0cfa2', lip: false, name: 'sand'},
	{colour: '#e8c49a', lip: false, name: 'sand2'},
	{colour: '#f3f7f9', lip: true, name: 'snow'},
	{colour: '#e6eff3', lip: true, name: 'snow2'},
	{colour: '#e9e4d8', lip: false, name: 'snowroad'},
	{colour: '#706762', lip: false, name: 'basalt'},
	{colour: '#756c66', lip: false, name: 'basalt2'},
	{colour: '#8b827b', lip: false, name: 'ash'},
	{colour: '#4a3f3b', lip: false, name: 'crust'},
	{colour: '#c4d2a6', lip: true, name: 'ruingrass'},
	{colour: '#ddd6c8', lip: false, name: 'concrete'},
	{colour: '#c9bddb', lip: true, name: 'mauve'},
	{colour: '#bfb1d4', lip: true, name: 'mauve2'},
	{colour: '#b8c9b4', lip: true, name: 'moss'},
	{colour: '#e6dcef', lip: true, name: 'lilac'},
	{colour: '#b7d296', lip: true, name: 'karstgrass'},
	{colour: '#e6e2d4', lip: false, name: 'pave'},
	{colour: '#d6d1c1', lip: false, name: 'rock'},
	{colour: '#a6c98c', lip: true, name: 'karstmoss'},
	{colour: '#f8f5ef', lip: false, name: 'salt'},
	{colour: '#f1ebe1', lip: false, name: 'salt2'},
	{colour: '#ead2c3', lip: false, name: 'saltpink'},
	{colour: '#e8dfcf', lip: false, name: 'saltfloor'},
	{colour: '#7fc8c6', lip: false, name: 'bed'},
	{colour: '#7a625a', lip: false, name: 'cinder'},
	{colour: '#877e77', lip: false, name: 'tuff'},
	{colour: '#ddd0bb', lip: false, name: 'saltcrack'},
	{colour: '#efdcb4', lip: false, name: 'saltochre'},
	{colour: '#5a524f', lip: false, name: 'flow'},
	{colour: '#5f5753', lip: false, name: 'flow2'},
	{colour: '#80776f', lip: false, name: 'weathered'},
	{colour: '#efe2c4', lip: false, name: 'glasssand'},
	{colour: '#a5dccf', lip: false, name: 'glass'},
	{colour: '#86c9bb', lip: false, name: 'glass2'},
	{colour: '#f4ecdc', lip: false, name: 'travertine'},
	{colour: '#ecc59a', lip: false, name: 'travrust'},
	{colour: '#bfe6df', lip: false, name: 'springbed'},
	{colour: '#b7d98a', lip: true, name: 'paddy'},
	{colour: '#a3cd7c', lip: true, name: 'paddy2'},
	{colour: '#9fb27e', lip: false, name: 'paddymud'},
	{colour: '#f6ecd6', lip: false, name: 'coralsand'},
	{colour: '#f2a7a0', lip: true, name: 'coralpink'},
	{colour: '#f4b77c', lip: true, name: 'coralorange'},
	{colour: '#c8a6e0', lip: true, name: 'coralviolet'},
	{colour: '#bfe9e0', lip: false, name: 'lagoonbed'},
	{colour: '#cf6e57', lip: false, name: 'crimson'},
	{colour: '#bf604c', lip: false, name: 'crimson2'},
	{colour: '#e7b083', lip: false, name: 'canyonfloor'},
	{colour: '#e9eff7', lip: true, name: 'prism'},
	{colour: '#dde6f2', lip: true, name: 'prism2'},
	{colour: '#e4dcf3', lip: true, name: 'prismlilac'},
	{colour: '#bdb894', lip: true, name: 'tundra'},
	{colour: '#adaa86', lip: true, name: 'tundra2'},
	{colour: '#cdd6bb', lip: true, name: 'frostmoss'},
	{colour: '#9aa38c', lip: false, name: 'trough'},
	{colour: '#d8c98c', lip: true, name: 'autumn'},
	{colour: '#cfbd7d', lip: true, name: 'autumn2'},
	{colour: '#e6ad6c', lip: true, name: 'litter'}
]
// Per biome, in Biome order: its place on the climate map (temperature, moisture and strangeness: biomes near on it clump; the strange half of the map holds the newer, odder biomes), its ground relative to the rest in levels, the step its flat ground keeps, how much of the land's swell and of the ridges it keeps, and its ground kinds.
const BIOME_SHAPE = [
	{
		elevation: 0,
		grounds: ['grass', 'grass2', 'shore'],
		macro: 1,
		moist: 0.62,
		odd: 0.25,
		ridge: 0.7,
		step: 1,
		temp: 0.48
	},
	{
		elevation: -2,
		grounds: ['marsh', 'mud', 'mud2', 'reeds'],
		macro: 0.6,
		moist: 0.92,
		odd: 0.25,
		ridge: 0,
		step: 1,
		temp: 0.52
	},
	{
		elevation: 4,
		grounds: ['redsand', 'sand', 'sand2'],
		macro: 1,
		moist: 0.28,
		odd: 0.25,
		ridge: 1,
		step: 2,
		temp: 0.78
	},
	{elevation: 6, grounds: ['snow', 'snow2'], macro: 1, moist: 0.45, odd: 0.25, ridge: 1, step: 3, temp: 0.2},
	{
		elevation: 2,
		grounds: ['basalt', 'basalt2', 'ash', 'crust', 'cinder', 'tuff', 'flow', 'flow2', 'weathered'],
		macro: 1,
		moist: 0.62,
		odd: 0.25,
		ridge: 0.6,
		step: 3,
		temp: 0.88
	},
	{elevation: 2, grounds: ['ruingrass', 'concrete'], macro: 1, moist: 0.48, odd: 0.25, ridge: 0.6, step: 3, temp: 0.62},
	{
		elevation: 0,
		grounds: ['mauve', 'mauve2', 'moss', 'lilac'],
		macro: 1,
		moist: 0.86,
		odd: 0.25,
		ridge: 0.8,
		step: 1,
		temp: 0.3
	},
	{
		elevation: 3,
		grounds: ['karstgrass', 'pave', 'rock', 'karstmoss'],
		macro: 0.3,
		moist: 0.25,
		odd: 0.25,
		ridge: 0.7,
		step: 2,
		temp: 0.35
	},
	{
		elevation: 1,
		grounds: ['salt', 'salt2', 'saltpink', 'saltfloor', 'saltcrack', 'saltochre'],
		macro: 0.2,
		moist: 0.06,
		odd: 0.25,
		ridge: 0.3,
		step: 2,
		temp: 0.66
	},
	{
		elevation: 3,
		grounds: ['glasssand', 'glass', 'glass2'],
		macro: 0.5,
		moist: 0.2,
		odd: 0.78,
		ridge: 0.2,
		step: 1,
		temp: 0.82
	},
	{
		elevation: 4,
		grounds: ['travertine', 'travrust', 'springbed'],
		macro: 0.6,
		moist: 0.55,
		odd: 0.8,
		ridge: 0.3,
		step: 1,
		temp: 0.62
	},
	{
		elevation: 1,
		grounds: ['paddy', 'paddy2', 'paddymud'],
		macro: 1,
		moist: 0.85,
		odd: 0.78,
		ridge: 0.2,
		step: 1,
		temp: 0.6
	},
	{
		elevation: -2,
		grounds: ['coralsand', 'coralpink', 'coralorange', 'coralviolet', 'lagoonbed'],
		macro: 0.3,
		moist: 0.8,
		odd: 0.75,
		ridge: 0,
		step: 1,
		temp: 0.85
	},
	{
		elevation: 6,
		grounds: ['crimson', 'crimson2', 'canyonfloor'],
		macro: 0.6,
		moist: 0.35,
		odd: 0.8,
		ridge: 0.5,
		step: 2,
		temp: 0.7
	},
	{
		elevation: 3,
		grounds: ['prism', 'prism2', 'prismlilac'],
		macro: 0.6,
		moist: 0.3,
		odd: 0.8,
		ridge: 0.6,
		step: 1,
		temp: 0.25
	},
	{
		elevation: 0,
		grounds: ['tundra', 'tundra2', 'frostmoss', 'trough'],
		macro: 0.5,
		moist: 0.75,
		odd: 0.75,
		ridge: 0.2,
		step: 1,
		temp: 0.12
	},
	{
		elevation: 2,
		grounds: ['autumn', 'autumn2', 'litter'],
		macro: 1,
		moist: 0.6,
		odd: 0.72,
		ridge: 0.8,
		step: 1,
		temp: 0.38
	}
]
// What each biome holds, in Biome order: common materials lie in big lean fields, rare ones in small rich ones.
const DEPOSITS: Deposit[][] = [
	[
		{abundance: 1200, material: 'iron', site: 'high'},
		{abundance: 1800, material: 'copper', site: 'low'},
		{abundance: 3000, material: 'stone', site: 'any'},
		{abundance: 900, material: 'coal', site: 'low'}
	],
	[
		{abundance: 2100, material: 'peat', site: 'any'},
		{abundance: 1500, material: 'clay', site: 'wet'},
		{abundance: 600, material: 'sulfur', site: 'wet'}
	],
	[
		{abundance: 2400, material: 'bauxite', site: 'high'},
		{abundance: 700, material: 'quartz', site: 'low'},
		{abundance: 5000, material: 'sand', site: 'any'}
	],
	[
		{abundance: 320, material: 'crystal', site: 'high'},
		{abundance: 1100, material: 'cobalt', site: 'any'},
		{abundance: 800, material: 'coal', site: 'low'}
	],
	[
		{abundance: 650, material: 'tungsten', site: 'high'},
		{abundance: 900, material: 'obsidian', site: 'any'},
		{abundance: 400, material: 'sulfur', site: 'low'}
	],
	[
		{abundance: 1400, material: 'scrap', site: 'any'},
		{abundance: 260, material: 'electronics', site: 'high'}
	],
	[
		{abundance: 1600, material: 'mycelium', site: 'high'},
		{abundance: 800, material: 'resin', site: 'any'},
		{abundance: 450, material: 'lumen', site: 'low'}
	],
	[
		{abundance: 4000, material: 'limestone', site: 'any'},
		{abundance: 500, material: 'fluorite', site: 'low'},
		{abundance: 900, material: 'zinc', site: 'any'}
	],
	[
		{abundance: 6000, material: 'salt', site: 'high'},
		{abundance: 1200, material: 'potash', site: 'any'},
		{abundance: 700, material: 'lithium', site: 'low'}
	],
	[
		{abundance: 1400, material: 'glass', site: 'high'},
		{abundance: 900, material: 'quartz', site: 'low'},
		{abundance: 3500, material: 'sand', site: 'any'}
	],
	[
		{abundance: 900, material: 'sulfur', site: 'wet'},
		{abundance: 600, material: 'lithium', site: 'low'},
		{abundance: 2500, material: 'limestone', site: 'any'}
	],
	[
		{abundance: 1800, material: 'clay', site: 'wet'},
		{abundance: 420, material: 'jade', site: 'high'},
		{abundance: 1500, material: 'peat', site: 'any'}
	],
	[
		{abundance: 1600, material: 'coral', site: 'any'},
		{abundance: 2500, material: 'salt', site: 'low'},
		{abundance: 3000, material: 'sand', site: 'any'}
	],
	[
		{abundance: 380, material: 'garnet', site: 'low'},
		{abundance: 1600, material: 'iron', site: 'high'},
		{abundance: 1400, material: 'copper', site: 'any'}
	],
	[
		{abundance: 450, material: 'crystal', site: 'any'},
		{abundance: 700, material: 'fluorite', site: 'high'},
		{abundance: 1100, material: 'quartz', site: 'low'}
	],
	[
		{abundance: 1800, material: 'peat', site: 'wet'},
		{abundance: 900, material: 'cobalt', site: 'any'},
		{abundance: 1100, material: 'coal', site: 'low'}
	],
	[
		{abundance: 500, material: 'amber', site: 'any'},
		{abundance: 1300, material: 'iron', site: 'high'},
		{abundance: 1100, material: 'coal', site: 'low'}
	]
]
// The start basin's fields, one per starter material round the base.
const START: Deposit[] = [
	{abundance: 3000, material: 'stone', site: 'start'},
	{abundance: 1200, material: 'iron', site: 'start'},
	{abundance: 1800, material: 'copper', site: 'start'},
	{abundance: 900, material: 'coal', site: 'start'}
]
const CELL = 60
// The start basin: a valley floor round the base, RB tiles to where the land is its own again.
const RB = 80
// Start field ids sit in a slot column no ordinary field uses, some 590 000 tiles west.
const START_GX = -32_768
// Ore field slots: one candidate field per FS tiles, reaching at most FR tiles from its point, FMIN to FMAX tiles large.
const FS = 18
const FR = 12
const FMIN = 8
const FMAX = 60
// A chunk's tiles with a one-tile ring round them, and the lattice of their corners.
const RING = 34
const LAT = 35
const CHUNK_TILES = 1024
const MEADOW = 0
const MARSH = 1
const MESA = 2
const FROST = 3
const LAVA = 4
const RUINS = 5
const FUNGAL = 6
const KARST = 7
const SALT = 8
const GLASS = 9
const SPRINGS = 10
const PADDIES = 11
const CORAL = 12
const CANYON = 13
const PRISM = 14
const TUNDRA = 15
const AUTUMN = 16
const NEIGHBOURS = [
	{x: 1, z: 0},
	{x: -1, z: 0},
	{x: 0, z: 1},
	{x: 0, z: -1}
]
const CORNERS = [0, 1, 2, 3]
const MILLION = 1e6
const INT = 2_147_483_647
// The corners on each side of a tile, its own and the touching neighbour's, in chunk corner order (0 north-west, 1 north-east, 2 south-west, 3 south-east).
const EDGES = [
	{dx: 1, dz: 0, mine: [1, 3], theirs: [0, 2]},
	{dx: -1, dz: 0, mine: [0, 2], theirs: [1, 3]},
	{dx: 0, dz: 1, mine: [2, 3], theirs: [0, 1]},
	{dx: 0, dz: -1, mine: [0, 1], theirs: [2, 3]}
]

export {BIOME_SHAPE}
export const GENERATOR = 5
export const CHUNK = 32
// One height level in world units; a tile is one unit wide.
export const LEVEL = 0.4
export const LIQUID = {brine: 5, ice: 3, lagoon: 7, lava: 2, none: 0, spring: 6, sulfur: 4, water: 1}
// How each way of moving copes with ground, in levels: the steepest tile it crosses, the highest step between touching edges and the deepest liquid it fords. Hover crosses any liquid but lava; fly ignores the ground.
export const MOVERS = {
	fly: {ford: 99, slope: 99, step: 99},
	hover: {ford: 99, slope: 1.1, step: 0.3},
	legs: {ford: 1.3, slope: 2.6, step: 1.05},
	stride: {ford: 2, slope: 4.2, step: 2.05},
	tracks: {ford: 1.3, slope: 2.6, step: 1.05},
	wheels: {ford: 0.8, slope: 1.1, step: 0.3}
}
// Each ground kind's id: its index in GROUND_KINDS.
export const GROUND = {
	ash: 16,
	autumn: 64,
	autumn2: 65,
	basalt: 14,
	basalt2: 15,
	bed: 32,
	canyonfloor: 56,
	cinder: 33,
	concrete: 19,
	coralorange: 51,
	coralpink: 50,
	coralsand: 49,
	coralviolet: 52,
	crimson: 54,
	crimson2: 55,
	crust: 17,
	flow: 37,
	flow2: 38,
	frostmoss: 62,
	glass: 41,
	glass2: 42,
	glasssand: 40,
	grass: 0,
	grass2: 1,
	karstgrass: 24,
	karstmoss: 27,
	lagoonbed: 53,
	lilac: 23,
	litter: 66,
	marsh: 4,
	mauve: 20,
	mauve2: 21,
	moss: 22,
	mud: 5,
	mud2: 6,
	paddy: 46,
	paddy2: 47,
	paddymud: 48,
	pave: 25,
	prism: 57,
	prism2: 58,
	prismlilac: 59,
	redsand: 8,
	reeds: 7,
	road: 3,
	rock: 26,
	ruingrass: 18,
	salt: 28,
	salt2: 29,
	saltcrack: 35,
	saltfloor: 31,
	saltochre: 36,
	saltpink: 30,
	sand: 9,
	sand2: 10,
	shore: 2,
	snow: 11,
	snow2: 12,
	snowroad: 13,
	springbed: 45,
	travertine: 43,
	travrust: 44,
	trough: 63,
	tuff: 34,
	tundra: 60,
	tundra2: 61,
	weathered: 39
}
// Cliff strata per biome, one colour per level.
export const STRATA = [
	['#ead8b6', '#e0c9a2', '#d6bc93', '#e6d1ab', '#ceb289', '#dcc39b'],
	['#a88e70', '#94795d', '#b39a7a', '#9c8166', '#8a7058'],
	['#d9825a', '#e39a6c', '#c96f4b', '#eab084', '#d47a55', '#f0c497', '#c6694a', '#e69468'],
	['#c4e2ee', '#9fcde2', '#dcf0f6', '#86bcd6', '#b6dbea', '#93c6de'],
	['#4a4240', '#534a47', '#433c3a', '#5a514d', '#4e4643'],
	['#d9d2c5', '#cbc3b4', '#e2dccf', '#c2baab', '#d4ccbe'],
	['#b9a4a0', '#a8918d', '#c7b2ad', '#9c8783', '#b19a96'],
	['#e2ded0', '#c4bfae', '#eeeadd', '#b2ac9b', '#d8d2c1'],
	['#f6f0e6', '#efc9c0', '#e9d4a8', '#f3e3d6', '#d9a99a', '#e2c58f'],
	['#f0e3c6', '#e4d2ae', '#a9dccf', '#ecdcb9', '#8fcfbf', '#dfcaa3'],
	['#f5eddd', '#efd9b8', '#f8f1e4', '#e7bf92', '#f2e4cc', '#e3ae80'],
	['#b8a07e', '#a68d6c', '#c2ab89', '#9b8263', '#b09676'],
	['#f5e6cf', '#f0c7b4', '#f7eedf', '#eab49b', '#f2dcc1'],
	['#c8634c', '#b3543f', '#d9805f', '#a8483a', '#e19a72', '#bd5d47', '#cf7356'],
	['#e6eef8', '#cfdcef', '#f2f6fb', '#bccbe6', '#dbd1f0', '#c6d8ee'],
	['#9c8f74', '#8a7e66', '#a89b80', '#7f735d', '#958870'],
	['#cdb48c', '#bea27a', '#d8c19a', '#b3966f', '#c7ac83']
]
// Each material's look: its ore's colour (in outcrops and a cart's bed) and whether it glows, its outcrop's shape, and the stain it leaves on the ground.
export const ORES = {
	amber: {colour: '#f2a33c', glow: false, shape: 'orb', tint: '#e0902c'},
	bauxite: {colour: '#d47552', glow: false, shape: 'blob', tint: '#c9643f'},
	clay: {colour: '#de9d78', glow: false, shape: 'blob', tint: '#d48d68'},
	coal: {colour: '#5d5955', glow: false, shape: 'chunk', tint: '#5d5955'},
	cobalt: {colour: '#6a8ee0', glow: false, shape: 'oct', tint: '#5c7fd0'},
	copper: {colour: '#e39561', glow: false, shape: 'oct', tint: '#d98a55'},
	coral: {colour: '#f49a8a', glow: false, shape: 'blob', tint: '#e9867a'},
	crystal: {colour: '#8fe3f2', glow: true, shape: 'prism', tint: '#4fbfdc'},
	electronics: {colour: '#7cc79a', glow: false, shape: 'chunk', tint: '#5fae80'},
	fluorite: {colour: '#bb9ef0', glow: true, shape: 'prism', tint: '#a58ae0'},
	garnet: {colour: '#b8324a', glow: false, shape: 'oct', tint: '#a32a40'},
	glass: {colour: '#9fe0d2', glow: false, shape: 'prism', tint: '#7fcfbf'},
	iron: {colour: '#c98a6a', glow: false, shape: 'chunk', tint: '#b06a4c'},
	jade: {colour: '#6fc39a', glow: false, shape: 'chunk', tint: '#5aae86'},
	limestone: {colour: '#f1ede1', glow: false, shape: 'boulder', tint: '#d8d2c0'},
	lithium: {colour: '#9eeee3', glow: true, shape: 'prism', tint: '#7fdcd0'},
	lumen: {colour: '#b6f2dc', glow: true, shape: 'orb', tint: '#8fe0c6'},
	mycelium: {colour: '#f1e8f6', glow: false, shape: 'blob', tint: '#f4ecf8'},
	obsidian: {colour: '#4a4052', glow: false, shape: 'prism', tint: '#4a4052'},
	peat: {colour: '#8f6e53', glow: false, shape: 'slab', tint: '#7a5a42'},
	potash: {colour: '#f0a493', glow: false, shape: 'chunk', tint: '#e08a78'},
	quartz: {colour: '#f7e8f0', glow: false, shape: 'prism', tint: '#e8d6e2'},
	resin: {colour: '#f1b65c', glow: false, shape: 'orb', tint: '#e0a048'},
	salt: {colour: '#fdfbf6', glow: false, shape: 'cube', tint: '#c9bcae'},
	sand: {colour: '#f1d6a6', glow: false, shape: 'dune', tint: '#e8c48a'},
	scrap: {colour: '#c4906c', glow: false, shape: 'scrap', tint: '#a87553'},
	stone: {colour: '#e3dccf', glow: false, shape: 'boulder', tint: '#bdb5a6'},
	sulfur: {colour: '#f2d55c', glow: false, shape: 'oct', tint: '#e8cc3e'},
	tungsten: {colour: '#a2a8b0', glow: false, shape: 'chunk', tint: '#8d939c'},
	zinc: {colour: '#bfcad0', glow: false, shape: 'chunk', tint: '#a3b0b8'}
} satisfies Record<Material, {colour: string; glow: boolean; shape: string; tint: string}>

const TAU = Math.PI * 2
// The 3 × 3 block round a slot and the 4 × 4 block a point's nearest cell lies in, row by row.
const OFFSETS = Array.flatMap([-1, 0, 1], z => Array.map([-1, 0, 1], x => ({x, z})))
const BLOCK = Array.flatMap([-1, 0, 1, 2], z => Array.map([-1, 0, 1, 2], x => ({x, z})))
const G = GROUND
// Scattered props by biome: a tile takes the first row its draw falls under, sized base + spread × a second draw.
const SPARSE = [
	{base: 0.9, below: 0.03, biome: MARSH, kind: 'snag', spread: 0.4},
	{base: 0.8, below: 0.045, biome: MARSH, kind: 'tree', spread: 0.3},
	{base: 0.9, below: 0.025, biome: MESA, kind: 'cactus', spread: 0.4},
	{base: 0.8, below: 0.05, biome: MESA, kind: 'shrubDry', spread: 0.5},
	{base: 0.9, below: 0.04, biome: RUINS, kind: 'tree', spread: 0.4},
	{base: 1, below: 0.05, biome: RUINS, kind: 'shrub', spread: 1},
	{base: 1, below: 0.05, biome: FUNGAL, kind: 'shrub', spread: 1},
	{base: 1.2, below: 0.02, biome: KARST, kind: 'shrub', spread: 0.6},
	{base: 1, below: 0.012, biome: SALT, kind: 'spire', spread: 0.6},
	{base: 0.8, below: 0.014, biome: GLASS, kind: 'shard', spread: 0.7},
	{base: 0.09, below: 0.01, biome: SPRINGS, kind: 'rock', spread: 0.06},
	{base: 0.8, below: 0.02, biome: CANYON, kind: 'hoodoo', spread: 0.7},
	{base: 0.9, below: 0.045, biome: CANYON, kind: 'shrubDry', spread: 0.5},
	{base: 0.8, below: 0.03, biome: TUNDRA, kind: 'shrub', spread: 0.5},
	{base: 0.1, below: 0.036, biome: TUNDRA, kind: 'rock', spread: 0.1}
]
// The biome each ground kind belongs to, so props change species across a border with the colours.
const GROUND_BIOME = Array.map(GROUND_KINDS, kind =>
	Option.getOrElse(
		Array.findFirstIndex(BIOME_SHAPE, shape => Array.some(shape.grounds, name => name === kind.name)),
		() => -1
	)
)

export const GROUND_COLOR = Array.map(GROUND_KINDS, kind => kind.colour)
export const GROUND_LIP = Array.map(GROUND_KINDS, kind => kind.lip)

type Deposit = {abundance: number; material: Material; site: Site}
type HeightAt = (x: number, z: number, base: number) => number
type Pick = (index: number) => number
type Point = {x: number; z: number}
type Cell = {
	biome: number
	ca: number
	ci: number
	cj: number
	elevation: number
	heroOn: boolean
	hs: number
	key: number
	ns: number
	rx: number
	rz: number
	sa: number
	x: number
	z: number
}
type Near = {block: Cell[]; dists: Float64Array; dom: Cell; gap: number; min: number; wx: number; wz: number}
type Flat = {feature: boolean; ground: number; kind: 'flat'; level: number; liquid: number; surface: number}
type Smooth = {feature: boolean; ground: number; height?: HeightAt; kind: 'smooth'; offset: number}
type Ramp = {ground: number; height: HeightAt; kind: 'ramp'}
type Draft = Flat | Ramp | Smooth
type Tile = {
	biome: number
	feature: boolean
	gap: number
	ground: number
	height?: HeightAt
	level: number
	liquid: number
	ramp: boolean
	surface: number
}
type Frame = {ca: number; k: number; on: boolean; plain: number; sa: number}
type Here = {
	b: number
	bw: number
	c: Cell
	fade: number
	frame: Frame
	hs: number
	k: number
	n: Near
	on: boolean
	p: number
	s0: number
	u: number
	v: number
	x: number
	z: number
}
type Grid<F> = {feature: (gx: number, gz: number) => Option.Option<F>; size: number}
type Shelf = {
	exp: number
	ice: number
	p: number
	r0: number
	r1: number
	talus: number
	tier: number
	up: (q: number) => number
}
type Growth = {
	abundance: number
	b: number
	key: number
	material: Material
	own: (x: number, z: number) => boolean
	px: number
	pz: number
	r: Pick
	rich: number
	site: Site
}

export type Prop = {
	dp?: number
	glow?: boolean
	h?: number
	ht?: number
	hue?: number
	id: number
	kind: string
	r?: number
	role?: string
	s: number
	seed?: number
	wd?: number
	x: number
	yaw: number
	z: number
}
// An ore field: its tiles' positions and starting amounts, and their bounds.
export type Field = {
	amts: Uint16Array
	biome: Biome
	id: number
	material: Material
	ore: number
	site: Site
	tiles: number
	total: number
	x: number
	x0: number
	x1: number
	xs: Int32Array
	z: number
	z0: number
	z1: number
	zs: Int32Array
}
export type World = ReturnType<typeof makeWorld>
export type Chunk = ReturnType<World['chunk']>

export function hash(seed: number, x: number, z: number) {
	const mixed = Math.imul(x | 0, 0x27_d4_eb_2d) ^ Math.imul(z | 0, 0x16_56_67_b1) ^ Math.imul(seed | 0, 0x9e_37_79_b1)
	const first = Math.imul(mixed ^ (mixed >>> 15), 0x85_eb_ca_6b)
	const second = Math.imul(first ^ (first >>> 13), 0xc2_b2_ae_35)
	return ((second ^ (second >>> 16)) >>> 0) / 4_294_967_296
}

// One number per tile, for maps and saves.
export function tileKey(x: number, z: number) {
	return (x + 32_768) * 65_536 + (z + 32_768)
}

export function tileOf(key: number) {
	return {x: Math.floor(key / 65_536) - 32_768, z: (key % 65_536) - 32_768}
}

export function chunkOf(x: number, z: number) {
	const cz = Math.floor(z / CHUNK)
	const cx = Math.floor(x / CHUNK)
	return {cx, cz, index: (z - cz * CHUNK) * CHUNK + (x - cx * CHUNK)}
}

// A tile as movers and the renderer see it once its edit applies: corners in levels, a bridge's deck level, and whether it is paved.
export function tileGround(chunk: Chunk, index: number, edit: Option.Option<Edit>) {
	const tile = {
		corners: Array.map(CORNERS, corner => chunk.corners[index * 4 + corner] ?? 0),
		deck: Option.none<number>(),
		ground: chunk.ground[index] ?? 0,
		liquid: chunk.liquid[index] ?? 0,
		road: false,
		surface: chunk.surface[index] ?? 0
	}
	return Option.match(edit, {
		onNone: () => tile,
		onSome: built => {
			if (built._tag === 'Road') return {...tile, road: true}
			if (built._tag === 'Ramp') return {...tile, corners: [...built.corners], road: true}
			return {...tile, deck: Option.some(built.level), road: true}
		}
	})
}

export type Ground = ReturnType<typeof tileGround>
export type Mover = {ford: number; slope: number; step: number}

export function highest(values: number[]) {
	return Array.reduce(values, -Infinity, (best, value) => Number.max(best, value))
}

export function lowest(values: number[]) {
	return Array.reduce(values, Infinity, (best, value) => Number.min(best, value))
}

// The four corners a mover stands on: a deck's level where a bridge crosses.
function footing(tile: Ground) {
	return Option.match(tile.deck, {onNone: () => tile.corners, onSome: level => [level, level, level, level]})
}

export function standable(mover: Mover, tile: Ground) {
	if (Option.isSome(tile.deck)) return true
	if (tile.liquid === LIQUID.lava) return mover.slope > 50
	const low = lowest(tile.corners)
	if (highest(tile.corners) - low > mover.slope) return false
	if (tile.liquid === LIQUID.none || tile.liquid === LIQUID.ice) return true
	return tile.surface - low <= mover.ford
}

// Whether a mover steps from one tile to the touching one (dx, dz one of the four sides).
export function crossable(mover: Mover, from: Ground, to: Ground, dx: number, dz: number) {
	if (!standable(mover, to)) return false
	const mine = footing(from)
	const theirs = footing(to)
	return Array.every(
		Array.filter(EDGES, edge => edge.dx === dx && edge.dz === dz),
		edge =>
			Array.every(
				Array.zip(edge.mine, edge.theirs),
				(pair: [number, number]) => Math.abs((mine[pair[0]] ?? 0) - (theirs[pair[1]] ?? 0)) <= mover.step
			)
	)
}

function noise(seed: number, x: number, z: number) {
	const ix = Math.floor(x)
	const iz = Math.floor(z)
	const fx = (x - ix) * (x - ix) * (3 - 2 * (x - ix))
	const fz = (z - iz) * (z - iz) * (3 - 2 * (z - iz))
	const a = hash(seed, ix, iz)
	const b = hash(seed, ix + 1, iz)
	const c = hash(seed, ix, iz + 1)
	return a + (b - a) * fx + (c - a) * fz + (a - b - c + hash(seed, ix + 1, iz + 1)) * fx * fz
}

function fbm(seed: number, x: number, z: number) {
	return 0.55 * noise(seed, x, z) + 0.3 * noise(seed + 1, x * 2.03, z * 2.03) + 0.15 * noise(seed + 2, x * 4.1, z * 4.1)
}

function clamp(value: number, low: number, high: number) {
	return Number.min(Number.max(value, low), high)
}

function mix(from: number, to: number, t: number) {
	return from + (to - from) * t
}

function smoothstep(from: number, to: number, value: number) {
	const t = clamp((value - from) / (to - from), 0, 1)
	return t * t * (3 - 2 * t)
}

function round(value: number) {
	return Number.round(value, 0)
}

// A ground kind or amount chosen by a noise value against its threshold.
function byNoise(value: number, threshold: number, above: number, below: number) {
	if (value > threshold) return above
	return below
}

function flag(on: boolean) {
	if (on) return 1
	return 0
}

// 0 for the rarest abundance in the table, 1 for the most common.
function rarity(abundance: number) {
	return clamp(Math.log(abundance / 260) / Math.log(6000 / 260), 0, 1)
}

// A field's richest tile before the region's richness: rare materials concentrate, common ones spread thin.
function gradeOf(abundance: number) {
	return mix(480, 60, rarity(abundance))
}

// The amount a renderer reads a tile's fill against, by ore id: a little over the richest grade the material is generated at.
export const ORE_REF = Array.prepend(
	Array.map(Material.literals, material =>
		round(
			Array.reduce(Array.flatten(DEPOSITS), 0, (best, deposit) => {
				if (deposit.material !== material) return best
				return Number.max(best, gradeOf(deposit.abundance))
			}) * 1.3
		)
	),
	1
)

function seeded(seed: number, k: number) {
	return (Math.imul(seed | 0, 0x2c_1b_3c_6d) ^ Math.imul(k + 1, 0x29_7a_2d_39)) | 0
}

function pack(x: number, z: number) {
	return (x + 32_768) * 65_536 + (z + 32_768)
}

function slotKey(gx: number, gz: number) {
	return (((gx & 0xff_ff) << 16) | (gz & 0xff_ff)) >>> 0
}

function sideOf(value: number) {
	if (value > 0) return 1
	return -1
}

// The distance from a point to a polyline, how far along it the nearest point lies, its length and which side the point is on.
function segDist(x: number, z: number, line: Point[]) {
	return Array.reduce(
		Array.zip(Array.dropRight(line, 1), Array.drop(line, 1)),
		{d: 1e9, len: 0, s: 0, side: 0},
		(best, pair) => {
			const a = pair[0]
			const ex = pair[1].x - a.x
			const ez = pair[1].z - a.z
			const length = Math.sqrt(ex * ex + ez * ez)
			const t = clamp(((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez), 0, 1)
			const d = Math.hypot(x - a.x - ex * t, z - a.z - ez * t)
			if (d < best.d) {
				return {d, len: best.len + length, s: best.len + t * length, side: sideOf(ex * (z - a.z) - ez * (x - a.x))}
			}
			return {...best, len: best.len + length}
		}
	)
}

// Chaikin's corner cutting: each round replaces every segment by its quarter points, keeping the ends.
function chaikin(points: Point[], rounds: number) {
	return Array.reduce(Array.range(1, rounds), points, (line: Point[]) =>
		Array.appendAll(
			Array.prependAll(
				Array.flatMap(Array.zip(Array.dropRight(line, 1), Array.drop(line, 1)), (pair: [Point, Point]) => [
					{x: mix(pair[0].x, pair[1].x, 0.25), z: mix(pair[0].z, pair[1].z, 0.25)},
					{x: mix(pair[0].x, pair[1].x, 0.75), z: mix(pair[0].z, pair[1].z, 0.75)}
				]),
				Array.take(line, 1)
			),
			Array.takeRight(line, 1)
		)
	)
}

function polyLen(line: Point[]) {
	return Number.sumAll(
		Array.map(Array.zip(Array.dropRight(line, 1), Array.drop(line, 1)), pair =>
			Math.hypot(pair[1].x - pair[0].x, pair[1].z - pair[0].z)
		)
	)
}

// The distance in tiles to the nearest zero line of a noise field (9 when farther than the gate allows).
function zeroDist(seed: number, scale: number, x: number, z: number, gate: number) {
	const value = fbm(seed, x / scale, z / scale) - 0.5
	if (Math.abs(value) > gate) return 9
	const gx = fbm(seed, (x + 1) / scale, z / scale) - fbm(seed, (x - 1) / scale, z / scale)
	const gz = fbm(seed, x / scale, (z + 1) / scale) - fbm(seed, x / scale, (z - 1) / scale)
	return Math.abs(value) / (Math.hypot(gx, gz) / 2 + 1e-6)
}

// A cell's distance jittered by noise where it is a contender, so borders wander; the rest are pushed back.
function jitter(close: boolean, ns: number, x: number, z: number) {
	if (close) return 0.8 * (fbm(ns, x / 16, z / 16) - 0.5)
	return 0.4
}

// A direct-mapped cache: a key keeps its value until another key lands on its slot, which suits values that are pure functions of their key.
function memo<T>(bits: number) {
	const slots = Array.makeBy(1 << bits, () => ({key: Infinity, value: Option.none<T>()}))
	return (key: number, make: () => T) => {
		const slot = slots[Math.imul((key >>> 0) ^ Math.floor(key / 4_294_967_296), 0x9e_37_79_b1) >>> (32 - bits)]
		if (slot === undefined) return make()
		if (slot.key === key) return Option.getOrElse(slot.value, make)
		const value = make()
		slot.key = key
		slot.value = Option.some(value)
		return value
	}
}

function flat(level: number, ground: number, feature = true) {
	return {feature, ground, kind: 'flat', level, liquid: LIQUID.none, surface: 0} satisfies Flat
}

function smooth(ground: number, height?: HeightAt, offset = 0, feature = true) {
	return {feature, ground, height, kind: 'smooth', offset} satisfies Smooth
}

function plain(ground: number) {
	return smooth(ground, undefined, 0, false)
}

function wet(liquid: number, surface: number, bed: number, ground: number = G.bed) {
	return {feature: true, ground, kind: 'flat', level: bed, liquid, surface} satisfies Flat
}

// A lake: water inside, a ring of shore one step over the water round it.
function lakeAt(e: number, level: number) {
	if (e < 1) return wet(LIQUID.water, level, level - 1)
	if (e < 1.3) return flat(Math.ceil(level), G.shore)
	if (e < 1.5) return flat(Math.ceil(level), -1)
	return undefined
}

function withGround(draft: Draft, ground: number) {
	if (draft.ground >= 0) return draft
	return {...draft, ground}
}

// One spring's terraces at a point: rings stepping down a level from the vent, each a pool behind a dry rim.
function springRing(h: Here, f: {base: number; rings: number; s: number; w: number; x: number; z: number}) {
	const d = Math.hypot(h.x - f.x, h.z - f.z) / f.w + 0.4 * (fbm(f.s, h.x / 2.2, h.z / 2.2) - 0.5)
	const ring = Math.floor(d)
	if (ring > f.rings) return undefined
	const level = f.base + f.rings - ring
	if (ring === 0 && d < 0.45) return flat(level + 1, G.travrust)
	if (d - ring > 0.68 || ring === f.rings) {
		return flat(level, byNoise(fbm(f.s + 1, h.x / 2, h.z / 2), 0.55, G.travrust, G.travertine))
	}
	return wet(LIQUID.spring, level - 0.14, level - 0.5, G.springbed)
}

// Paddies: every contour of the hills is a flooded field behind a grass bund on its downhill edge; the knolls stay dry.
function paddiesTile(h: Here) {
	// Bunds also split each terrace into fields a few tiles across.
	const across = (h.x + 2 * fbm(h.hs + 9, h.x / 6, h.z / 6)) / 5
	const along = (h.z + 2 * fbm(h.hs + 10, h.x / 6, h.z / 6)) / 6
	if (h.s0 - h.p < -0.22 || across - Math.floor(across) < 0.2 || along - Math.floor(along) < 0.17) {
		return flat(h.p, G.paddy2, false)
	}
	if (fbm(h.hs + 8, h.x / 9, h.z / 9) > 0.56) return plain(-1)
	return wet(LIQUID.water, h.p - 0.12, h.p - 0.4, G.paddymud)
}

// Distance to a hexagonal column's axis in its own radii, its faces turned by `turn`.
function hexDistance(dx: number, dz: number, turn: number) {
	return Array.reduce([0, Math.PI / 3, (2 * Math.PI) / 3], 0, (far, angle) =>
		Number.max(far, Math.abs(dx * Math.cos(turn + angle) + dz * Math.sin(turn + angle)))
	)
}

function startBiome(isStart: boolean, biome: number) {
	if (isStart) return MEADOW
	return biome
}

function terraceShift(step: number, r: number) {
	if (step === 2) return 0
	return step * round(((r - 0.5) * 6) / step)
}

// Terraced landmarks turn by quarter turns so their walls run along the tile grid; basalt cones and karst sinks turn freely.
function heroAngle(biome: number, r: number) {
	if (biome === LAVA || biome === KARST) return r * TAU
	return (Math.floor(r * 4) * Math.PI) / 2
}

function heroRandom(hs: number) {
	return (n: number) => hash(hs + n * 31, 7, 3)
}

// A per-cell value built once and kept while its slot holds it.
function cellCache<T>(build: (c: Cell) => T) {
	const cache = memo<T>(12)
	return (c: Cell) => cache(c.key, () => build(c))
}

function lakeDistance(lake: number[], u: number, v: number) {
	return Math.hypot((u - (lake[0] ?? 0)) / (lake[2] ?? 1), (v - (lake[1] ?? 0)) / (lake[3] ?? 1))
}

function butte(q: number, r: Pick, count: number, k: number) {
	const angle = (q * TAU) / count + r(10 + q)
	if (q > 0) {
		const d = (7 + 6 * r(20 + q)) * k
		return {
			r: (2.2 + 1.8 * r(30 + q)) * k,
			top: 6 + 2 * Math.floor(r(40 + q) * 3),
			u: Math.cos(angle) * d,
			v: Math.sin(angle) * d
		}
	}
	const d = 4 * r(20) * k
	return {
		r: (3.6 + 1.4 * r(30)) * k,
		top: 10 + 2 * Math.floor(r(40) * 2),
		u: Math.cos(angle) * d,
		v: Math.sin(angle) * d
	}
}

function ruinTurn(r: number) {
	if (r > 0.5) return Math.PI / 2
	return Math.PI
}

function tierOf(r: number, step: number, chance: number) {
	if (r < chance) return step
	return 0
}

function talusReach(talus: boolean, up: number) {
	if (talus) return up * 1.4 + 1
	return 0
}

function tierLift(inner: boolean, tier: number) {
	if (inner) return tier
	return 0
}

function mouthReach(mouth: boolean, d: number) {
	if (mouth) return 0.9 + d * 0.55
	return 9
}

function marshFloorGround(high: boolean, byCreek: boolean, n: number) {
	if (high) return G.marsh
	if (byCreek) return G.reeds
	return byNoise(n, 0.5, G.mud, G.mud2)
}

function washDepth(ph: number, broken: boolean) {
	if (ph >= 0.25) return 0
	if (broken) return round(5 * clamp(-ph / 0.5 + 0.1, 0, 1))
	if (ph < 0) return 5
	return 0
}

function coneTier(on: boolean, d: number) {
	if (!on) return 0
	if (d < 3.9) return 4
	if (d < 5.5) return 3
	if (d < 7.2) return 2
	if (d < 8.9) return 1
	return 0
}

function breachSurface(tier: number, plainLevel: number, p: number) {
	if (tier > 0) return plainLevel + tier * 3 - 0.55
	return p - 0.3
}

function spillBase(q2: number, plainLevel: number, p: number) {
	if (q2 > 0) return plainLevel
	return p
}

function terraceLevel(step: number, plainLevel: number, fade: number, p: number) {
	if (step > 0) return plainLevel + round(step * 3 * fade)
	return p
}

function fissureLip(fd: number, n: number, ground: number) {
	if (fd < 1.3) return G.crust
	if (fd < 2 && n < 0.6) return G.cinder
	return ground
}

function scorch(d: number, ground: number) {
	if (d < 1.9) return G.cinder
	return ground
}

function ruinStep(on: boolean, m: number, ring: number, top: number) {
	if (!on || m >= top + 4 * ring) return 0
	return clamp(4 - Math.floor((m - top) / ring), 0, 4)
}

function ruinGround(paved: boolean, n: number) {
	if (paved) return G.concrete
	return byNoise(n, 0.45, G.ruingrass, G.grass)
}

function riftWidth(ledge: boolean, side: number, n2: number) {
	if (ledge) return 1.35
	if (side > 0) return 1.75 + n2
	return 2.8 + n2
}

function branchDist(d: number) {
	if (d >= 9) return 9
	return d + 0.35
}

function fadeOf(on: boolean, gap: number) {
	if (on) return smoothstep(0.04, 0.22, gap)
	return 0
}

function plainDraft(t: Draft) {
	if (t.kind === 'flat') return t.liquid === LIQUID.none && !t.feature
	if (t.kind === 'smooth') return t.height === undefined && t.offset === 0
	return false
}

function cornerHeight(t: Tile, x: number, z: number, base: () => number) {
	if (t.ramp && t.height !== undefined) return t.height(x, z, base())
	return t.level
}

function cornerOf(t: Tile, snapped: () => number) {
	if (t.ramp) return snapped()
	return t.level
}

function liquidSurface(t: Tile) {
	if (t.liquid !== LIQUID.none) return t.surface
	return 0
}

function wornGround(biome: number) {
	if (biome === FROST) return G.snowroad
	if (biome === LAVA) return G.tuff
	return G.road
}

function spread(c4: Float32Array) {
	const a = c4[0] ?? 0
	const b = c4[1] ?? 0
	const c = c4[2] ?? 0
	const d = c4[3] ?? 0
	return Number.max(Number.max(a, b), Number.max(c, d)) - Number.min(Number.min(a, b), Number.min(c, d))
}

function inChunk(x: number, z: number, x0: number, z0: number) {
	return x >= x0 && z >= z0 && x < x0 + CHUNK && z < z0 + CHUNK
}

function siteOf(site: Site, r: number) {
	if (site === 'any' && r < 0.4) return 'cliff'
	return site
}

// How a field spreads round its site: the start's fields search close and stay round, cliff fields run in a long band.
function fieldShape(site: Site) {
	if (site === 'start') return {band: 1, search: 4, stretch: 0.6}
	if (site === 'cliff') return {band: 1.8, search: 10, stretch: 1.5}
	return {band: 1, search: 10, stretch: 1.5}
}

// A ruin on a landmark's terrace stands taller than one on the plain.
function houseLift(feature: boolean) {
	if (feature) return 0.5
	return 0
}

// The first feature round a point whose use gives a value, nearest grid cells first by row.
function eachFeature<F, R>(g: Grid<F>, x: number, z: number, use: (f: F) => R) {
	const gx = Math.floor(x / g.size)
	const gz = Math.floor(z / g.size)
	return Option.getOrUndefined(
		Array.reduce(OFFSETS, Option.none<NonNullable<R>>(), (found, o) => {
			if (Option.isSome(found)) return found
			return Option.flatMap(g.feature(gx + o.x, gz + o.z), f => Option.fromNullishOr(use(f)))
		})
	)
}

// A natural way up: the climb settled into one-level treads, their edges wobbled by noise so the stair reads as scree and broken ledges.
function steps(ground: number, height: HeightAt, s: number) {
	return smooth(ground, (px, pz, s0) => height(px, pz, s0) + 0.45 * (fbm(s, px / 2.3, pz / 2.3) - 0.5))
}

// A path's half width, wandering between narrow and broad along it.
function wander(s: number, x: number, z: number, w0: number) {
	return w0 + 1.3 * fbm(s + 9, x / 4, z / 4)
}

// How far a mesa's plain sits from its washes: solid ground near a landmark or the start, noise elsewhere, held back near a border.
function washLevel(solid: boolean, h: Here) {
	if (solid) return 1
	const held = smoothstep(0.05, 0.25, h.n.gap)
	return (
		(0.75 * noise(h.hs + 30, h.x / 24, h.z / 24) + 0.25 * fbm(h.hs + 31, h.x / 8, h.z / 8) - 0.38) * held +
		(1 - held) * 0.3
	)
}

// Trees where the woods' noise allows, else a rare rock or lone shrub.
function groveProp(p: number, s: number, odds: {lone: number; rock: number; tree: string; trees: number}) {
	if (p < odds.trees) return {kind: odds.tree, s: 0.9 + 0.5 * s}
	if (p > odds.rock) return {kind: 'rock', s: 0.07 + 0.08 * s}
	if (p > odds.lone) return {kind: 'shrub', s: 1 + 1.2 * s}
	return undefined
}

// Fumaroles on the young flows and scorched ground, fallen column blocks on talus, a dead tree on the old ground.
function lavaProp(g: number, p: number, s: number) {
	const young = g === G.flow || g === G.flow2 || g === G.cinder
	if (p < 0.003 || (young && p < 0.012)) return {kind: 'vent', s: 0.7 + 0.4 * s}
	if (p > 0.988 || (g === G.tuff && p > 0.9)) return {kind: 'rock', role: '#5b524e', s: 0.06 + 0.07 * s}
	if (p < 0.016 && (g === G.weathered || g === G.ash)) return {kind: 'snag', s: 0.8 + 0.3 * s}
	return undefined
}

export function makeWorld(seed: number) {
	const S = {
		basin: seeded(seed, 15),
		cell: seeded(seed, 5),
		creek: seeded(seed, 12),
		dither: seeded(seed, 7),
		flow: seeded(seed, 13),
		gap: seeded(seed, 16),
		macro: seeded(seed, 9),
		moist: seeded(seed, 4),
		odd: seeded(seed, 6),
		ore: seeded(seed, 14),
		prop: seeded(seed, 8),
		ridge: seeded(seed, 10),
		river: seeded(seed, 11),
		temp: seeded(seed, 3),
		warpX: seeded(seed, 1),
		warpZ: seeded(seed, 2)
	}
	const flowAngle = hash(S.flow, 9, 9) * TAU
	const cells = memo<Cell>(14)
	const blocks = memo<Cell[]>(10)
	const frames = memo<Frame>(12)
	const steepBlocks = memo<boolean>(15)
	const tiles = memo<Tile>(17)
	const fields = memo<Option.Option<Field>>(13)
	const lastNear = Array.empty<Near>()
	const lastAt = {x: Infinity, z: Infinity}
	const sum = {n: 0, ridge: 0, s: 0}
	const weights = new Float64Array(BIOME_SHAPE.length)

	// A cell's place and biome on the climate map.
	function climate(ci: number, cj: number) {
		function r(k: number) {
			return hash(S.cell + k * 7919, ci, cj)
		}
		// Alternate rows shift half a cell, so borders between cells do not line up along the grid.
		const x = (ci + 0.25 + 0.5 * r(1) + (cj & 1) * 0.5) * CELL
		const z = (cj + 0.25 + 0.5 * r(2)) * CELL
		const t = clamp((fbm(S.temp, x / 250, z / 250) - 0.5) * 2.6 + 0.5 + (r(3) - 0.5) * 0.35, 0, 1)
		const m = clamp((fbm(S.moist, x / 250, z / 250) - 0.5) * 2.6 + 0.5 + (r(4) - 0.5) * 0.35, 0, 1)
		const o = clamp((fbm(S.odd, x / 190, z / 190) - 0.5) * 3 + 0.56 + (r(12) - 0.5) * 0.3, 0, 1)
		const nearest = Array.reduce(BIOME_SHAPE, {best: 1e9, biome: 0, index: 0}, (acc, shape) => {
			const d = (t - shape.temp) ** 2 + (m - shape.moist) ** 2 + (o - shape.odd) ** 2
			if (d < acc.best) return {best: d, biome: acc.index, index: acc.index + 1}
			return {...acc, index: acc.index + 1}
		})
		return {biome: nearest.biome, r, x, z}
	}

	// The start: the meadow cell nearest the origin within eight cells, or the origin's own cell turned to meadow; its centre is the base.
	const startCell = Array.reduce(
		Array.flatMap(Array.range(-8, 8), cj => Array.map(Array.range(-8, 8), ci => ({ci, cj}))),
		{ci: 0, cj: 0, d: 1e9},
		(best, at) => {
			const c = climate(at.ci, at.cj)
			const d = Math.hypot(c.x, c.z)
			if (c.biome !== MEADOW || d >= best.d) return best
			return {ci: at.ci, cj: at.cj, d}
		}
	)
	const startClimate = climate(startCell.ci, startCell.cj)
	const SP = {
		a0: hash(S.basin, 1, 2) * TAU,
		ci: startCell.ci,
		cj: startCell.cj,
		x: Math.floor(startClimate.x) + 0.5,
		z: Math.floor(startClimate.z) + 0.5
	}
	function cell(ci: number, cj: number) {
		return cells(pack(ci, cj), () => {
			const at = climate(ci, cj)
			const isStart = ci === SP.ci && cj === SP.cj
			const biome = startBiome(isStart, at.biome)
			const angle = at.r(5) * TAU
			const hs = (at.r(11) * INT) | 0
			return {
				biome,
				ca: Math.cos(angle),
				ci,
				cj,
				elevation: (BIOME_SHAPE[biome]?.elevation ?? 0) + terraceShift(BIOME_SHAPE[biome]?.step ?? 1, at.r(9)),
				// No landmark in or by the start basin: its floor stays open.
				heroOn:
					!isStart &&
					Math.hypot(at.x - SP.x, at.z - SP.z) > RB * 1.1 &&
					((ci === 0 && cj === 0) || hash(hs, 7, 3) < 0.62),
				hs,
				key: pack(ci, cj),
				ns: (at.r(10) * INT) | 0,
				rx: CELL * (0.5 + 0.16 * at.r(6)),
				rz: CELL * (0.5 + 0.16 * at.r(7)),
				sa: Math.sin(angle),
				x: at.x,
				z: at.z
			}
		})
	}

	// The cells near a point and their distances: elliptical, normalised by each cell's radii, and wobbled by noise so borders wander.
	function near(x: number, z: number) {
		const cached = lastNear[0]
		if (x === lastAt.x && z === lastAt.z && cached !== undefined) return cached
		const wx = x + 44 * (fbm(S.warpX, x / 90, z / 90) - 0.5)
		const wz = z + 44 * (fbm(S.warpZ, x / 90, z / 90) - 0.5)
		// A 4 × 4 block round the point: the nearest cell by normalised distance is always inside it.
		const ci = Math.floor(wx / CELL - 0.5)
		const cj = Math.floor(wz / CELL - 0.5)
		const block = blocks(pack(ci, cj), () => Array.map(BLOCK, o => cell(ci + o.x, cj + o.z)))
		const dists = new Float64Array(16)
		const pick = {best: 0, least: 1e9, second: 1e9}
		Array.forEach(block, (c, q) => {
			const dx = wx - c.x
			const dz = wz - c.z
			dists[q] = Math.hypot((dx * c.ca + dz * c.sa) / c.rx, (-dx * c.sa + dz * c.ca) / c.rz)
			pick.least = Number.min(pick.least, dists[q] ?? 1e9)
		})
		Array.forEach(block, (c, q) => {
			dists[q] = (dists[q] ?? 0) + jitter((dists[q] ?? 0) < pick.least + 0.6, c.ns, x, z)
			if ((dists[q] ?? 1e9) < (dists[pick.best] ?? 1e9)) pick.best = q
		})
		Array.forEach(block, (_, q) => {
			if (q !== pick.best) pick.second = Number.min(pick.second, dists[q] ?? 1e9)
		})
		const min = dists[pick.best] ?? 0
		const found = {block, dists, dom: block[pick.best] ?? cell(ci, cj), gap: pick.second - min, min, wx, wz}
		lastNear[0] = found
		lastAt.x = x
		lastAt.z = z
		return found
	}

	// How much of the start basin's floor a point is: 1 on the floor, falling to 0 RB tiles out, its rim wobbled by noise.
	function basinW(x: number, z: number) {
		const d2 = (x - SP.x) ** 2 + (z - SP.z) ** 2
		if (d2 > RB * RB * 1.5) return 0
		return 1 - smoothstep(0.5, 1, (Math.sqrt(d2) / RB) * (1 + 0.4 * (fbm(S.basin, x / 24, z / 24) - 0.5)))
	}

	// The biome bases: the continuous ground every biome blends with its neighbours; the gentle biomes keep only slow noise, so whole levels draw broad contour terraces.
	function base(b: number, x: number, z: number, c: Cell) {
		if (b === MEADOW) {
			return 5 + 2.2 * (noise(c.ns + 1, x / 12, z / 12) - 0.5) + 4.5 * (fbm(c.ns + 2, x / 34, z / 34) - 0.5)
		}
		if (b === MARSH) return 2.8 + 1.6 * (noise(c.ns + 1, x / 16, z / 16) - 0.5)
		if (b === FUNGAL) return 3 + 1.8 * (noise(c.ns + 1, x / 14, z / 14) - 0.5)
		// Basalt in broad flows a terrace or two apart; salt in pans a step apart.
		if (b === LAVA) return 3 + 8 * (fbm(c.ns + 1, x / 26, z / 26) - 0.5)
		if (b === SALT) return 7 + 4 * (fbm(c.ns + 1, x / 30, z / 30) - 0.5)
		if (b === RUINS) return 5
		if (b === GLASS) return 6 + 3 * (fbm(c.ns + 1, x / 40, z / 40) - 0.5)
		if (b === SPRINGS) return 7 + 3 * (fbm(c.ns + 1, x / 30, z / 30) - 0.5)
		// Paddy hills: a level every few tiles, so each contour is a terrace a field wide.
		if (b === PADDIES) {
			return 5 + 14 * (fbm(c.ns + 1, x / 44, z / 44) - 0.5) + 2 * (noise(c.ns + 2, x / 12, z / 12) - 0.5)
		}
		if (b === CORAL) return 2.5 + 1.2 * (noise(c.ns + 1, x / 12, z / 12) - 0.5)
		if (b === PRISM) return 6 + 3 * (fbm(c.ns + 1, x / 30, z / 30) - 0.5)
		if (b === TUNDRA) return 3 + 1.6 * (noise(c.ns + 1, x / 16, z / 16) - 0.5)
		if (b === AUTUMN) {
			return 5 + 3 * (noise(c.ns + 1, x / 12, z / 12) - 0.5) + 7 * (fbm(c.ns + 2, x / 34, z / 34) - 0.5)
		}
		return 9
	}

	function heroHold(nr: Near) {
		if (nr.dom.heroOn) return smoothstep(0.3, 0.62, nr.min)
		return 1
	}

	// A crest with a flat top a few tiles wide, not a knife edge that terraces into a row of one-tile pillars.
	function ridgeAt(nr: Near, x: number, z: number) {
		const amp = 15 * smoothstep(0.4, 0.6, noise(S.ridge + 5, x / 120, z / 120))
		if (amp < 0.01) return 0
		return amp * smoothstep(0.046, 0.014, Math.abs(fbm(S.ridge, nr.wx / 230, nr.wz / 230) - 0.5))
	}

	function blendLand(x: number, z: number) {
		const nr = near(x, z)
		// The land's long swell under every biome, and ridges: long crests up to fifteen levels tall that run on across biomes.
		const swell = 12 * (fbm(S.macro, x / 150, z / 150) - 0.5)
		sum.n = 0
		sum.ridge = 0
		sum.s = 0
		Array.forEach(nr.block, (c, index) => {
			const e = Math.exp(-((nr.dists[index] ?? 0) - nr.min) / 0.11)
			if (e < 0.004) return
			const shape = BIOME_SHAPE[c.biome]
			sum.s += e * (base(c.biome, x, z, c) + c.elevation + swell * (shape?.macro ?? 1))
			sum.ridge += e * (shape?.ridge ?? 0)
			sum.n += e
		})
		return sum.s / sum.n + (sum.ridge / sum.n) * heroHold(nr) * ridgeAt(nr, x, z)
	}

	// The basin floor's level: the land's own at the base, on a multiple of six so every biome's step rounds it alike.
	const startLevel = 6 * round(blendLand(SP.x, SP.z) / 6)

	// The blended base at a point; the start basin pulls the land to its floor's level.
	function blendS(x: number, z: number) {
		const land = blendLand(x, z)
		const w = basinW(x, z)
		if (w > 0) return land + (startLevel - land) * w
		return land
	}

	// Colour weights per biome at a point, jittered so a border breaks into drifts and patches.
	function colourWeights(x: number, z: number) {
		const nr = near(x, z)
		weights.set(Array.replicate(0, BIOME_SHAPE.length))
		const total = Array.reduce(nr.block, 0, (acc, c, index) => {
			const e = Math.exp(-((nr.dists[index] ?? 0) - nr.min) / 0.06)
			if (e < 0.004) return acc
			const j = e * 5 ** (2 * (fbm(S.dither + c.biome * 101, x / 2.6, z / 2.6) - 0.5))
			weights[c.biome] = (weights[c.biome] ?? 0) + j
			return acc + j
		})
		Array.forEach(BIOME_SHAPE, (_, b) => {
			weights[b] = (weights[b] ?? 0) / total
		})
		return weights
	}

	// A landmark's frame: its scale shrinks when a neighbour's centre is close, so the landmark stays inside its own ground; it stands on the plain at its centre, on its biome's step.
	function frame(c: Cell) {
		return frames(c.key, () => {
			const nd = Array.reduce(OFFSETS, 1e9, (low, o) => {
				if (o.x === 0 && o.z === 0) return low
				const other = cell(c.ci + o.x, c.cj + o.z)
				return Number.min(low, Math.hypot(other.x - c.x, other.z - c.z))
			})
			const angle = heroAngle(c.biome, hash(c.hs + 50 * 31, 7, 3))
			const step = BIOME_SHAPE[c.biome]?.step ?? 1
			return {
				ca: Math.cos(angle),
				k: clamp(nd / 2 / 18, 0.62, 1.12) * (0.9 + 0.2 * hash(c.hs, 1, 1)),
				on: c.heroOn,
				plain: step * round(blendS(c.x, c.z) / step),
				sa: Math.sin(angle)
			}
		})
	}

	function local(c: Cell, x: number, z: number) {
		const f = frame(c)
		return {u: (x - c.x) * f.ca + (z - c.z) * f.sa, v: -(x - c.x) * f.sa + (z - c.z) * f.ca}
	}

	function world(c: Cell, u: number, v: number) {
		const f = frame(c)
		return {x: c.x + u * f.ca - v * f.sa, z: c.z + u * f.sa + v * f.ca}
	}

	// On the gentle one-level biomes a rise steeper than a level every two tiles steps three levels at a time; the slope is judged once per 4 × 4 block, grown by a block each way so the seam lies out on gentle ground.
	function steep(x: number, z: number) {
		const bx = Math.floor(x / 4)
		const bz = Math.floor(z / 4)
		return Array.some(OFFSETS, o =>
			steepBlocks(pack(bx + o.x, bz + o.z), () => {
				const mx = (bx + o.x) * 4 + 2
				const mz = (bz + o.z) * 4 + 2
				return (blendS(mx + 2, mz) - blendS(mx - 2, mz)) ** 2 + (blendS(mx, mz + 2) - blendS(mx, mz - 2)) ** 2 > 4
			})
		)
	}

	// Where a tall-stepped biome's terrace wall has broken down, the plain steps a level at a time instead: a natural stair legs and tracks climb.
	function gapAt(x: number, z: number) {
		return fbm(S.gap, x / 26, z / 26) > 0.6
	}

	function plainLv(b: number, x: number, z: number, s0: number) {
		const step = BIOME_SHAPE[b]?.step ?? 1
		if (b !== MARSH && b !== FUNGAL) {
			if (step > 1 && gapAt(x, z)) return round(s0)
			return step * round(s0 / step)
		}
		if (steep(x, z) && !gapAt(x, z)) return 3 * round(s0 / 3)
		return round(s0)
	}

	// Basalt: flows run downhill in long tongues along one direction per region, the oldest ground between them pale and weathered, ash laid in drifts across the flow.
	function flowAt(x: number, z: number) {
		const a = flowAngle + 1.6 * (noise(S.flow + 21, x / 260, z / 260) - 0.5)
		const wx = x + 10 * (fbm(S.flow + 22, x / 30, z / 30) - 0.5)
		const wz = z + 10 * (fbm(S.flow + 23, x / 30, z / 30) - 0.5)
		return fbm(S.flow + 20, (wx * Math.cos(a) + wz * Math.sin(a)) / 38, (-wx * Math.sin(a) + wz * Math.cos(a)) / 10)
	}

	function lavaGround(x: number, z: number) {
		const fl = flowAt(x, z)
		if (fl > 0.57) return byNoise(fbm(S.dither + 82, x / 3.2, z / 3.2), 0.5, G.flow, G.flow2)
		const a = flowAngle + Math.PI / 2
		if (
			fbm(S.dither + 80, (x * Math.cos(a) + z * Math.sin(a)) / 15, (-x * Math.sin(a) + z * Math.cos(a)) / 4) >
			0.65 - 0.12 * (0.57 - fl)
		) {
			return G.ash
		}
		if (fl < 0.4 && fbm(S.dither + 83, x / 6, z / 6) > 0.48) return G.weathered
		return byNoise(fbm(S.dither + 84, x / 4.5, z / 4.5), 0.5, G.basalt, G.basalt2)
	}

	// Salt crust: polygon plates of a jittered Voronoi grid, cracked along their edges, with pink and ochre drifts over them.
	function saltCrust(x: number, z: number) {
		const gx = Math.floor(x / 4.6)
		const gz = Math.floor(z / 4.6)
		const found = Array.reduce(OFFSETS, {d1: 9, d2: 9, id: 0}, (acc, o) => {
			const px = gx + o.x
			const pz = gz + o.z
			const d = Math.hypot(x - (px + hash(S.dither + 70, px, pz)) * 4.6, z - (pz + hash(S.dither + 71, px, pz)) * 4.6)
			if (d < acc.d1) return {d1: d, d2: acc.d1, id: hash(S.dither + 72, px, pz)}
			if (d < acc.d2) return {...acc, d2: d}
			return acc
		})
		if (found.d2 - found.d1 < 0.7) return G.saltcrack
		if (fbm(S.dither + 73, x / 9, z / 9) > 0.64) return G.saltpink
		if (fbm(S.dither + 74, x / 11, z / 11) > 0.66) return G.saltochre
		return byNoise(found.id, 0.5, G.salt, G.salt2)
	}

	// Glass dunes: sand fused to glass in streaks along the wind.
	function glassGround(x: number, z: number) {
		const fused = fbm(S.dither + 90, x / 7, z / 3)
		if (fused > 0.63) return G.glass
		if (fused > 0.57) return G.glass2
		return G.glasssand
	}

	// The plain ground of the strange half of the climate map's biomes, from glass on.
	function strangeGround(b: number, x: number, z: number) {
		const n = fbm(S.dither + 50 + b, x / 2.6, z / 2.6)
		if (b === GLASS) return glassGround(x, z)
		if (b === SPRINGS) return byNoise(fbm(S.dither + 91, x / 5, z / 5), 0.6, G.travrust, G.travertine)
		if (b === PADDIES) return byNoise(n, 0.5, G.paddy, G.paddy2)
		if (b === CORAL) return G.coralsand
		if (b === CANYON) return byNoise(n, 0.5, G.crimson, G.crimson2)
		if (b === PRISM) return byNoise(n, 0.62, G.prismlilac, byNoise(n, 0.45, G.prism, G.prism2))
		if (b === TUNDRA) return byNoise(n, 0.6, G.frostmoss, byNoise(n, 0.45, G.tundra, G.tundra2))
		return byNoise(fbm(S.dither + 96, x / 4, z / 4), 0.6, G.litter, byNoise(n, 0.5, G.autumn, G.autumn2))
	}

	function plainGround(b: number, x: number, z: number) {
		if (b >= GLASS) return strangeGround(b, x, z)
		const n = fbm(S.dither + 50 + b, x / 2.6, z / 2.6)
		if (b === MEADOW) return byNoise(n, 0.5, G.grass, G.grass2)
		if (b === MARSH) return byNoise(n, 0.42, G.marsh, byNoise(n, 0.32, G.reeds, G.mud2))
		if (b === MESA) return byNoise(n, 0.5, G.sand, G.sand2)
		if (b === FROST) return byNoise(n, 0.5, G.snow, G.snow2)
		if (b === LAVA) return lavaGround(x, z)
		if (b === RUINS) return byNoise(n, 0.5, G.ruingrass, G.grass)
		if (b === FUNGAL) return byNoise(n, 0.55, G.moss, byNoise(n, 0.4, G.mauve, G.mauve2))
		if (b === KARST) return byNoise(n, 0.5, G.karstgrass, G.pave)
		return saltCrust(x, z)
	}

	// The start basin's fields: one per starter material round the base, 15 to 26 tiles out on the floor, each owning the floor nearest its own point.
	function startPt(i: number) {
		const a = SP.a0 + (i * TAU) / START.length + (hash(S.ore + 500 + 7919, i, 3) - 0.5) * 0.5
		const d = 15 + 11 * hash(S.ore + 500 + 2 * 7919, i, 3)
		return {x: Math.floor(SP.x + Math.cos(a) * d) + 0.5, z: Math.floor(SP.z + Math.sin(a) * d) + 0.5}
	}

	function grid<F>(
		kind: number,
		size: number,
		open: boolean,
		make: (r: Pick, x: number, z: number, n: Near) => Option.Option<F>
	) {
		const cache = memo<Option.Option<F>>(13)
		const gridSeed = seeded(seed, kind)
		return {
			feature: (gx: number, gz: number) =>
				cache(pack(gx, gz), () => {
					function r(k: number) {
						return hash(gridSeed + k * 977, gx, gz)
					}
					const x = (gx + 0.2 + 0.6 * r(1)) * size
					const z = (gz + 0.2 + 0.6 * r(2)) * size
					// The start basin's floor keeps only meadow tables and ponds, clear of the base and of its start fields.
					const clear =
						open &&
						Math.hypot(x - SP.x, z - SP.z) > 16 &&
						Array.every(START, (_, i) => {
							const q = startPt(i)
							return Math.hypot(x - q.x, z - q.z) > 16
						})
					if (basinW(x, z) < 0.15 || clear) return make(r, x, z, near(x, z))
					return Option.none()
				}),
			size
		}
	}

	function interior(n: Near, biome: number, need: number) {
		return n.dom.biome === biome && n.gap > need
	}

	// Clear of the cell's landmark (cells without one are filler throughout).
	function away(n: Near, fx: number, fz: number, radius: number) {
		const f = frame(n.dom)
		if (!f.on) return true
		const at = local(n.dom, fx, fz)
		return Math.hypot(at.u, at.v) > radius * f.k
	}

	function shelfGrid(kind: number, size: number, biome: number, o: Shelf) {
		return grid(kind, size, false, (r, fx, fz, nn) => {
			if (!(r(3) < o.p && interior(nn, biome, 0.14) && away(nn, fx, fz, 15 + size * 0.5))) return Option.none()
			const step = BIOME_SHAPE[biome]?.step ?? 1
			const radius = o.r0 + o.r1 * r(4)
			const angle = r(6) * TAU
			const up = o.up(r(5))
			return Option.some({
				base: step * round(blendS(fx, fz) / step),
				e: o.exp * (0.6 + 0.8 * r(9)),
				ice: r(8) < o.ice,
				r: radius,
				s: (r(7) * MILLION) | 0,
				sx: 0.75 + 0.5 * r(10),
				ti: 0.35 + 0.2 * r(12),
				tier: tierOf(r(11), step, o.tier),
				// The talus: a cone whose apex sits just inside the rim, a level for every 1.4 tiles out from it.
				tr: talusReach(r(13) < o.talus, up),
				tx: fx + Math.cos(angle) * radius * 0.8,
				tz: fz + Math.sin(angle) * radius * 0.8,
				up,
				x: fx,
				z: fz
			})
		})
	}

	// Features on world grids of their own: one candidate per grid cell, kept only where its biome holds the whole of it.
	const tables = grid(251, 23, true, (r, fx, fz, nn) => {
		if (!(r(3) < 0.55 && interior(nn, MEADOW, 0.16) && away(nn, fx, fz, 24))) return Option.none()
		const angle = r(6) * TAU
		return Option.some({
			ca: Math.cos(angle),
			rx: 5 + 4 * r(4),
			rz: 3.5 + 2.5 * r(5),
			s: (r(8) * MILLION) | 0,
			sa: Math.sin(angle),
			up: 3 + Math.floor(r(7) * 4),
			x: fx,
			z: fz
		})
	})
	const ponds = grid(240, 26, true, (r, fx, fz, nn) => {
		if (!(r(3) < 0.4 && interior(nn, MEADOW, 0.12) && away(nn, fx, fz, 22))) return Option.none()
		return Option.some({
			l: round(blendS(fx, fz)) - 0.3,
			rx: 2.4 + 2 * r(4),
			rz: 1.8 + 1.6 * r(5),
			s: (r(6) * MILLION) | 0,
			x: fx,
			z: fz
		})
	})
	const buttes = grid(233, 15, false, (r, fx, fz, nn) => {
		if (!(r(3) < 0.6 && interior(nn, MESA, 0.14) && away(nn, fx, fz, 21))) return Option.none()
		return Option.some({r: 1.5 + 2.2 * r(4), s: (r(6) * MILLION) | 0, top: 4 + 2 * Math.floor(r(5) * 3), x: fx, z: fz})
	})
	const pools = grid(264, 19, false, (r, fx, fz, nn) => {
		if (!(r(3) < 0.35 && interior(nn, LAVA, 0.14) && away(nn, fx, fz, 22))) return Option.none()
		return Option.some({rx: 2.2 + 2.4 * r(4), rz: 1.8 + 1.8 * r(5), s: (r(6) * MILLION) | 0, x: fx, z: fz})
	})
	const causeways = grid(255, 21, false, (r, fx, fz, nn) => {
		if (!(r(3) < 0.3 && interior(nn, LAVA, 0.14) && away(nn, fx, fz, 18))) return Option.none()
		const angle = r(8) * TAU
		return Option.some({
			ca: Math.cos(angle),
			e1: r(4),
			e2: r(5),
			s: (r(6) * MILLION) | 0,
			sa: Math.sin(angle),
			top: 2 + Math.floor(r(7) * 2),
			x: fx,
			z: fz
		})
	})
	const holes = grid(232, 12, false, (r, fx, fz, nn) => {
		if (!(r(3) < 0.55 && interior(nn, KARST, 0.12) && away(nn, fx, fz, 9))) return Option.none()
		return Option.some({
			ledge: r(7) < 0.5,
			pool: r(6) < 0.5,
			r: 1.5 + 1.3 * r(4),
			s: (r(5) * MILLION) | 0,
			x: fx,
			z: fz
		})
	})
	const pans = grid(233, 15, false, (r, fx, fz, nn) => {
		if (!(r(3) < 0.55 && interior(nn, SALT, 0.12) && away(nn, fx, fz, 22))) return Option.none()
		return Option.some({rx: 2 + 3 * r(4), rz: 1.6 + 2.2 * r(5), s: (r(6) * MILLION) | 0, x: fx, z: fz})
	})
	// Raised shelves, rounded squares along the tile grid; frost keeps some frozen ponds instead, and some shelves keep a talus of fallen rock settled into one-level treads that legs and tracks climb.
	const mounds = shelfGrid(244, 17, FROST, {
		exp: 4,
		ice: 0.3,
		p: 0.6,
		r0: 3,
		r1: 3,
		talus: 0.5,
		tier: 0,
		up: q => byNoise(0.6, q, 3, 6)
	})
	const shelves = shelfGrid(250, 15, LAVA, {
		exp: 2.5,
		ice: 0,
		p: 0.5,
		r0: 3.5,
		r1: 4.5,
		talus: 0.55,
		tier: 0.35,
		up: q => byNoise(0.65, q, 3, 6)
	})
	const saltTables = shelfGrid(271, 17, SALT, {
		exp: 3,
		ice: 0,
		p: 0.65,
		r0: 3.5,
		r1: 4,
		talus: 0.5,
		tier: 0.5,
		up: q => byNoise(0.5, q, 4, 6)
	})
	// Tower karst: a main tower and up to two smaller ones leaning on it, each a stack of a mossy foot, a shoulder and a grassy top.
	const towers = grid(296, 11, false, (r, fx, fz, nn) => {
		if (!(r(3) < 0.62 && interior(nn, KARST, 0.12) && away(nn, fx, fz, 10))) return Option.none()
		return Option.some({
			s: (r(5) * MILLION) | 0,
			spires: Array.map(Array.range(0, Math.floor(r(4) * 3)), q => {
				const angle = r(30 + q) * TAU
				const reach = flag(q > 0) * (2 + 1.2 * r(40 + q))
				return {
					r: mix(1.8, 1.15, flag(q > 0)) + 0.8 * r(10 + q),
					top: mix(12, 7, flag(q > 0)) + 2 * Math.floor(r(20 + q) * 3),
					x: fx + Math.cos(angle) * reach,
					z: fz + Math.sin(angle) * reach
				}
			}),
			x: fx,
			z: fz
		})
	})
	// Hot springs: travertine terraces stepping down from a vent, a turquoise pool behind every rim.
	const springs = grid(281, 19, false, (r, fx, fz, nn) => {
		if (!(r(3) < 0.6 && interior(nn, SPRINGS, 0.12) && away(nn, fx, fz, 20))) return Option.none()
		return Option.some({
			base: round(blendS(fx, fz)),
			rings: 2 + Math.floor(r(4) * 3),
			s: (r(5) * MILLION) | 0,
			w: 1.7 + 0.7 * r(6),
			x: fx,
			z: fz
		})
	})
	// Crystal stands: hexagonal columns of different heights packed together, like a geode turned inside out.
	const crystals = grid(291, 10, false, (r, fx, fz, nn) => {
		if (!(r(3) < 0.55 && interior(nn, PRISM, 0.1) && away(nn, fx, fz, 12))) return Option.none()
		return Option.some({
			columns: Array.map(Array.range(0, 1 + Math.floor(r(4) * 4)), q => {
				const angle = r(30 + q) * TAU
				const reach = flag(q > 0) * (1.3 + 1.1 * r(40 + q))
				return {
					r: 0.8 + 0.9 * r(10 + q) + 0.5 * flag(q === 0),
					top: 3 + Math.floor(r(20 + q) * 7) + 3 * flag(q === 0),
					x: fx + Math.cos(angle) * reach,
					z: fz + Math.sin(angle) * reach
				}
			}),
			turn: r(6) * TAU,
			x: fx,
			z: fz
		})
	})

	// The landmarks, one per cell: parameterised versions of the atlas dioramas.
	const meadowHero = cellCache(c => {
		// A high meadow with a cliff, grassy ledges up its far end, a river across it falling into a lake below.
		const r = heroRandom(c.hs)
		const k = frame(c).k
		const a = (10 + 3 * r(1)) * k
		const b0 = (6.5 + 2 * r(2)) * k
		const flip = sideOf(r(4) - 0.5)
		const up = 7 + Math.floor(r(3) * 4)
		const lake = [0.04 * a, b0 * flip + 3.6 * k * flip, 4.6 * k, 3.4 * k]
		const at = world(c, lake[0] ?? 0, lake[1] ?? 0)
		return {
			a,
			b: b0,
			lake,
			lakeL: round(blendS(at.x, at.z)) - 0.3,
			rampL: up / 0.7,
			river: chaikin(
				[
					{x: -0.75 * a, z: -0.35 * b0 * flip},
					{x: -0.35 * a, z: 0.05 * b0 * flip},
					{x: -0.05 * a, z: 0.55 * b0 * flip},
					{x: 0.02 * a, z: 1.25 * b0 * flip}
				],
				2
			),
			up,
			v0: -0.25 * b0 * flip
		}
	})
	const marshHero = cellCache(c => {
		const r = heroRandom(c.hs)
		const k = frame(c).k
		const a = (9 + 2 * r(1)) * k
		const b = (7.5 + 1.5 * r(2)) * k
		return {
			a,
			b,
			floor: round(base(MARSH, c.x, c.z, c) + c.elevation) - (5 + Math.floor(r(3) * 2)),
			hum: Array.map(Array.range(0, 4), n => ({
				r: 1.6 + r(30 + n),
				u: (r(10 + n) - 0.5) * 1.3 * a,
				v: (r(20 + n) - 0.5) * 1.3 * b
			})),
			v0: (r(4) - 0.5) * b
		}
	})
	const mesaHero = cellCache(c => {
		// Buttes ten to sixteen levels tall with a shoulder ring, and a slot canyon between them.
		const r = heroRandom(c.hs)
		const k = frame(c).k
		const count = 3 + Math.floor(r(1) * 3)
		const side = sideOf(r(6) - 0.5)
		const length = 17 * k
		const w = 4 * k * side
		const slot = chaikin(
			[
				{x: -length, z: w + 2 * side},
				{x: -length * 0.35, z: w},
				{x: length * 0.1, z: w + 3 * side},
				{x: length * 0.55, z: w + side},
				{x: length, z: w + 4 * side}
			],
			2
		)
		return {buttes: Array.map(Array.range(0, count - 1), q => butte(q, r, count, k)), slot, slotLen: polyLen(slot)}
	})
	const frostHero = cellCache(c => {
		const r = heroRandom(c.hs)
		const k = frame(c).k
		const n = 3 + Math.floor(r(5) * 3)
		const a = (11 + 1.2 * n + 3 * r(1)) * k
		const b = (9 + n + 3 * r(2)) * k
		const us = (r(4) - 0.5) * 0.6 * a
		return {
			a,
			b,
			eo: 0.88,
			exp: 2.2 + r(6),
			lake: [us, -b * 1.12, 3.8 * k, 2.6 * k],
			n,
			tw: (0.88 - 0.3) / (n - 1),
			us,
			vr: (r(3) - 0.5) * 0.6 * b
		}
	})
	const lavaHero = cellCache(c => {
		const r = heroRandom(c.hs)
		const k = frame(c).k
		const th = r(1) * TAU
		function along(d: number, o: number) {
			return {x: Math.cos(th + o) * d * k, z: Math.sin(th + o) * d * k}
		}
		const lake = along(17.5, 1.05)
		return {
			breach: chaikin([{x: 0, z: 0}, along(5, 0), along(9, 0.25), along(12.5, 0.55), along(15, 0.9)], 2),
			lake: [lake.x, lake.z, 4 * k, 2.8 * k],
			ramp0: r(2) * TAU
		}
	})
	const ruinsHero = cellCache(c => {
		const r = heroRandom(c.hs)
		const k = frame(c).k
		return {ang: [0, ruinTurn(r(2))], ring: 3.4 * k, top: (2 + 2 * r(3)) * k}
	})
	const fungalHero = cellCache(c => {
		const r = heroRandom(c.hs)
		const k = frame(c).k
		const a = (10 + 3 * r(1)) * k
		const b = (8 + 2 * r(2)) * k
		return {
			a,
			b,
			stream: chaikin(
				[
					{x: -1.6 * a, z: -b * (1.1 + 0.3 * r(7))},
					{x: -0.7 * a, z: -b * (1.05 + 0.25 * r(8))},
					{x: 0, z: -b * 1.02 - 0.8},
					{x: 0.8 * a, z: -b * (1.08 + 0.3 * r(9))},
					{x: 1.6 * a, z: -b * (1.1 + 0.25 * r(10))}
				],
				3
			)
		}
	})
	const karstHero = cellCache(c => {
		const r = heroRandom(c.hs)
		const k = frame(c).k
		const a = r(2) * TAU
		return {
			chan: chaikin(
				[
					{x: Math.cos(a) * 16 * k, z: Math.sin(a) * 16 * k},
					{x: Math.cos(a + 0.4) * 8 * k, z: Math.sin(a + 0.4) * 8 * k},
					{x: Math.cos(a) * 1.5, z: Math.sin(a) * 1.5}
				],
				2
			),
			r: (2.8 + 0.6 * r(1)) * k
		}
	})
	const saltHero = cellCache(c => {
		const r = heroRandom(c.hs)
		const k = frame(c).k
		const a = (r(1) - 0.5) * 0.5
		const length = 20 * k
		const b = (r(2) - 0.5) * 8 * k
		function at(t: number, o: number) {
			return {x: Math.cos(a) * t - Math.sin(a) * o, z: Math.sin(a) * t + Math.cos(a) * o}
		}
		const rift = chaikin([at(-length, -b), at(-length * 0.4, b * 0.5), at(length * 0.15, -b * 0.6), at(length, b)], 4)
		const da = a + sideOf(r(3) - 0.5) * 1.4
		return {dome: [Math.cos(da) * 9 * k, Math.sin(da) * 9 * k, 3.6 * k], len: polyLen(rift), rift}
	})

	function shelf(g: ReturnType<typeof shelfGrid>, x: number, z: number, talusGround: number) {
		return eachFeature(g, x, z, f => {
			const d =
				(Math.abs((x - f.x) / f.sx) ** f.e + Math.abs((z - f.z) * f.sx) ** f.e) ** (1 / f.e) / f.r +
				0.55 * (fbm(f.s, x / 3, z / 3) - 0.5)
			if (f.ice && d < 0.6) return wet(LIQUID.ice, f.base + 0.12, f.base - 0.4, G.snow)
			if (f.ice) return undefined
			const onTalus = f.tr > 0 && Math.hypot(x - f.tx, z - f.tz) < f.r * 0.9
			if (d < 1) return flat(f.base + f.up + tierLift(d < f.ti && !onTalus, f.tier), -1)
			if (f.tr === 0) return undefined
			const level =
				f.base +
				round(f.up * (1 - (Math.hypot(x - f.tx, z - f.tz) + 0.9 * (fbm(f.s + 3, x / 2.2, z / 2.2) - 0.5)) / f.tr))
			if (level > f.base) return flat(Number.min(level, f.base + f.up), talusGround)
			return undefined
		})
	}

	// Rivers: a long meandering line through every biome but the dry and the drowned ones, carved a little into the ground; frozen in frost.
	function river(t: Draft, h: Here) {
		if (Array.contains([LAVA, SALT, GLASS, CORAL, CANYON], h.b) || !plainDraft(t)) return t
		const d = zeroDist(S.river, 190, h.x, h.z, 0.025)
		if (d > 2.6 || basinW(h.x, h.z) > 0.05 || ridgeAt(near(h.x, h.z), h.x, h.z) > 1.5) return t
		if (d < 1.05 && h.b === FROST) return wet(LIQUID.ice, h.p - 0.2, h.p - 1, G.snow)
		if (d < 1.05) return wet(LIQUID.water, h.p - 0.4, h.p - 1, G.bed)
		if (d < 1.9 && h.b === MEADOW) return {...t, ground: G.shore}
		return t
	}

	// Tilted tables: a slab of meadow raised on one side into a cliff, sloping back down to the plain on the other.
	function meadowTable(h: Here) {
		if (h.on && Math.hypot(h.u, h.v) <= 20 * h.k) return undefined
		return eachFeature(tables, h.x, h.z, f => {
			function across(q: number, w: number) {
				return ((q - f.x) * f.ca + (w - f.z) * f.sa) / f.rx
			}
			function tilt(px: number, pz: number, s: number) {
				return s + f.up * clamp(0.5 + 0.62 * across(px, pz), 0, 1)
			}
			const e =
				Math.hypot(across(h.x, h.z), (-(h.x - f.x) * f.sa + (h.z - f.z) * f.ca) / f.rz) +
				0.25 * (fbm(f.s, h.x / 2.2, h.z / 2.2) - 0.5)
			if (e >= 1) return undefined
			// The raised edge's rim is worn to pale grass.
			if (e > 0.8 && across(h.x, h.z) > 0) return smooth(G.grass2, tilt)
			return smooth(-1, tilt)
		})
	}

	// The high meadow: a cliff, grassy ledges up its far end, a river across it falling into a lake below.
	function meadowLandmark(h: Here) {
		const H = meadowHero(h.c)
		const rq = segDist(h.u, h.v, H.river)
		if (Math.hypot(h.u / H.a, h.v / H.b) + 0.22 * (fbm(h.hs + 4, h.x / 2.6, h.z / 2.6) - 0.5) < 1) {
			if (rq.d < 0.95) return wet(LIQUID.water, round(h.s0 + H.up) - 0.35, round(h.s0 + H.up) - 0.95)
			if (rq.d < 1.6) return smooth(G.grass2, undefined, H.up)
			return smooth(-1, undefined, H.up)
		}
		const ru = h.u - H.a * 0.9
		// The far end: the high meadow breaks down in grassy ledges a level at a time.
		if (Math.abs(h.v - H.v0) < wander(h.hs, h.x, h.z, 0.9) && ru > -2.5 && ru < H.rampL) {
			return steps(
				-1,
				(px, pz, s) => round(s) + H.up * (1 - clamp((local(h.c, px, pz).u - H.a * 0.9) / H.rampL, 0, 1)),
				h.hs + 40
			)
		}
		const le = lakeDistance(H.lake, h.u, h.v) + 0.22 * (fbm(h.hs + 3, h.x / 2.2, h.z / 2.2) - 0.5)
		const mouth = rq.s > rq.len * 0.6
		if (mouth && rq.d < 0.95 && le > 0.9) return wet(LIQUID.water, H.lakeL, H.lakeL - 1)
		return lakeAt(Number.min(le, mouthReach(mouth, rq.d)), H.lakeL)
	}

	function meadowTile(h: Here) {
		const table = meadowTable(h)
		if (table !== undefined) return table
		if (h.fade > 0.9) {
			const hero = meadowLandmark(h)
			if (hero !== undefined) return hero
		}
		return (
			eachFeature(ponds, h.x, h.z, f =>
				lakeAt(Math.hypot((h.x - f.x) / f.rx, (h.z - f.z) / f.rz) + 0.25 * (fbm(f.s, h.x / 2, h.z / 2) - 0.5), f.l)
			) ?? plain(-1)
		)
	}

	function creekNear(bw: number, x: number, z: number) {
		if (bw >= 0.3) return {d: 9, w: 0}
		// Marsh creeks: the zero lines of a slow field for the main creeks and a quicker one for their branches; a third slow field swells them into pools.
		return {
			d: Number.min(zeroDist(S.creek, 30, x, z, 0.06), branchDist(zeroDist(S.creek + 17, 15, x, z, 0.1))),
			w: 0.6 + 2.8 * smoothstep(0.56, 0.74, noise(S.creek + 5, x / 10, z / 10))
		}
	}

	function marshTile(h: Here) {
		const H = marshHero(h.c)
		const ru = h.u - H.a * 0.55
		const rampLen = H.a * 0.45 + 7
		// The creeks: winding channels that widen into pools where they meet.
		const cr = creekNear(h.bw, h.x, h.z)
		// One side of the basin slumped: muddy ledges a level apart down to the floor.
		if (h.fade > 0.9 && Math.abs(h.v - H.v0) < wander(h.hs, h.x, h.z, 1) && ru > 0 && ru < rampLen) {
			return steps(
				G.mud,
				(px, pz, s) => mix(H.floor + 1, round(s), clamp((local(h.c, px, pz).u - H.a * 0.55) / rampLen, 0, 1)),
				h.hs + 40
			)
		}
		if (h.fade > 0.9 && Math.hypot(h.u / H.a, h.v / H.b) + 0.22 * (fbm(h.hs + 3, h.x / 2.8, h.z / 2.8) - 0.5) < 1) {
			// The basin floor: mud flats a level over the water, hummocks of marsh grass, creeks and pools cut into it.
			const f =
				H.floor +
				0.6 +
				0.3 * (fbm(h.hs + 5, h.x / 2, h.z / 2) - 0.5) +
				Number.sumAll(
					Array.map(H.hum, hum => 1.1 * Math.exp(-((h.u - hum.u) ** 2 + (h.v - hum.v) ** 2) / (hum.r * hum.r)))
				)
			if (cr.d < cr.w + 0.6 || (round(f) <= H.floor + 1 && fbm(h.hs + 6, h.x / 4.5, h.z / 4.5) < 0.42)) {
				return wet(LIQUID.water, H.floor + 0.86, H.floor + 0.72)
			}
			return flat(
				Number.max(round(f), H.floor + 1),
				marshFloorGround(f > H.floor + 1.5, cr.d < cr.w + 2, fbm(h.hs + 7, h.x / 2, h.z / 2))
			)
		}
		if (h.n.gap > 0.06 && cr.d < cr.w) {
			// The water stands at the lowest level round it, so a pool across a contour sinks into the upper terrace; pools only swell where the land round them is level.
			const levels = Array.map(NEIGHBOURS, o =>
				plainLv(
					near(h.x + 2 * o.x, h.z + 2 * o.z).dom.biome,
					h.x + 2 * o.x,
					h.z + 2 * o.z,
					blendS(h.x + 2 * o.x, h.z + 2 * o.z)
				)
			)
			const low = Array.reduce(levels, h.p, (acc, l) => Number.min(acc, l))
			// Shallow: a marsh creek is a ford for wheels, its bed a fraction under the bank.
			if (Array.reduce(levels, h.p, (acc, l) => Number.max(acc, l)) - low <= 1 || cr.d < 0.65) {
				return wet(LIQUID.water, low - 0.12, low - 0.28)
			}
		}
		if (h.n.gap > 0.06 && cr.d < cr.w + 1.6) return flat(h.p, G.reeds, false)
		return plain(-1)
	}

	function mesaButtes(h: Here, list: ReturnType<typeof butte>[], start: number) {
		const ground = byNoise(fbm(h.hs + 3, h.x / 3.5, h.z / 3.5), 0.5, G.sand, G.sand2)
		if (h.fade <= 0.05) return {ground, level: start}
		return Array.reduce(list, {ground, level: start}, (acc, b, q) => {
			const d = Math.hypot(h.u - b.u, h.v - b.v) + 0.45 * (fbm(h.hs + 10 + q, h.x / 1.7, h.z / 1.7) - 0.5)
			if (d < b.r) return {ground: G.redsand, level: Number.max(acc.level, h.frame.plain + round(b.top * h.fade))}
			// A shoulder ring four levels under the butte's top.
			if (d < b.r + 1.5 * h.k) {
				return {ground: G.redsand, level: Number.max(acc.level, h.frame.plain + round((b.top - 4) * h.fade))}
			}
			return acc
		})
	}

	function mesaTile(h: Here) {
		const H = mesaHero(h.c)
		// Washes: broad sand floors five levels under the plateau, walled in banded red; where the wall has slumped it comes down in one-level ledges.
		const wd = washDepth(washLevel((h.on && Math.hypot(h.u, h.v) < 19 * h.k) || h.bw > 0.3, h), gapAt(h.x, h.z))
		const top = mesaButtes(h, H.buttes, h.p - wd)
		if (
			h.fade > 0.9 &&
			top.level < h.frame.plain + 2 &&
			segDist(h.u, h.v, H.slot).d < 1.25 + 0.35 * (fbm(h.hs + 20, h.x / 2, h.z / 2) - 0.5)
		) {
			// The slot's floor falls away from both mouths in broken ledges, a level at a time.
			return steps(
				G.sand2,
				(px, pz) => {
					const at = local(h.c, px, pz)
					const s = segDist(at.u, at.v, H.slot).s
					return h.frame.plain - 6 * clamp(s / 8, 0, 1) * clamp((H.slotLen - s) / 8, 0, 1)
				},
				h.hs + 40
			)
		}
		if (top.level !== h.p - wd) return flat(top.level, top.ground, top.level !== h.p)
		const small = eachFeature(buttes, h.x, h.z, f => {
			const d = Math.hypot(h.x - f.x, h.z - f.z) + 0.45 * (fbm(f.s, h.x / 1.6, h.z / 1.6) - 0.5)
			if (d < f.r) return f.top
			if (d < f.r + 1.1 && f.r > 2.4) return f.top - 3
			return undefined
		})
		if (small !== undefined) return flat(h.p - wd + small, G.redsand, h.p - wd + small !== h.p)
		return flat(h.p - wd, top.ground, wd !== 0)
	}

	function frostStep(h: Here, H: ReturnType<typeof frostHero>) {
		if (!h.on) return 0
		const m =
			((Math.abs(h.u) / H.a) ** H.exp + (Math.abs(h.v) / H.b) ** H.exp) ** (1 / H.exp) +
			0.07 * (fbm(h.hs + 4, h.x / 2.4, h.z / 2.4) - 0.5)
		return clamp(Math.floor((H.eo - m) / H.tw) + 1, 0, H.n)
	}

	function frostFan(climb: boolean, H: ReturnType<typeof frostHero>, h: Here, step: number) {
		const tread = h.frame.plain + round(step * 3 * h.fade)
		if (!climb) return tread
		const td =
			Math.hypot(h.u - H.a * (H.eo - step * H.tw - 0.3 * H.tw), h.v - H.vr) +
			0.9 * (fbm(h.hs + 41, h.x / 2.2, h.z / 2.2) - 0.5)
		const lift = round(3 * (1 - td / 5.2))
		if (lift > 0) return h.frame.plain + 3 * step + Number.min(lift, 3)
		return tread
	}

	function frostOuterFan(east: boolean, H: ReturnType<typeof frostHero>, h: Here) {
		if (!east) return h.p
		const lift = round(
			3 *
				(1 -
					(Math.hypot(h.u - H.a * (H.eo - 0.3 * H.tw), h.v - H.vr) +
						0.9 * (fbm(h.hs + 41, h.x / 2.2, h.z / 2.2) - 0.5)) /
						5.2)
		)
		if (lift > 0) return Number.max(h.p, h.frame.plain + Number.min(lift, 3))
		return h.p
	}

	// Below the terraces: the frozen lake and the stream into it, and the outermost wall's fan on the plain.
	function frostPlain(h: Here, H: ReturnType<typeof frostHero>, ground: number) {
		if (h.fade <= 0.9) return undefined
		if (
			lakeDistance(H.lake, h.u, h.v) + 0.25 * (fbm(h.hs + 5, h.x / 2, h.z / 2) - 0.5) < 1 ||
			(Math.abs(h.u - H.us) < 1.05 && h.v < 0 && h.v > (H.lake[1] ?? 0))
		) {
			return wet(LIQUID.ice, h.p + 0.12, h.p - 0.4, G.snow)
		}
		const fan = frostOuterFan(h.u > 0, H, h)
		if (fan !== h.p) return flat(fan, ground, true)
		return undefined
	}

	function frostTile(h: Here) {
		const H = frostHero(h.c)
		const ground = byNoise(fbm(h.hs + 3, h.x / 3, h.z / 3), 0.5, G.snow, G.snow2)
		// Terraces round a rounded rectangle, three levels each.
		const step = frostStep(h, H)
		if (step > 0 && h.fade > 0.05) {
			// Up the east side every terrace wall has shed a fan of snow-covered scree onto the tread below it, so legs climb from fan to fan.
			const level = frostFan(h.fade > 0.9 && h.u > 0 && step < H.n, H, h, step)
			// The frozen stream down the south face.
			if (h.fade > 0.9 && Math.abs(h.u - H.us) < 1.05 && h.v < -0.1 * H.b) {
				return wet(LIQUID.ice, level - 0.12, level - 0.5, G.snow)
			}
			return flat(level, ground, level !== h.p)
		}
		if (step > 0) return flat(h.p, ground, false)
		return frostPlain(h, H, ground) ?? shelf(mounds, h.x, h.z, -1) ?? flat(h.p, ground, false)
	}

	function lavaLandmark(h: Here, H: ReturnType<typeof lavaHero>, tier: number, ground: number) {
		const q = segDist(h.u, h.v, H.breach)
		if (lakeDistance(H.lake, h.u, h.v) + 0.25 * (fbm(h.hs + 5, h.x / 2, h.z / 2) - 0.5) < 1) {
			return {draft: wet(LIQUID.water, h.p - 0.6, h.p - 1.6), ground}
		}
		if (q.d < 0.78) {
			return {
				draft: wet(
					LIQUID.lava,
					breachSurface(tier, h.frame.plain, h.p),
					breachSurface(tier, h.frame.plain, h.p) - 0.5,
					G.crust
				),
				ground
			}
		}
		if (tier < 1) return {draft: undefined, ground: scorch(q.d, ground)}
		// Up each ring a spill of fallen columns round the cone's flank, three one-level ledges from the ring below to the ring's own tread.
		const q2 = tier - 1
		const th = H.ramp0 + q2 * 2.2
		const rm = ([8.9, 7.2, 5.5, 3.9][q2] ?? 3.9) * h.k - 0.8
		function arc(pu: number, pv: number) {
			return (((((Math.atan2(pv, pu) - th) % TAU) + TAU + Math.PI) % TAU) - Math.PI) * rm
		}
		const s = arc(h.u, h.v)
		const lo = spillBase(q2, h.frame.plain, h.p) + q2 * 3
		if (s >= 0 && s < 4.8) {
			return {
				draft: steps(
					G.tuff,
					(px, pz) => {
						const at = local(h.c, px, pz)
						return lo + (h.frame.plain + tier * 3 - lo) * clamp(arc(at.u, at.v) / 4.8, 0, 1)
					},
					h.hs + 40
				),
				ground: scorch(q.d, ground)
			}
		}
		return {draft: undefined, ground: scorch(q.d, ground)}
	}

	function poolNear(open: boolean, h: Here) {
		if (!open) return undefined
		return eachFeature(pools, h.x, h.z, f => {
			const e = Math.hypot((h.x - f.x) / f.rx, (h.z - f.z) / f.rz) + 0.35 * (fbm(f.s, h.x / 1.8, h.z / 1.8) - 0.5)
			if (e < 1) return wet(LIQUID.lava, h.p - 0.35, h.p - 0.9, G.crust)
			if (e < 1.2) return flat(h.p, G.crust, false)
			if (e < 1.6 && fbm(f.s + 1, h.x / 1.5, h.z / 1.5) < 0.6) return flat(h.p, G.cinder, false)
			return undefined
		})
	}

	// A causeway: a mound of hexagonal columns broken off at heights a level apart, highest in the middle.
	function causewayAt(h: Here) {
		return eachFeature(causeways, h.x, h.z, f => {
			const e =
				Math.hypot(
					((h.x - f.x) * f.ca + (h.z - f.z) * f.sa) / (f.top * (1.6 + 0.7 * f.e1)),
					(-(h.x - f.x) * f.sa + (h.z - f.z) * f.ca) / (f.top * (1.3 + 0.5 * f.e2))
				) +
				0.3 * (fbm(f.s, h.x / 2, h.z / 2) - 0.5)
			if (e >= 1) return undefined
			return flat(
				h.p + Number.max(1, round((1 - e) * f.top + 0.5 * (hash(f.s, Math.floor(h.x), Math.floor(h.z)) - 0.5))),
				G.tuff
			)
		})
	}

	function fissureDist(gated: boolean, x: number, z: number) {
		if (gated) return zeroDist(S.flow, 34, x, z, 0.05)
		return 9
	}

	function lavaShelf(h: Here, ground: number) {
		const raised = shelf(shelves, h.x, h.z, G.tuff)
		if (raised === undefined) return undefined
		return withGround(raised, ground)
	}

	function lavaOpen(h: Here, ground: number) {
		// Lava pools sunk in the plain, the ground round them scorched rust.
		const pool = poolNear(!h.on || Math.hypot(h.u, h.v) > 16 * h.k, h)
		if (pool !== undefined) return pool
		if (h.n.gap > 0.08) {
			// Fissures: thin cracks of lava winding across the flows, scorched at the lips.
			const fd = fissureDist(noise(S.flow + 3, h.x / 9, h.z / 9) > 0.48, h.x, h.z)
			if (fd < 0.55) return wet(LIQUID.lava, h.p - 0.35, h.p - 0.9, G.crust)
			const lip = fissureLip(fd, fbm(S.flow + 5, h.x / 1.6, h.z / 1.6), ground)
			const causeway = causewayAt(h)
			if (causeway !== undefined) return causeway
			const raised = lavaShelf(h, lip)
			if (raised !== undefined) return raised
			// A younger flow's lobe stands a level over the ground it ran across.
			if (flowAt(h.x, h.z) > 0.65) return flat(h.p + 1, lip, true)
			return flat(h.p, lip, false)
		}
		return lavaShelf(h, ground) ?? flat(h.p, ground, false)
	}

	function lavaPlain(h: Here, tier: number, ground: number) {
		if (tier === 0 && (!h.on || Math.hypot(h.u, h.v) > 13 * h.k) && h.bw < 0.3) return lavaOpen(h, ground)
		const level = terraceLevel(tier, h.frame.plain, h.fade, h.p)
		return flat(level, ground, level !== h.p)
	}

	function lavaTile(h: Here) {
		const d = Math.hypot(h.u, h.v * 1.08) / h.k + 0.9 * (fbm(h.hs + 3, h.x / 3.6, h.z / 3.6) - 0.5)
		const tier = coneTier(h.on, d)
		if (h.fade > 0.9 && d < 2.7) return wet(LIQUID.lava, h.frame.plain + 10.5, h.frame.plain + 10, G.crust)
		if (h.fade > 0.9) {
			const landmark = lavaLandmark(h, lavaHero(h.c), tier, lavaGround(h.x, h.z))
			if (landmark.draft !== undefined) return landmark.draft
			return lavaPlain(h, tier, landmark.ground)
		}
		return lavaPlain(h, tier, lavaGround(h.x, h.z))
	}

	function ruinsTile(h: Here) {
		const H = ruinsHero(h.c)
		// A hill town: four retaining walls round a rounded square, stairs straight up two sides.
		function ringAt(pu: number, pv: number, px: number, pz: number) {
			return ((pu / 1.25) ** 4 + pv ** 4) ** 0.25 + 0.5 * (fbm(h.hs + 3, px / 2.6, pz / 2.6) - 0.5) * h.k
		}
		const m = ringAt(h.u, h.v, h.x, h.z)
		const stair = Array.some(
			H.ang,
			th => h.u * Math.cos(th) + h.v * Math.sin(th) > 0 && Math.abs(-h.u * Math.sin(th) + h.v * Math.cos(th)) < 0.95
		)
		if (h.fade > 0.9 && m < H.top + 4.55 * H.ring && stair) {
			return {
				ground: G.road,
				height: (px: number, pz: number) => {
					const at = local(h.c, px, pz)
					return h.frame.plain + 3 * clamp(4 - (ringAt(at.u, at.v, px, pz) - H.top) / H.ring + 0.5, 0, 4)
				},
				kind: 'ramp'
			} satisfies Ramp
		}
		const step = ruinStep(h.on, m, H.ring, H.top)
		const level = terraceLevel(step, h.frame.plain, h.fade, h.p)
		return flat(
			level,
			ruinGround(
				hash(h.hs + 5, Math.floor(h.x / 2), Math.floor(h.z / 2)) < 0.2 && step > 0,
				fbm(h.hs + 4, h.x / 3, h.z / 3)
			),
			level !== h.p
		)
	}

	function fungalTile(h: Here) {
		const H = fungalHero(h.c)
		const m =
			((Math.abs(h.u) / H.a) ** 3 + (Math.abs(h.v) / H.b) ** 3) ** (1 / 3) +
			0.1 * (fbm(h.hs + 3, h.x / 2.2, h.z / 2.2) - 0.5)
		// The shelf fungi's cliffs are sheer, four levels and then six: a wall to build up.
		if (h.fade > 0.05 && m < 0.82) {
			return flat(
				h.frame.plain + round(byNoise(0.46, m, 10, 4) * h.fade),
				byNoise(
					fbm(h.hs + 4, h.x / 2.5, h.z / 2.5),
					0.6,
					G.lilac,
					byNoise(fbm(h.hs + 5, h.x / 3, h.z / 3), 0.5, G.mauve, G.mauve2)
				)
			)
		}
		if (h.fade > 0.9) {
			const d = segDist(h.u, h.v, H.stream).d
			if (d < 1 && h.fade > 0.97) return wet(LIQUID.water, h.p - 0.12, h.p - 0.28)
			if (d < 2.2) return flat(h.p, G.moss)
		}
		return plain(
			byNoise(
				fbm(h.hs + 6, h.x / 3, h.z / 3),
				0.55,
				G.moss,
				byNoise(fbm(h.hs + 7, h.x / 2.5, h.z / 2.5), 0.5, G.mauve, G.mauve2)
			)
		)
	}

	// The tallest of a karst cluster's towers over a point: a grassy top, a shoulder a few levels down, a mossy foot two levels up from the plain.
	function towerAt(h: Here) {
		return eachFeature(towers, h.x, h.z, f => {
			const found = Array.reduce(f.spires, {ground: G.rock, level: h.p}, (best, spire, q) => {
				const d = Math.hypot(h.x - spire.x, h.z - spire.z) / spire.r + 0.32 * (fbm(f.s + q, h.x / 1.7, h.z / 1.7) - 0.5)
				if (d < 0.66 && h.p + spire.top > best.level) return {ground: G.karstgrass, level: h.p + spire.top}
				if (d < 1 && h.p + spire.top - 4 > best.level) return {ground: G.karstmoss, level: h.p + spire.top - 4}
				if (d < 1.4 && h.p + 2 > best.level) return {ground: G.karstmoss, level: h.p + 2}
				return best
			})
			if (found.level === h.p) return undefined
			return flat(found.level, found.ground)
		})
	}

	function karstTile(h: Here) {
		if (h.fade > 0.9) {
			const H = karstHero(h.c)
			const dh = Math.hypot(h.u, h.v) + 0.55 * (fbm(h.hs + 4, h.x / 1.7, h.z / 1.7) - 0.5)
			if (dh < H.r - 0.9) return wet(LIQUID.water, h.p - 6.3, h.p - 7)
			if (dh < H.r) return flat(h.p - 3, G.rock)
			if (segDist(h.u, h.v, H.chan).d < 1) return wet(LIQUID.water, h.p - 0.4, h.p - 1)
		}
		const tower = towerAt(h)
		if (tower !== undefined) return tower
		const hole = eachFeature(holes, h.x, h.z, f => {
			const d = Math.hypot(h.x - f.x, h.z - f.z) + 0.55 * (fbm(f.s, h.x / 1.7, h.z / 1.7) - 0.5)
			if (d >= f.r) return undefined
			if (f.ledge && d > f.r - 0.7 && f.r > 2) return flat(h.p - 3, G.rock)
			if (f.pool) return wet(LIQUID.water, h.p - 6.3, h.p - 7)
			return flat(h.p - 7, G.karstmoss)
		})
		return hole ?? flat(h.p, byNoise(fbm(h.hs + 3, h.x / 2.5, h.z / 2.5), 0.5, G.karstgrass, G.pave), false)
	}

	function saltLandmark(h: Here, H: ReturnType<typeof saltHero>, ground: number) {
		const q = segDist(h.u, h.v, H.rift)
		const taper = smoothstep(0, 7, q.s) * smoothstep(0, 7, q.len - q.s)
		const n2 = 0.3 * (fbm(h.hs + 5, h.x / 2, h.z / 2) - 0.5)
		const dd =
			Math.hypot(h.u - (H.dome[0] ?? 0), h.v - (H.dome[1] ?? 0)) / (H.dome[2] ?? 1) +
			0.15 * (fbm(h.hs + 6, h.x / 2, h.z / 2) - 0.5)
		if (dd < 1) return flat(h.p + byNoise(0.55, dd, 6, 3), ground)
		if (taper <= 0.02) return undefined
		const ledge = q.side > 0 && q.s / q.len > 0.12 && q.s / q.len < 0.85
		if (q.d < riftWidth(ledge, q.side, n2)) {
			// The rift's floor, brine pooled along its deepest stretch.
			if (q.d < 1 && taper > 0.6) {
				return wet(LIQUID.brine, h.p - round(8 * taper) + 0.5, h.p - round(8 * taper) - 0.1, G.saltfloor)
			}
			return flat(h.p - round(8 * taper), G.saltfloor)
		}
		// The ledge down the north wall: the wall slumped into broken shelves a level apart.
		if (ledge && q.d < 3.6) {
			return steps(
				G.saltfloor,
				(px, pz) => {
					const at = local(h.c, px, pz)
					const qq = segDist(at.u, at.v, H.rift)
					return (
						h.p -
						8 * smoothstep(0, 7, qq.s) * smoothstep(0, 7, qq.len - qq.s) * clamp((qq.s / qq.len - 0.12) / 0.6, 0, 1)
					)
				},
				h.hs + 40
			)
		}
		if (q.side < 0 && q.d < 6.5 + n2 * 4) return flat(h.p - round(3 * taper), ground)
		return undefined
	}

	function saltTile(h: Here) {
		// The crust: polygon plates of salt a few tiles across, cracked at their edges, stained pink and ochre in drifts.
		const ground = saltCrust(h.x, h.z)
		if (h.fade > 0.9) {
			const landmark = saltLandmark(h, saltHero(h.c), ground)
			if (landmark !== undefined) return landmark
		}
		// Brine pans: shallow pools sunk a step into the crust, ringed with pink salt.
		const pan = eachFeature(pans, h.x, h.z, f => {
			const e = Math.hypot((h.x - f.x) / f.rx, (h.z - f.z) / f.rz) + 0.3 * (fbm(f.s, h.x / 1.8, h.z / 1.8) - 0.5)
			if (e < 1) return wet(LIQUID.brine, h.p - 0.55, h.p - 1.1, G.saltfloor)
			if (e < 1.35) return flat(h.p, G.saltpink)
			return undefined
		})
		// Salt tables: broad slabs four or six levels up, some with a second tier.
		const raised = pan ?? shelf(saltTables, h.x, h.z, -1)
		if (raised === undefined) return flat(h.p, ground, false)
		return withGround(raised, ground)
	}

	// Glass dunes: crescent ridges two levels high marching across one wind per region, a gentle windward climb and a sheer lee; a fulgurite crater, a fused glass bowl in a raised rim, for landmark.
	function glassTile(h: Here) {
		if (h.fade > 0.9) {
			const d = Math.hypot(h.u, h.v) / h.k + 0.8 * (fbm(h.hs + 3, h.x / 2.4, h.z / 2.4) - 0.5)
			if (d < 4.5) return flat(h.frame.plain - 3, G.glass2)
			if (d < 6.2) return flat(h.frame.plain + 2, G.glass)
			if (d < 7.6) return flat(h.frame.plain + 1, G.glasssand)
		}
		const a = flowAngle + 1.2 * (noise(S.flow + 31, h.x / 200, h.z / 200) - 0.5)
		const along = (h.x * Math.cos(a) + h.z * Math.sin(a)) / 8 + 1.1 * fbm(S.flow + 32, h.x / 14, h.z / 14)
		const crest = along - Math.floor(along)
		const dune = round((2 + flag(fbm(S.flow + 33, h.x / 22, h.z / 22) > 0.55)) * smoothstep(0.15, 0.9, crest))
		return flat(h.p + dune, glassGround(h.x, h.z), dune > 0)
	}

	// Hot springs: the landmark is a great terraced mound, the plain is dotted with small ones.
	function springsTile(h: Here) {
		if (h.fade > 0.9) {
			const hero = springRing(h, {base: h.frame.plain, rings: 6, s: h.hs + 5, w: 2.4 * h.k, x: h.c.x, z: h.c.z})
			if (hero !== undefined) return hero
		}
		return eachFeature(springs, h.x, h.z, f => springRing(h, f)) ?? plain(-1)
	}

	// Coral reef: coral heads one to three levels out of a turquoise lagoon, sand banks between; an atoll's ring for landmark.
	function coralTile(h: Here) {
		const reef = fbm(h.hs + 11, h.x / 6, h.z / 6)
		const hue = hash(h.hs + 12, Math.floor(h.x / 3), Math.floor(h.z / 3))
		const coral = byNoise(hue, 0.66, G.coralviolet, byNoise(hue, 0.33, G.coralorange, G.coralpink))
		if (h.fade > 0.9) {
			const d = Math.hypot(h.u, h.v) / h.k + 1.2 * (fbm(h.hs + 3, h.x / 3, h.z / 3) - 0.5)
			if (d < 2.4) return flat(h.frame.plain + 2, G.coralsand)
			if (d < 7) return wet(LIQUID.lagoon, h.frame.plain - 0.5, h.frame.plain - 1.4, G.lagoonbed)
			if (d < 9.5) return flat(h.frame.plain + 1 + flag(reef > 0.55), byNoise(reef, 0.5, coral, G.coralsand))
		}
		if (reef > 0.62) return flat(h.p + 1 + round((reef - 0.62) * 9), coral)
		if (fbm(S.dither + 95, h.x / 14, h.z / 14) > 0.56) return flat(h.p, G.coralsand, false)
		return wet(LIQUID.lagoon, h.p - 0.12, h.p - 0.45, G.lagoonbed)
	}

	// Crimson maze: a high plateau cut by a net of slot canyons six levels deep with a ledge halfway down; where a wall broke, rubble treads lead down.
	function canyonTile(h: Here) {
		const d = zeroDist(S.creek + 40, 26, h.x, h.z, 0.1)
		const w = 1.3 + 1.1 * noise(S.creek + 42, h.x / 11, h.z / 11)
		if (d >= w + 1.3) return flat(h.p, plainGround(CANYON, h.x, h.z), false)
		if (gapAt(h.x, h.z)) {
			return flat(h.p - round(6 * clamp(1 - (d - w * 0.4) / (w + 1.5), 0, 1)), G.canyonfloor)
		}
		if (d < w) return flat(h.p - 6, G.canyonfloor)
		return flat(h.p - 3, G.crimson2)
	}

	// Prism fields: hexagonal crystal columns standing out of pale frost-blue ground; the landmark is one great cluster.
	function prismTile(h: Here) {
		if (h.fade > 0.9) {
			const d = hexDistance(h.u, h.v, 0) / h.k + 0.3 * (fbm(h.hs + 3, h.x / 2, h.z / 2) - 0.5)
			if (d < 2.6) return flat(h.frame.plain + 18, G.prismlilac)
			if (d < 4.2) return flat(h.frame.plain + 11, G.prism)
			if (d < 5.8) return flat(h.frame.plain + 5, G.prism2)
		}
		const column = eachFeature(crystals, h.x, h.z, f => {
			const top = Array.reduce(f.columns, 0, (best, spar) => {
				if (hexDistance(h.x - spar.x, h.z - spar.z, f.turn) / spar.r < 0.87) return Number.max(best, spar.top)
				return best
			})
			if (top === 0) return undefined
			return flat(h.p + top, byNoise(hash(f.x, top, 3), 0.5, G.prismlilac, G.prism))
		})
		return column ?? plain(-1)
	}

	// Tundra: ice-wedge polygons, plates a few tiles across with frozen seams a quarter level down, thaw ponds in the hollows; a pingo, an ice-cored hill with a pond in its top, for landmark.
	function tundraTile(h: Here) {
		if (h.fade > 0.9) {
			const d = Math.hypot(h.u, h.v) / h.k + 0.6 * (fbm(h.hs + 3, h.x / 2.5, h.z / 2.5) - 0.5)
			if (d < 1.6) return wet(LIQUID.water, h.frame.plain + 5.6, h.frame.plain + 5, G.trough)
			if (d < 8) return flat(h.frame.plain + round(7 * (1 - d / 8) + 0.6), byNoise(d, 5, G.tundra, G.frostmoss))
		}
		if (fbm(h.hs + 9, h.x / 10, h.z / 10) > 0.7) return wet(LIQUID.water, h.p - 0.2, h.p - 0.8, G.trough)
		const gx = Math.floor(h.x / 7)
		const gz = Math.floor(h.z / 7)
		const seam = Array.reduce(OFFSETS, {d1: 9, d2: 9, id: 0}, (acc, o) => {
			const d = Math.hypot(
				h.x - (gx + o.x + hash(S.dither + 97, gx + o.x, gz + o.z)) * 7,
				h.z - (gz + o.z + hash(S.dither + 98, gx + o.x, gz + o.z)) * 7
			)
			if (d < acc.d1) return {d1: d, d2: acc.d1, id: hash(S.dither + 99, gx + o.x, gz + o.z)}
			if (d < acc.d2) return {...acc, d2: d}
			return acc
		})
		if (seam.d2 - seam.d1 < 0.7) return flat(h.p, G.trough, false)
		// A plate heaved a level up by the ice under it, here and there.
		return flat(h.p + flag(seam.id > 0.82), plainGround(TUNDRA, h.x, h.z), false)
	}

	// Autumn highlands: rolling maple hills, with the high meadow's cliff, river and lake for landmark.
	function autumnTile(h: Here) {
		if (h.fade > 0.9) {
			const hero = meadowLandmark(h)
			if (hero !== undefined) return withGround(hero, plainGround(AUTUMN, h.x, h.z))
		}
		return plain(-1)
	}

	// The strange half of the climate map's biomes, from glass on.
	function strangeTile(h: Here) {
		if (h.b === GLASS) return glassTile(h)
		if (h.b === SPRINGS) return springsTile(h)
		if (h.b === PADDIES) return paddiesTile(h)
		if (h.b === CORAL) return coralTile(h)
		if (h.b === CANYON) return canyonTile(h)
		if (h.b === PRISM) return prismTile(h)
		if (h.b === TUNDRA) return tundraTile(h)
		return autumnTile(h)
	}

	function biomeTile(h: Here) {
		if (h.b >= GLASS) return strangeTile(h)
		if (h.b === MEADOW) return meadowTile(h)
		if (h.b === MARSH) return marshTile(h)
		if (h.b === MESA) return mesaTile(h)
		if (h.b === FROST) return frostTile(h)
		if (h.b === LAVA) return lavaTile(h)
		if (h.b === RUINS) return ruinsTile(h)
		if (h.b === FUNGAL) return fungalTile(h)
		if (h.b === KARST) return karstTile(h)
		return saltTile(h)
	}

	function smoothLevel(t: Smooth, h: Here) {
		if (t.height !== undefined) return round(t.height(h.x, h.z, h.s0))
		if (t.offset !== 0) return round(h.s0 + t.offset)
		return h.p
	}

	// Every surface but a ruin's stair settles flat on the level under its centre.
	function fin(t: Draft, h: Here) {
		if (t.kind === 'ramp') {
			return {
				biome: h.b,
				feature: true,
				gap: h.n.gap,
				ground: t.ground,
				height: t.height,
				// A stair has no one level; its height function shapes it.
				level: Infinity,
				liquid: LIQUID.none,
				ramp: true,
				surface: 0
			} satisfies Tile
		}
		if (t.kind === 'flat') {
			return {
				biome: h.b,
				feature: t.feature,
				gap: h.n.gap,
				ground: t.ground,
				level: t.level,
				liquid: t.liquid,
				ramp: false,
				surface: t.surface
			} satisfies Tile
		}
		return {
			biome: h.b,
			feature: t.feature,
			gap: h.n.gap,
			ground: t.ground,
			level: smoothLevel(t, h),
			liquid: LIQUID.none,
			ramp: false,
			surface: 0
		} satisfies Tile
	}

	// The tile at a centre (x, z): its dominant cell decides.
	function tileAt(x: number, z: number) {
		const n = near(x, z)
		const s0 = blendS(x, z)
		const F = frame(n.dom)
		const at = local(n.dom, x, z)
		const h = {
			b: n.dom.biome,
			bw: basinW(x, z),
			c: n.dom,
			fade: fadeOf(F.on, n.gap),
			frame: F,
			hs: n.dom.hs,
			k: F.k,
			n,
			on: F.on,
			p: plainLv(n.dom.biome, x, z, s0),
			s0,
			u: at.u,
			v: at.v,
			x,
			z
		}
		// The start basin's floor: whatever the biome, open ground at the floor's level (meadow keeps its tables and ponds).
		if (h.bw > 0.5 && h.b === LAVA) return fin(flat(h.p, lavaGround(x, z), false), h)
		if (h.bw > 0.5 && h.b !== MEADOW) return fin(plain(-1), h)
		return fin(river(biomeTile(h), h), h)
	}

	function driftGround(t: Tile, gx: number, gz: number) {
		const x = gx + 0.5
		const z = gz + 0.5
		if (t.liquid !== LIQUID.none || t.ground === G.road || t.ground === G.snowroad || t.gap >= 0.5) return t.ground
		const w = colourWeights(x, z)
		const pick = Array.reduce(
			BIOME_SHAPE,
			{b: t.biome, done: false, u: noise(S.dither + 3, x / 1.3, z / 1.3) * 0.55 + hash(S.dither, gx, gz) * 0.45},
			(acc, _, b) => {
				if (acc.done) return acc
				if (acc.u < (w[b] ?? 0)) return {b, done: true, u: acc.u}
				return {...acc, u: acc.u - (w[b] ?? 0)}
			}
		)
		if (pick.b !== t.biome) return plainGround(pick.b, x, z)
		return t.ground
	}

	function tileProp(b: number, g: number, r: Pick, gx: number, gz: number) {
		const p = r(3)
		const s = r(5)
		if (b === MEADOW) {
			return groveProp(p, s, {
				lone: 0.975,
				rock: 0.985,
				tree: 'tree',
				trees: byNoise(fbm(S.prop + 1, gx / 14, gz / 14), 0.62, 0.32, 0.025)
			})
		}
		if (b === FROST) {
			return groveProp(p, s, {
				lone: 1,
				rock: 0.99,
				tree: 'pine',
				trees: byNoise(fbm(S.prop + 2, gx / 12, gz / 12), 0.6, 0.22, 0.03)
			})
		}
		if (b === LAVA) return lavaProp(g, p, s)
		if (b === FUNGAL && p < 0.035) {
			return {glow: r(7) < 0.3, hue: Math.floor(r(6) * 3), kind: 'cap', s: 1.1 + 2.3 * s * s}
		}
		if (b === AUTUMN) {
			return groveProp(p, s, {
				lone: 0.975,
				rock: 0.985,
				tree: 'maple',
				trees: byNoise(fbm(S.prop + 3, gx / 12, gz / 12), 0.5, 0.42, 0.05)
			})
		}
		if (b === PADDIES && p < byNoise(fbm(S.prop + 4, gx / 9, gz / 9), 0.6, 0.35, 0.01)) {
			return {kind: 'bamboo', s: 0.8 + 0.5 * s}
		}
		if (b === CORAL && g !== G.coralsand && p < 0.3) return {hue: Math.floor(r(6) * 3), kind: 'coral', s: 0.7 + 0.6 * s}
		if (b === PRISM && p < 0.03) return {hue: Math.floor(r(6) * 3), kind: 'crystal', s: 0.6 + 0.8 * s}
		return Option.getOrUndefined(
			Option.map(
				Array.findFirst(SPARSE, row => row.biome === b && p < row.below),
				row => ({kind: row.kind, s: row.base + row.spread * s})
			)
		)
	}

	function tileCached(x: number, z: number) {
		return tiles(pack(Math.floor(x), Math.floor(z)), () => tileAt(Math.floor(x) + 0.5, Math.floor(z) + 0.5))
	}

	function ruinHouse(gx: number, gz: number, ring: Tile[], ore: Uint8Array) {
		function r(k: number) {
			return hash(S.prop + 900 + k * 613, gx, gz)
		}
		const x0 = Math.floor(gx / CHUNK) * CHUNK
		const z0 = Math.floor(gz / CHUNK) * CHUNK
		const wd = 1.3 + 1.4 * r(1)
		const dp = 1.2 + 0.6 * r(2)
		const x = gx + 0.6 + (3.4 - wd) * r(3) * 0.8 + wd / 2
		const z = gz + 0.6 + (3.4 - dp) * r(4) * 0.8 + dp / 2
		const ti = Math.floor(x - x0)
		const tj = Math.floor(z - z0)
		if (tj >= CHUNK || ti >= CHUNK) return undefined
		const t = ring[(tj + 1) * RING + ti + 1]
		// None on the start basin's floor near the base, which stays open for building.
		if (t === undefined || t.biome !== RUINS || ore[tj * CHUNK + ti] !== 0 || Math.hypot(x - SP.x, z - SP.z) < 34) {
			return undefined
		}
		if (r(5) > 0.85 || (!t.feature && r(5) > 0.22)) return undefined
		const even = Array.every(
			[
				{x: x - wd / 2 - 0.15, z: z - dp / 2 - 0.15},
				{x: x + wd / 2 + 0.15, z: z - dp / 2 - 0.15},
				{x: x - wd / 2 - 0.15, z: z + dp / 2 + 0.15},
				{x: x + wd / 2 + 0.15, z: z + dp / 2 + 0.15},
				{x, z}
			],
			at => {
				const q = tileCached(at.x, at.z)
				return !q.ramp && q.liquid === LIQUID.none && q.level === t.level && q.biome === RUINS
			}
		)
		if (!even) return undefined
		return {
			dp,
			ht: 0.9 + 1.6 * r(6) * r(6) + houseLift(t.feature),
			kind: 'ruin',
			s: 1,
			seed: Math.floor(r(7) * 1000),
			wd,
			x,
			yaw: 0,
			z
		}
	}

	// A geyser on the vent of every hot spring in a chunk, the landmarks' great mounds included.
	function vents(cx: number, cz: number) {
		const x0 = cx * CHUNK
		const z0 = cz * CHUNK
		const small = Array.flatMap(
			Array.flatMap(Array.range(Math.floor(z0 / 19) - 1, Math.floor((z0 + CHUNK) / 19) + 1), gz =>
				Array.map(Array.range(Math.floor(x0 / 19) - 1, Math.floor((x0 + CHUNK) / 19) + 1), gx => ({gx, gz}))
			),
			slot => Option.toArray(springs.feature(slot.gx, slot.gz))
		)
		return Array.flatMap(
			[...small, ...Array.filter(near(x0 + CHUNK / 2, z0 + CHUNK / 2).block, c => c.biome === SPRINGS && frame(c).on)],
			(at: {x: number; z: number}, n) => {
				if (!inChunk(at.x, at.z, x0, z0)) return []
				const t = tileCached(at.x, at.z)
				if (t.biome !== SPRINGS || t.liquid !== LIQUID.none || t.ramp) return []
				return [
					{
						id: ((cx * 92_821) ^ (cz * 68_917)) * 1024 + 2000 + n,
						kind: 'geyser',
						s: 1,
						x: Math.floor(at.x) + 0.5,
						yaw: 0,
						z: Math.floor(at.z) + 0.5
					} satisfies Prop
				]
			}
		)
	}

	// Ore fields: one candidate per slot of a world grid, grown over the tiles round its best site; slots own the tiles nearest their jittered point, so fields never overlap.
	function slotPt(gx: number, gz: number) {
		return {x: (gx + 0.25 + 0.5 * hash(S.ore + 1, gx, gz)) * FS, z: (gz + 0.25 + 0.5 * hash(S.ore + 2, gx, gz)) * FS}
	}

	function slotOf(x: number, z: number) {
		const gx = Math.floor(x / FS)
		const gz = Math.floor(z / FS)
		return Array.reduce(OFFSETS, {best: 1e9, key: 0}, (acc, o) => {
			const at = slotPt(gx + o.x, gz + o.z)
			const d = (x - at.x) ** 2 + (z - at.z) ** 2
			if (d < acc.best) return {best: d, key: slotKey(gx + o.x, gz + o.z)}
			return acc
		}).key
	}

	function dry(t: Tile) {
		return !t.ramp && t.liquid === LIQUID.none
	}

	// The foot of a cliff: a tile two levels or more under one within two tiles of it.
	function cliffBy(x: number, z: number, level: number) {
		return Array.some([...NEIGHBOURS, ...Array.map(NEIGHBOURS, o => ({x: 2 * o.x, z: 2 * o.z}))], o => {
			const t = tileCached(x + o.x, z + o.z)
			return dry(t) && t.level >= level + 2
		})
	}

	function siteScore(site: Site, level: number, x: number, z: number) {
		if (site === 'high') return level
		if (site === 'low') return -level
		if (site === 'wet') {
			return (
				3 * Array.length(Array.filter(NEIGHBOURS, o => tileCached(x + 2 * o.x, z + 2 * o.z).liquid !== LIQUID.none))
			)
		}
		if (site === 'cliff' && cliffBy(x, z, level)) return 5
		return 0
	}

	// Tops stay on the top, hollows in the hollow, the start's on the basin floor, the rest spread over a step either way like a stratum.
	function siteFits(site: Site, level: number, anchor: number, step: number, x: number, z: number) {
		if (site === 'high') return level >= anchor
		if (site === 'low') return level <= anchor
		if (site === 'cliff') return level === anchor && cliffBy(x, z, level)
		if (site === 'start') return level === startLevel
		return Math.abs(level - anchor) <= step
	}

	function growFrom(o: Growth, anchor: {level: number; x: number; z: number}) {
		const shape = fieldShape(o.site)
		const target = round(
			clamp(mix(9, 50, rarity(o.abundance)) * (0.75 + 0.5 * o.r(3)) * (0.85 + 0.3 * o.rich), FMIN, FMAX)
		)
		const grade = gradeOf(o.abundance) * (0.8 + 0.4 * o.r(4)) * (0.75 + 0.5 * o.rich)
		// The shape: a noisy ellipse round the site, a long band where it follows a cliff's foot.
		const e = 1 + shape.stretch * o.r(6)
		const th = o.r(7) * Math.PI
		const fs = (o.r(8) * MILLION) | 0
		const radius = Math.sqrt(target / (Math.PI * 0.7)) * shape.band
		function mAt(x: number, z: number) {
			const dx = x - anchor.x
			const dz = z - anchor.z
			return (
				1 -
				Math.hypot(
					(dx * Math.cos(th) + dz * Math.sin(th)) / (radius * Math.sqrt(e)),
					(-dx * Math.sin(th) + dz * Math.cos(th)) / (radius / Math.sqrt(e))
				) +
				0.45 * (fbm(fs, x / 3.2, z / 3.2) - 0.5)
			)
		}
		// Which tiles may hold it: dry, its own, near its point, and on the site's ground.
		function fits(x: number, z: number) {
			if (Math.abs(x - o.px) > FR || Math.abs(z - o.pz) > FR || !o.own(x, z)) return false
			const t = tileCached(x, z)
			return dry(t) && siteFits(o.site, t.level, anchor.level, BIOME_SHAPE[o.b]?.step ?? 1, x, z)
		}
		// Grown from the site, richest tile first, so the field is one patch of the size its material asks for.
		const seen = MutableHashSet.make(anchor.x * 65_536 + anchor.z)
		const state = {
			open: [{m: mAt(anchor.x, anchor.z) + 1, x: anchor.x, z: anchor.z}],
			taken: MutableList.make<{m: number; x: number; z: number}>()
		}
		Array.forEach(Array.range(1, FMAX * 8), () => {
			if (!Array.isReadonlyArrayNonEmpty(state.open) || state.taken.length >= target) return
			const bi = Array.reduce(state.open, 0, (kept, entry, index) => {
				if (entry.m > (state.open[kept]?.m ?? -1e9)) return index
				return kept
			})
			const next = state.open[bi] ?? {m: 0, x: 0, z: 0}
			// The taken entry's place goes to the last one, so the open list keeps a stable order.
			const tail = Array.lastNonEmpty(state.open)
			const grown = Array.flatMap(NEIGHBOURS, step => {
				const nx = next.x + step.x
				const nz = next.z + step.z
				if (MutableHashSet.has(seen, nx * 65_536 + nz)) return []
				MutableHashSet.add(seen, nx * 65_536 + nz)
				if (mAt(nx, nz) > 0 && fits(nx, nz)) return [{m: mAt(nx, nz), x: nx, z: nz}]
				return []
			})
			state.open = Array.appendAll(
				Array.dropRight(
					Array.appendAll(Array.append(Array.take(state.open, bi), tail), Array.drop(state.open, bi + 1)),
					1
				),
				grown
			)
			MutableList.append(state.taken, {m: Number.min(next.m, 1), x: next.x, z: next.z})
		})
		const taken = MutableList.toArray(state.taken)
		if (taken.length < FMIN) return Option.none<Field>()
		// Each tile's amount: rich in the middle, lean at the rim.
		const xs = Int32Array.from(taken, tile => Math.floor(tile.x))
		const zs = Int32Array.from(taken, tile => Math.floor(tile.z))
		const amts = Uint16Array.from(taken, tile =>
			Number.max(
				1,
				round(
					grade *
						(0.3 + 0.7 * clamp(tile.m / 0.55, 0, 1)) *
						(0.8 + 0.4 * hash(fs, Math.floor(tile.x), Math.floor(tile.z)))
				)
			)
		)
		return Option.some({
			amts,
			biome: Biome.literals[o.b] ?? 'meadow',
			id: o.key,
			material: o.material,
			ore: Option.match(
				Array.findFirstIndex(Material.literals, name => name === o.material),
				{onNone: () => 0, onSome: index => index + 1}
			),
			site: o.site,
			tiles: taken.length,
			total: Number.sumAll(amts),
			x: Math.floor(anchor.x),
			x0: Array.reduce(xs, 1e9, (low, v) => Number.min(low, v)),
			x1: Array.reduce(xs, -1e9, (high, v) => Number.max(high, v)),
			xs,
			z: Math.floor(anchor.z),
			z0: Array.reduce(zs, 1e9, (low, v) => Number.min(low, v)),
			z1: Array.reduce(zs, -1e9, (high, v) => Number.max(high, v)),
			zs
		} satisfies Field)
	}

	function grow(o: Growth) {
		const search = fieldShape(o.site).search
		// The site: the best of eight tiles round the slot's point by what the material asks for.
		return Option.flatMap(
			Array.reduce(
				Array.range(0, 7),
				Option.none<{level: number; score: number; x: number; z: number}>(),
				(best, q) => {
					const x = Math.floor(o.px + (o.r(20 + q) - 0.5) * search) + 0.5
					const z = Math.floor(o.pz + (o.r(40 + q) - 0.5) * search) + 0.5
					if (!o.own(x, z)) return best
					const t = tileCached(x, z)
					if (!dry(t) || (o.site === 'start' && t.level !== startLevel)) return best
					const candidate = {
						level: t.level,
						score: -Math.hypot(x - o.px, z - o.pz) * 0.1 + siteScore(o.site, t.level, x, z),
						x,
						z
					}
					return Option.match(best, {
						onNone: () => Option.some(candidate),
						onSome: kept => {
							if (candidate.score > kept.score) return Option.some(candidate)
							return best
						}
					})
				}
			),
			anchor => growFrom(o, anchor)
		)
	}

	function startField(i: number) {
		const at = startPt(i)
		return Option.flatMap(Array.get(START, i), entry =>
			grow({
				...entry,
				b: MEADOW,
				key: slotKey(START_GX, i),
				own: (x, z) => {
					if (Math.hypot(x - SP.x, z - SP.z) < 8) return false
					return Array.every(START, (_, q) => {
						const other = startPt(q)
						return q === i || Math.hypot(x - other.x, z - other.z) >= Math.hypot(x - at.x, z - at.z)
					})
				},
				px: at.x,
				pz: at.z,
				r: k => hash(S.ore + 600 + k * 7919, i, 5),
				rich: 0.8,
				site: 'start'
			})
		)
	}

	function growField(gx: number, gz: number) {
		if (gx === START_GX) return startField(gz)
		function r(k: number) {
			return hash(S.ore + 10 + k * 7919, gx, gz)
		}
		const at = slotPt(gx, gz)
		// Ordinary fields keep out of the start basin's floor, which holds its own; the region's richness makes some land thick with fields, some sparse, nowhere bare for long.
		const rich = noise(S.ore + 3, at.x / 170, at.z / 170)
		if (Math.hypot(at.x - SP.x, at.z - SP.z) < 46 || r(1) > 0.3 + 0.62 * rich) return Option.none<Field>()
		const b = near(at.x, at.z).dom.biome
		const list = DEPOSITS[b] ?? []
		const pick = Array.reduce(
			list,
			{
				chosen: Array.last(list),
				left: r(2) * Number.sumAll(Array.map(list, d => Math.sqrt(d.abundance))),
				picked: false
			},
			(acc, d) => {
				if (acc.picked) return acc
				if (acc.left - Math.sqrt(d.abundance) <= 0) return {chosen: Option.some(d), left: 0, picked: true}
				return {...acc, left: acc.left - Math.sqrt(d.abundance)}
			}
		)
		return Option.flatMap(pick.chosen, d =>
			grow({
				...d,
				b,
				key: slotKey(gx, gz),
				own: (x, z) => slotOf(x, z) === slotKey(gx, gz),
				px: at.x,
				pz: at.z,
				r,
				rich,
				site: siteOf(d.site, r(5))
			})
		)
	}

	function oreField(gx: number, gz: number) {
		return fields(pack(gx, gz), () => growField(gx, gz))
	}

	// The fields with tiles in a chunk, and each of its tiles' ore, amount and field (an index into the list plus one).
	function chunkOre(cx: number, cz: number) {
		const x0 = cx * CHUNK
		const z0 = cz * CHUNK
		const ore = new Uint8Array(CHUNK_TILES)
		const amount = new Uint16Array(CHUNK_TILES)
		const field = new Uint8Array(CHUNK_TILES)
		const records = Array.flatMap(
			[
				...Array.flatMap(Array.range(Math.floor((z0 - FR - FS) / FS), Math.floor((z0 + CHUNK + FR) / FS)), gz =>
					Array.map(Array.range(Math.floor((x0 - FR - FS) / FS), Math.floor((x0 + CHUNK + FR) / FS)), gx => ({
						at: slotPt(gx, gz),
						gx,
						gz
					}))
				),
				...Array.map(START, (_, i) => ({at: startPt(i), gx: START_GX, gz: i}))
			],
			slot => {
				if (
					slot.at.x < x0 - FR - 1 ||
					slot.at.x > x0 + CHUNK + FR ||
					slot.at.z < z0 - FR - 1 ||
					slot.at.z > z0 + CHUNK + FR
				) {
					return []
				}
				return Option.match(oreField(slot.gx, slot.gz), {
					onNone: () => [],
					onSome: f => {
						if (f.x1 < x0 || f.x0 >= x0 + CHUNK || f.z1 < z0 || f.z0 >= z0 + CHUNK) return []
						if (!Array.some(Array.range(0, f.tiles - 1), i => inChunk(f.xs[i] ?? 0, f.zs[i] ?? 0, x0, z0))) return []
						return [f]
					}
				})
			}
		)
		Array.forEach(records, (f, index) => {
			Array.forEach(Array.range(0, f.tiles - 1), i => {
				const tx = f.xs[i] ?? 0
				const tz = f.zs[i] ?? 0
				if (!inChunk(tx, tz, x0, z0)) return
				ore[(tz - z0) * CHUNK + tx - x0] = f.ore
				amount[(tz - z0) * CHUNK + tx - x0] = f.amts[i] ?? 0
				field[(tz - z0) * CHUNK + tx - x0] = index + 1
			})
		})
		return {amount, field, fields: records, ore}
	}

	// The ground: the dominant biome's own, or, near a border, a neighbour's in drifts by jittered weight; a sloped stair tile is worn like a road.
	function groundOf(t: Tile, gx: number, gz: number, c4: Float32Array) {
		if (t.ramp && t.liquid === LIQUID.none && spread(c4) > 0.05) return wornGround(t.biome)
		const drifted = driftGround(t, gx, gz)
		if (drifted < 0) return plainGround(t.biome, gx + 0.5, gz + 0.5)
		return drifted
	}

	// Props per tile, by the biome of the tile's ground, so species change across a border with the colours; ore tiles stay clear so a field reads by its own outcrops.
	function chunkProps(
		cx: number,
		cz: number,
		ring: Tile[],
		corners: Float32Array,
		ground: Uint8Array,
		ore: Uint8Array
	) {
		const x0 = cx * CHUNK
		const z0 = cz * CHUNK
		const idBase = ((cx * 92_821) ^ (cz * 68_917)) * 1024
		const props = MutableList.make<Prop>()
		Array.forEach(Array.range(0, CHUNK_TILES - 1), o => {
			const t = ring[(Math.floor(o / CHUNK) + 1) * RING + (o % CHUNK) + 1]
			const g = ground[o] ?? 0
			if (
				t === undefined ||
				t.liquid !== LIQUID.none ||
				ore[o] !== 0 ||
				spread(corners.subarray(o * 4, o * 4 + 4)) >= 0.6 ||
				t.ramp ||
				g === G.road ||
				g === G.snowroad
			) {
				return
			}
			const gx = x0 + (o % CHUNK)
			const gz = z0 + Math.floor(o / CHUNK)
			function r(k: number) {
				return hash(S.prop + k * 6151, gx, gz)
			}
			const prop = tileProp(byNoise(GROUND_BIOME[g] ?? -1, -0.5, GROUND_BIOME[g] ?? -1, t.biome), g, r, gx, gz)
			if (prop !== undefined) {
				MutableList.append(props, {
					...prop,
					id: idBase + o,
					x: gx + 0.2 + 0.6 * r(1),
					yaw: r(4) * TAU,
					z: gz + 0.2 + 0.6 * r(2)
				})
			}
		})
		// The ruins' houses: one lot per 4 × 4 tiles where the ground under the whole house is one level.
		Array.forEach(Array.range(0, 63), lot => {
			const house = ruinHouse(x0 + (lot % 8) * 4, z0 + Math.floor(lot / 8) * 4, ring, ore)
			if (house !== undefined) MutableList.append(props, {...house, id: idBase + 1000 + lot})
		})
		Array.forEach(vents(cx, cz), vent => MutableList.append(props, vent))
		return MutableList.toArray(props)
	}

	function chunk(cx: number, cz: number) {
		const x0 = cx * CHUNK
		const z0 = cz * CHUNK
		// The base at a lattice point from one tile outside the chunk to one past it, only where a stair asks for it.
		const lattice = Float32Array.from(Array.makeBy(LAT * LAT, () => Infinity))
		function baseAt(i: number, j: number) {
			if ((lattice[j * LAT + i] ?? Infinity) === Infinity) lattice[j * LAT + i] = blendS(x0 - 1 + i, z0 - 1 + j)
			return lattice[j * LAT + i] ?? 0
		}
		const ring = Array.makeBy(RING * RING, q => tileAt(x0 - 1 + (q % RING) + 0.5, z0 - 1 + Math.floor(q / RING) + 0.5))
		const raw = new Float32Array(RING * RING * 4)
		Array.forEach(ring, (t, q) => {
			Array.forEach(CORNERS, corner => {
				const i = (q % RING) + (corner & 1)
				const j = Math.floor(q / RING) + (corner >> 1)
				raw[q * 4 + corner] = cornerHeight(t, x0 - 1 + i, z0 - 1 + j, () => baseAt(i, j))
			})
		})
		const corners = new Float32Array(CHUNK_TILES * 4)
		const ground = new Uint8Array(CHUNK_TILES)
		const liquid = new Uint8Array(CHUNK_TILES)
		const surface = new Float32Array(CHUNK_TILES)
		const biome = new Uint8Array(CHUNK_TILES)
		const vals = new Float64Array(4)
		const ramps = new Uint8Array(4)
		const group = new Uint8Array(4)
		const span = {high: 0, low: 0}
		// A stair corner meets the tiles round its lattice point that lie within 0.3 of a level of it, taking a flat tile's level when one is among them.
		function snapped(gi: number, gj: number, own: number) {
			Array.forEach(CORNERS, n => {
				const q = (gj - 1 + (n >> 1)) * RING + gi - 1 + (n & 1)
				vals[n] = raw[q * 4 + 3 - n] ?? 0
				ramps[n] = flag(ring[q]?.ramp === true)
				group[n] = flag(n === own)
			})
			const mine = vals[own] ?? 0
			if (ramps[own] === 0) return mine
			span.low = mine
			span.high = mine
			Array.forEach(CORNERS, () => {
				Array.forEach(CORNERS, n => {
					const value = vals[n] ?? 0
					if (group[n] === 0 && value > span.low - 0.3 && value < span.high + 0.3) {
						group[n] = 1
						span.low = Number.min(span.low, value)
						span.high = Number.max(span.high, value)
					}
				})
			})
			const members = Array.filter(CORNERS, n => group[n] === 1)
			const flats = Array.filter(members, n => ramps[n] === 0)
			if (Array.isReadonlyArrayNonEmpty(flats)) {
				return Array.reduce(flats, vals[flats[0]] ?? 0, (best, n) => {
					if (Math.abs((vals[n] ?? 0) - mine) < Math.abs(best - mine)) return vals[n] ?? 0
					return best
				})
			}
			return Number.sumAll(Array.map(members, n => vals[n] ?? 0)) / members.length
		}
		Array.forEach(Array.range(0, CHUNK_TILES - 1), o => {
			const i = o % CHUNK
			const j = Math.floor(o / CHUNK)
			const t = ring[(j + 1) * RING + i + 1] ?? tileAt(x0 + i + 0.5, z0 + j + 0.5)
			Array.forEach(CORNERS, corner => {
				corners[o * 4 + corner] = cornerOf(t, () => snapped(i + 1 + (corner & 1), j + 1 + (corner >> 1), 3 - corner))
			})
			liquid[o] = t.liquid
			surface[o] = liquidSurface(t)
			biome[o] = t.biome
			ground[o] = groundOf(t, x0 + i, z0 + j, corners.subarray(o * 4, o * 4 + 4))
		})
		const ore = chunkOre(cx, cz)
		return {
			biome,
			corners,
			cx,
			cz,
			ground,
			liquid,
			...ore,
			props: chunkProps(cx, cz, ring, corners, ground, ore.ore),
			surface
		}
	}

	return {
		chunk,
		// A field's whole record with its tiles, by id (CORE names a field by it).
		field: (id: number) => oreField(((id >>> 16) << 16) >> 16, ((id & 0xff_ff) << 16) >> 16),
		// Where the base stands and the start fields round it.
		spawn: () => ({
			fields: Array.map(START, (_, i) => slotKey(START_GX, i)),
			level: startLevel,
			radius: RB,
			x: Math.floor(SP.x),
			z: Math.floor(SP.z)
		}),
		tileAt
	}
}
