import {Schema} from 'effect'

export type Biome = typeof Biome.Type
export const Biome = Schema.Literals([
	'meadow',
	'marsh',
	'mesa',
	'frost',
	'lava',
	'ruins',
	'fungal',
	'karst',
	'salt',
	'glass',
	'springs',
	'paddies',
	'coral',
	'canyon',
	'prism',
	'tundra',
	'autumn'
])

// Every material the world holds, in ore id order: ore id 0 is bare ground, id n is the nth material here.
export type Material = typeof Material.Type
export const Material = Schema.Literals([
	'iron',
	'copper',
	'stone',
	'coal',
	'peat',
	'sulfur',
	'bauxite',
	'quartz',
	'crystal',
	'cobalt',
	'tungsten',
	'lumen'
])

// Where a material's fields sit: high on tops, low in hollows, wet by water, anywhere on the plain, along a cliff's foot, or on the start basin's floor.
export type Site = typeof Site.Type
export const Site = Schema.Literals(['any', 'cliff', 'high', 'low', 'start', 'wet'])

// What units build on one tile: a road paves it, a ramp sets its four corner heights in levels (in chunk corner order) so wheels climb a step, a bridge lays a deck over liquid at a level.
export type Edit = typeof Edit.Type
export const Edit = Schema.TaggedUnion({
	Bridge: {level: Schema.Finite},
	Ramp: {corners: Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite])},
	Road: {}
})

// One tile's change for the client: its edit, or the ore left on it.
export type TileChange = typeof TileChange.Type
export const TileChange = Schema.Struct({
	amount: Schema.optional(Schema.Finite),
	edit: Schema.optional(Edit),
	x: Schema.Int,
	z: Schema.Int
})
