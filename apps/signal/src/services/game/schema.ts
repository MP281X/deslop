import {Schema} from 'effect'

import {Edit, TileChange} from '#services/world/schema.ts'

// Signal's production tree is named by these ids, its tables in the game's utils. Ids are plain English so a model can name each from text.

// Every item in tree order: raw from the world, fluids in pipes, then made from them.
export type ItemId = typeof ItemId.Type
export const ItemId = Schema.Literals([
	'wood',
	'stone',
	'iron_ore',
	'copper_ore',
	'coal',
	'peat',
	'sulfur',
	'quartz',
	'cobalt',
	'crystal',
	'tungsten',
	'bauxite',
	'lumen',
	'water',
	'fuel',
	'acid',
	'iron_ingot',
	'copper_ingot',
	'iron_plate',
	'iron_rod',
	'wire',
	'concrete',
	'frame',
	'steel_ingot',
	'steel_beam',
	'steel_pipe',
	'motor',
	'circuit',
	'plastic',
	'silicon',
	'alumina',
	'aluminium_ingot',
	'aluminium_sheet',
	'battery',
	'computer',
	'lens',
	'tungsten_carbide',
	'heavy_frame',
	'lumen_cell',
	'signal_core'
])

// The milestones in order: tiers are paid at Home, phases at the Beacon. After the last, Signal cycles repeat forever.
export type GateId = typeof GateId.Type
export const GateId = Schema.Literals([
	't0',
	't1',
	't2',
	'p1',
	't3',
	't4',
	'p2',
	't5',
	't6',
	'p3',
	't7',
	't8',
	'p4',
	't9'
])

// Four unit classes, three marks each.
export type UnitClass = typeof UnitClass.Type
export const UnitClass = Schema.Literals(['builder', 'hauler', 'scout', 'guard'])

export type BuildingKind = typeof BuildingKind.Type
export const BuildingKind = Schema.Literals([
	'home',
	'beacon',
	'crate_mk1',
	'crate_mk2',
	'crate_mk3',
	'miner_mk1',
	'miner_mk2',
	'miner_mk3',
	'furnace',
	'smelter',
	'fabricator',
	'assembler',
	'foundry',
	'refinery',
	'manufacturer',
	'pump',
	'burner_generator',
	'steam_generator',
	'core_generator'
])

export type StructureKind = typeof StructureKind.Type
export const StructureKind = Schema.Literals([
	'road',
	'ramp',
	'bridge',
	'pole',
	'belt_mk1',
	'splitter',
	'merger',
	'junction',
	'pipe',
	'belt_mk2',
	'lift',
	'pylon',
	'belt_mk3'
])

export type RecipeId = typeof RecipeId.Type
export const RecipeId = Schema.Literals([
	'bench_iron_plate',
	'bench_iron_rod',
	'bench_wire',
	'furnace_iron_wood',
	'furnace_iron_coal',
	'furnace_copper_wood',
	'furnace_copper_coal',
	'smelt_iron',
	'smelt_copper',
	'fab_iron_plate',
	'fab_iron_rod',
	'fab_wire',
	'fab_concrete',
	'fab_steel_beam',
	'fab_steel_pipe',
	'fab_aluminium_sheet',
	'fab_lens',
	'asm_frame',
	'asm_motor',
	'asm_circuit',
	'foundry_steel',
	'foundry_silicon',
	'foundry_aluminium',
	'foundry_carbide',
	'refine_plastic',
	'refine_fuel',
	'refine_acid',
	'refine_alumina',
	'refine_battery',
	'make_computer',
	'make_heavy_frame',
	'make_lumen_cell',
	'make_signal_core'
])

// One step of a unit's standing order: where it goes and what it does there.
export type Job = typeof Job.Type
export const Job = Schema.TaggedUnion({
	// Clear a tree or rock out of the way, or for its wood or stone.
	Clear: {prop: Schema.Int, x: Schema.Finite, z: Schema.Finite},
	// Raise a construction site whose items are all there.
	Construct: {site: Schema.Int},
	// Empty its cargo into a building.
	Dropoff: {building: Schema.Int},
	// Dig a raw item by hand from an ore tile.
	Gather: {item: ItemId, x: Schema.Int, z: Schema.Int},
	// Drive to a place and stay: guarding, waiting or parked.
	Hold: {x: Schema.Finite, z: Schema.Finite},
	// Take items out of a building.
	Pickup: {building: Schema.Int, count: Schema.Int, item: ItemId},
	// Be refitted at Home into the next mark.
	Refit: {},
	// Patch up a teammate that is down.
	Repair: {unit: Schema.Int},
	// Look round unseen ground.
	Scout: {x: Schema.Finite, z: Schema.Finite}
})

// The unit models: each class and mark is drawn as one of these (KINDS in the game's utils).
export type UnitKind = typeof UnitKind.Type
export const UnitKind = Schema.Literals([
	'worker',
	'cart',
	'digger',
	'dozer',
	'sentry',
	'loader',
	'strider',
	'skiff',
	'rotor'
])

// The hostiles: each biome sends one of these (ENEMIES in the game's utils).
export type EnemyKind = typeof EnemyKind.Type
export const EnemyKind = Schema.Literals([
	'scrapdog',
	'skimmer',
	'crawler',
	'golem',
	'drifter',
	'ruinsentry',
	'lurker',
	'burrower',
	'glitch'
])

// Wildlife: passive creatures that graze, wander, perch or drift, and run from units.
export type MobKind = typeof MobKind.Type
export const MobKind = Schema.Literals([
	'grazer',
	'bird',
	'heron',
	'fireflies',
	'lizard',
	'yak',
	'hare',
	'beetles',
	'moths',
	'jellies',
	'fish'
])

// What a model shows: one loop per state; `alarm` is a unit fleeing an attack or a creature running from one.
export type Act = typeof Act.Type
export const Act = Schema.Literals(['idle', 'move', 'work', 'alarm', 'attack', 'die'])

export class GameError extends Schema.TaggedError<GameError>()('GameError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type Point = typeof Point.Type
export const Point = Schema.Struct({x: Schema.Finite, z: Schema.Finite})

type Count = typeof Count.Type
const Count = Schema.Int.check(Schema.isBetween({maximum: 1000, minimum: 1}))
type Tile = typeof Tile.Type
const Tile = Schema.Int.check(Schema.isBetween({maximum: 30_000, minimum: -30_000}))

// Which way a belt carries or a ramp rises: north is −z.
export type Direction = typeof Direction.Type
export const Direction = Schema.Literals(['north', 'east', 'south', 'west'])

export type Items = typeof Items.Type
export const Items = Schema.Record(ItemId, Schema.optionalKey(Schema.Int))

// What a unit keeps doing until it gets another order. Auto: a Builder raises and supplies the team's construction sites, any other unit waits by Home. Gather: a Builder digs a raw item by hand (ore from a field, wood from trees, stone from rocks) round a place and carries it to the nearest storage. Haul: carries items from one building's output (or a crate or Home) to another building, `count` items in all or for good. Explore: flies or drives to the nearest unseen ground, again and again. Guard: holds a place and fights what comes near. Go: drives to a place and waits there.
export type Standing = typeof Standing.Type
export const Standing = Schema.TaggedUnion({
	Auto: {},
	Explore: {},
	Gather: {item: ItemId, x: Tile, z: Tile},
	Go: {x: Tile, z: Tile},
	Guard: {x: Tile, z: Tile},
	Haul: {count: Schema.optionalKey(Count), from: Schema.Int, item: Schema.optionalKey(ItemId), to: Schema.Int}
})

// A team's command for the next round. Build: a construction site for a building whose north-west tile is (x, z). Order: standing orders for units. Recipe: what a machine makes. Craft: Home's bench makes a recipe's output `count` times. Make: Home's line makes a mark 1 unit. Upgrade: a unit drives Home and comes out a mark better. Advance: Home (a tier) or the Beacon (a phase or Signal cycle) takes the next milestone's items from what it holds. Cancel: a site is dropped, or a building taken down; what went into it goes back to Home. Message: a line to a team met. Note: the team's own notes, carried from round to round, replaced whole.
export type Command = typeof Command.Type
export const Command = Schema.TaggedUnion({
	Advance: {},
	// A structure (belt, pipe, pole, road…) is laid on every tile of the straight line from (x, z) to `to`, running that way; a single one runs `dir`.
	Build: {
		dir: Schema.optionalKey(Direction),
		kind: Schema.Union([BuildingKind, StructureKind]),
		to: Schema.optionalKey(Schema.Struct({x: Tile, z: Tile})),
		x: Tile,
		z: Tile
	},
	Cancel: {building: Schema.Int},
	Craft: {count: Schema.Int.check(Schema.isBetween({maximum: 50, minimum: 1})), recipe: RecipeId},
	Make: {unit: UnitClass},
	Message: {team: Schema.Int, text: Schema.String.check(Schema.isMaxLength(400))},
	Note: {text: Schema.String.check(Schema.isMaxLength(2000))},
	Order: {order: Standing, units: Schema.Array(Schema.Int).check(Schema.isMinLength(1), Schema.isMaxLength(40))},
	Recipe: {building: Schema.Int, recipe: RecipeId},
	Upgrade: {unit: Schema.Int}
})

// What a command did, in plain words for the model's next round.
export type Outcome = typeof Outcome.Type
export const Outcome = Schema.Struct({command: Command, ok: Schema.Boolean, text: Schema.String})

// A body as every client draws it, ten times a second: a team's unit, a hostile or a creature.
export type UnitView = typeof UnitView.Type
export const UnitView = Schema.Struct({
	act: Act,
	// A guard's turret points this way.
	aim: Schema.optionalKey(Schema.Finite),
	// What it carries most of; `load` is how full it is, 0 to 1.
	cargo: Schema.optional(ItemId),
	// What it is doing, in plain words, for its hover card.
	doing: Schema.String,
	health: Schema.Finite,
	id: Schema.Int,
	kind: Schema.Union([UnitKind, EnemyKind, MobKind]),
	load: Schema.Finite,
	team: Schema.optionalKey(Schema.Int),
	x: Schema.Finite,
	yaw: Schema.Finite,
	z: Schema.Finite
})

// A building as clients draw it: its footprint's north-west tile and size, how far it is built, and what it is doing.
export type BuildingView = typeof BuildingView.Type
export const BuildingView = Schema.Struct({
	built: Schema.Finite,
	d: Schema.Int,
	dir: Direction,
	id: Schema.Int,
	// What a belt carries on this tile.
	item: Schema.optional(ItemId),
	kind: Schema.Union([BuildingKind, StructureKind]),
	recipe: Schema.optional(RecipeId),
	status: Schema.String,
	team: Schema.Int,
	w: Schema.Int,
	x: Schema.Int,
	z: Schema.Int
})

// A team as the sidebar shows it.
export type TeamView = typeof TeamView.Type
export const TeamView = Schema.Struct({
	buildings: Schema.Int,
	color: Schema.String,
	contacts: Schema.Array(Schema.Int),
	cycles: Schema.Int,
	gate: Schema.String,
	gates: Schema.Int,
	home: Point,
	id: Schema.Int,
	model: Schema.String,
	name: Schema.String,
	status: Schema.Literals(['waiting', 'thinking', 'failed']),
	units: Schema.Int
})

// The tiles of one chunk any team has seen, a bit per tile in row order.
export type Explored = typeof Explored.Type
export const Explored = Schema.Struct({bits: Schema.Uint8Array, cx: Schema.Int, cz: Schema.Int})

// A chunk some team's units have stood in: a bit per team.
export type Zone = typeof Zone.Type
export const Zone = Schema.Struct({cx: Schema.Int, cz: Schema.Int, teams: Schema.Int})

// One server frame for one connection: every body, the tiles changed, the props cleared and the chunks explored since its last frame, shots fired, and the buildings, teams and zones when they changed. The first frame carries the world's seed and generator revision.
export type Frame = typeof Frame.Type
export const Frame = Schema.Struct({
	at: Schema.Finite,
	buildings: Schema.optional(Schema.Array(BuildingView)),
	changes: Schema.Array(TileChange),
	cleared: Schema.Array(Schema.Int),
	explored: Schema.Array(Explored),
	// In a replay, the live world's tick.
	live: Schema.optionalKey(Schema.Int),
	shots: Schema.Array(Schema.Struct({from: Schema.Int, to: Schema.Int})),
	teams: Schema.optional(Schema.Array(TeamView)),
	tick: Schema.Int,
	units: Schema.Array(UnitView),
	world: Schema.optional(Schema.Struct({generator: Schema.Int, seed: Schema.Int})),
	zones: Schema.optional(Schema.Array(Zone))
})

// A moment the timeline marks: a milestone paid, two teams meeting, a message between them, a unit down.
export type Mark = typeof Mark.Type
export const Mark = Schema.Struct({
	kind: Schema.Literals(['milestone', 'contact', 'message', 'down']),
	other: Schema.optionalKey(Schema.Int),
	team: Schema.Int,
	tick: Schema.Int
})

// What one round's boundary did, for replays: each team's commands in the order they applied, and the round's marks.
export type Journal = typeof Journal.Type
export const Journal = Schema.Struct({
	applied: Schema.Array(Schema.Struct({commands: Schema.Array(Command), team: Schema.Int})),
	marks: Schema.Array(Mark),
	round: Schema.Int
})

// The whole run for the timeline: its first tick, the live tick and every mark.
export type Timeline = typeof Timeline.Type
export const Timeline = Schema.Struct({live: Schema.Int, marks: Schema.Array(Mark), start: Schema.Int})

// One round of a team's thread: what it was told, what it thought and said, the commands it gave and what each did.
export type Entry = typeof Entry.Type
export const Entry = Schema.Struct({
	commands: Schema.Array(Outcome),
	// The notices the round's observation opened with: contacts, messages, finished work, losses.
	notices: Schema.Array(Schema.String),
	observation: Schema.String,
	reasoning: Schema.optionalKey(Schema.String),
	round: Schema.Int,
	status: Schema.Literals(['done', 'late', 'failed']),
	team: Schema.Int,
	text: Schema.String,
	tick: Schema.Int,
	tokens: Schema.optionalKey(Schema.Struct({input: Schema.Int, output: Schema.Int}))
})

/* ───────── the world on disk: everything that decides what happens next ───────── */

const Body = {
	act: Act,
	doing: Schema.String,
	id: Schema.Int,
	timer: Schema.Finite,
	x: Schema.Finite,
	yaw: Schema.Finite,
	z: Schema.Finite
}

type MachineSnapshot = typeof MachineSnapshot.Type
// A state machine's snapshot as the machine encodes it for a save: its active state paths, each with its value; the machine decodes the rest.
const MachineSnapshot = Schema.TaggedStruct('MachineSnapshot', {
	active: Schema.Array(Schema.Struct({path: Schema.String, value: Schema.optionalKey(Schema.Json)})),
	version: Schema.Literal(2)
})

export type SavedUnit = typeof SavedUnit.Type
export const SavedUnit = Schema.Struct({
	...Body,
	aim: Schema.Finite,
	alarm: Schema.Finite,
	anchor: Point,
	anchored: Schema.Finite,
	cargo: Items,
	// Items it set out to bring a construction site, which the site counts on.
	claim: Schema.optional(
		Schema.Struct({count: Schema.Int, from: Schema.optionalKey(Schema.Int), item: ItemId, site: Schema.Int})
	),
	class: UnitClass,
	health: Schema.Finite,
	lost: Schema.Boolean,
	mark: Schema.Int,
	order: Standing,
	path: Schema.Array(Point),
	planned: Schema.Finite,
	route: Schema.String,
	sighted: Point,
	// Its step, as the task machine in the game's tasks encodes it.
	task: MachineSnapshot,
	team: Schema.Int,
	upgrade: Schema.Boolean
})

export type SavedBuilding = typeof SavedBuilding.Type
export const SavedBuilding = Schema.Struct({
	// Which side a splitter or merger serves next.
	cursor: Schema.Int,
	dir: Direction,
	// MJ left in the item a generator burns.
	fuel: Schema.Finite,
	id: Schema.Int,
	// Items on their way to its construction.
	incoming: Items,
	kind: Schema.Union([BuildingKind, StructureKind]),
	output: Items,
	progress: Schema.Finite,
	recipe: Schema.optionalKey(RecipeId),
	// Items in its stock that units set out to take.
	reserved: Items,
	// Its construction, as the site machine in the game's tasks encodes it.
	site: MachineSnapshot,
	stock: Items,
	team: Schema.Int,
	x: Schema.Int,
	z: Schema.Int
})

export type SavedTeam = typeof SavedTeam.Type
export const SavedTeam = Schema.Struct({
	bench: Schema.Array(Schema.Struct({left: Schema.Int, recipe: RecipeId})),
	benchProgress: Schema.Finite,
	contacts: Schema.Array(Schema.Int),
	cycles: Schema.Int,
	explored: Schema.Array(Explored),
	gates: Schema.Array(GateId),
	home: Schema.Int,
	id: Schema.Int,
	inbox: Schema.Array(Schema.String),
	line: Schema.Array(Schema.Struct({class: UnitClass, mark: Schema.Int, unit: Schema.optionalKey(Schema.Int)})),
	lineProgress: Schema.Finite,
	note: Schema.String,
	outcomes: Schema.Array(Outcome)
})

export type SavedEnemy = typeof SavedEnemy.Type
export const SavedEnemy = Schema.Struct({
	...Body,
	dead: Schema.Finite,
	health: Schema.Finite,
	kind: EnemyKind,
	patch: Schema.Finite,
	spot: Point,
	target: Schema.Int
})

export type SavedMob = typeof SavedMob.Type
export const SavedMob = Schema.Struct({
	...Body,
	from: Point,
	kind: MobKind,
	patch: Schema.Finite,
	scared: Schema.Finite,
	spot: Point,
	target: Schema.optional(Point)
})

// The world at one tick: its seed and generator, every change to the ground, every body, building and team, the dice's position and what the steering remembers.
export type Saved = typeof Saved.Type
export const Saved = Schema.Struct({
	amounts: Schema.Array(Schema.Tuple([Schema.Int, Schema.Int, Schema.Finite])),
	buildings: Schema.Array(SavedBuilding),
	cleared: Schema.Array(Schema.Int),
	draws: Schema.Int,
	edits: Schema.Array(Schema.Struct({edit: Edit, x: Schema.Int, z: Schema.Int})),
	enemies: Schema.Array(SavedEnemy),
	generator: Schema.Int,
	jams: Schema.Array(Schema.Tuple([Schema.Int, Schema.Finite])),
	mobs: Schema.Array(SavedMob),
	nextId: Schema.Int,
	patches: Schema.Array(Schema.Tuple([Schema.Int, Schema.Array(Schema.Int)])),
	// Each pipe network holding fluid: one of its pipes, the fluid and how much.
	pipes: Schema.Array(Schema.Tuple([Schema.Int, ItemId, Schema.Finite])),
	raidAt: Schema.Finite,
	seed: Schema.Int,
	sides: Schema.Array(Schema.Tuple([Schema.Int, Schema.Finite, Point])),
	stalls: Schema.Array(Schema.Tuple([Schema.Int, Schema.Finite, Schema.Finite, Point])),
	teams: Schema.Array(SavedTeam),
	tick: Schema.Int,
	units: Schema.Array(SavedUnit),
	visited: Schema.Array(Schema.Tuple([Schema.Int, Schema.Int])),
	wildId: Schema.Int
})
