import {Schema} from 'effect'

import {Edit, Material, TileChange} from '#services/world/schema.ts'

// The fixed roster: each unit has one job, one strength and one weakness, and the terrain decides which one to send.
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

// One hostile kind per biome, in Biome order.
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

// What a model shows: one loop per state.
export type Act = typeof Act.Type
export const Act = Schema.Literals(['idle', 'move', 'work', 'alarm', 'attack', 'die'])

export type BuildKind = typeof BuildKind.Type
export const BuildKind = Schema.Literals(['road', 'ramp', 'bridge'])

export class GameError extends Schema.TaggedError<GameError>()('GameError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type Point = typeof Point.Type
export const Point = Schema.Struct({x: Schema.Finite, z: Schema.Finite})

// The typed actions both CORE and the HUD issue; the sim checks each against the colony's state.
export type Action = typeof Action.Type
export const Action = Schema.TaggedUnion({
	// A dozer paves, ramps or bridges the tiles on a straight line, in order from `from`.
	Build: {from: Point, kind: BuildKind, to: Point},
	Cancel: {job: Schema.Int},
	// A sentry holds a place and fires on anything hostile near it.
	Guard: {at: Point},
	// New units come off Home's line, paid in materials.
	Make: {count: Schema.Int.check(Schema.isBetween({maximum: 5, minimum: 1})), kind: UnitKind},
	// A waypoint: a place with a short note, shown in the world as a flag.
	Mark: {at: Point, note: Schema.String.check(Schema.isMaxLength(80))},
	// A crew (digger, loader, carts) mines one ore field until it runs out.
	Mine: {carts: Schema.optionalKey(Schema.Int.check(Schema.isBetween({maximum: 4, minimum: 1}))), field: Schema.Int},
	// An idle unit drives home and is taken apart for most of its cost.
	Recycle: {unit: Schema.Int},
	// The lab researches the next tier.
	Research: {},
	Unmark: {waypoint: Schema.Int}
})

export type Stock = typeof Stock.Type
export const Stock = Schema.Record(Material, Schema.Finite)

// A unit as every client draws it, ten times a second.
export type UnitView = typeof UnitView.Type
export const UnitView = Schema.Struct({
	act: Act,
	// A sentry's turret points this way.
	aim: Schema.optionalKey(Schema.Finite),
	// Ore it carries; `load` is how full it is, 0 to 1.
	cargo: Schema.optional(Material),
	// What it is doing, in plain words, for its hover card.
	doing: Schema.String,
	health: Schema.Finite,
	id: Schema.Int,
	kind: Schema.Union([UnitKind, EnemyKind]),
	load: Schema.Finite,
	x: Schema.Finite,
	yaw: Schema.Finite,
	z: Schema.Finite
})

export type JobView = typeof JobView.Type
export const JobView = Schema.Struct({
	at: Point,
	// Why it waits, in plain words.
	blocked: Schema.optional(Schema.String),
	crew: Schema.Array(Schema.Int),
	// What the progress measures, such as "120 left".
	detail: Schema.String,
	id: Schema.Int,
	progress: Schema.Finite,
	title: Schema.String
})

export type Waypoint = typeof Waypoint.Type
export const Waypoint = Schema.Struct({at: Point, id: Schema.Int, note: Schema.String})

// One line of the colony's conversation with CORE; CORE's lines carry the orders that went through and the refused ones.
export type Turn = typeof Turn.Type
export const Turn = Schema.Struct({
	at: Schema.Finite,
	by: Schema.String,
	orders: Schema.Array(Schema.String),
	refused: Schema.Array(Schema.String),
	text: Schema.String
})

// CORE's answer so far; once done, the orders it carried out and the orders the colony refused.
export type Reply = typeof Reply.Type
export const Reply = Schema.Struct({
	answer: Schema.String,
	done: Schema.Boolean,
	orders: Schema.Array(Schema.String),
	refused: Schema.Array(Schema.String)
})

export type CoreStatus = typeof CoreStatus.Type
export const CoreStatus = Schema.Struct({planner: Schema.Literals(['ready', 'slowed', 'asleep', 'offline'])})

export type Research = typeof Research.Type
export const Research = Schema.Struct({
	// Seconds of research left, when the lab is busy.
	left: Schema.optionalKey(Schema.Finite),
	tier: Schema.Int
})

// Everything the HUD shows that changes slowly; sent when it changes.
export type Hud = typeof Hud.Type
export const Hud = Schema.Struct({
	alerts: Schema.Array(
		Schema.Struct({at: Point, text: Schema.String, time: Schema.Finite, unit: Schema.optionalKey(Schema.Int)})
	),
	chat: Schema.Array(Turn),
	core: CoreStatus,
	home: Point,
	jobs: Schema.Array(JobView),
	lab: Point,
	players: Schema.Array(Schema.String),
	research: Research,
	stock: Stock,
	waypoints: Schema.Array(Waypoint),
	you: Schema.String
})

// One server frame for one connection: every unit, the tiles that changed since its last frame, shots fired, and the HUD when it changed. The first frame carries the world's seed and generator revision.
export type Frame = typeof Frame.Type
export const Frame = Schema.Struct({
	at: Schema.Finite,
	changes: Schema.Array(TileChange),
	hud: Schema.optional(Hud),
	shots: Schema.Array(Schema.Struct({from: Schema.Int, to: Schema.Int})),
	units: Schema.Array(UnitView),
	world: Schema.optional(Schema.Struct({generator: Schema.Int, seed: Schema.Int}))
})

// A durable job: what it is, who works it and how far it got.
export type Job = typeof Job.Type
export const Job = Schema.Struct({action: Action, crew: Schema.Array(Schema.Int), done: Schema.Finite, id: Schema.Int})

export type SavedUnit = typeof SavedUnit.Type
export const SavedUnit = Schema.Struct({
	cargo: Schema.Finite,
	health: Schema.Finite,
	id: Schema.Int,
	job: Schema.optional(Schema.Int),
	kind: UnitKind,
	material: Schema.optional(Material),
	x: Schema.Finite,
	z: Schema.Finite
})

// The colony on disk: the world's seed and generator, every change to it, and the colony's units, jobs, stock and research.
export type Saved = typeof Saved.Type
export const Saved = Schema.Struct({
	amounts: Schema.Array(Schema.Tuple([Schema.Int, Schema.Int, Schema.Finite])),
	chat: Schema.Array(Turn),
	edits: Schema.Array(Schema.Struct({edit: Edit, x: Schema.Int, z: Schema.Int})),
	generator: Schema.Int,
	jobs: Schema.Array(Job),
	line: Schema.Array(UnitKind),
	nextId: Schema.Int,
	research: Research,
	seed: Schema.Int,
	// A save from before a material existed has none of it.
	stock: Schema.Record(Material, Schema.optionalKey(Schema.Finite)),
	units: Schema.Array(SavedUnit),
	waypoints: Schema.Array(Waypoint)
})
