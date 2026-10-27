import {Schema} from 'effect'

export type DroneKind = typeof DroneKind.Type
export const DroneKind = Schema.Literals(['scout', 'miner', 'hauler', 'guard', 'builder'])

export type EntityKind = typeof EntityKind.Type
export const EntityKind = Schema.Literals([...DroneKind.literals, 'core', 'turret', 'wall', 'relay', 'glitch'])

export class GameError extends Schema.TaggedError<GameError>()('GameError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type Buildable = typeof Buildable.Type
// What a builder can put down; the core comes with the player.
export const Buildable = Schema.Literals(['turret', 'wall', 'relay'])

export type Point = typeof Point.Type
export const Point = Schema.Struct({x: Schema.Finite, z: Schema.Finite})

// What a drone does without supervision; player names are GitHub logins, unique across the world.
export type Routine = typeof Routine.Type
export const Routine = Schema.TaggedUnion({
	Build: {at: Point, structure: Buildable},
	Escort: {group: Schema.String},
	Explore: {},
	Goto: {target: Point},
	Haul: {},
	Idle: {},
	Mine: {},
	Patrol: {center: Point, radius: Schema.Finite},
	Return: {},
	Search: {player: Schema.String},
	Track: {player: Schema.String}
})

export type Stance = typeof Stance.Type
export const Stance = Schema.Literals(['hostile', 'friendly'])

// Team memory keeps what the live state cannot tell: one entry per subject, updated in place.
export type MemoryEntry = typeof MemoryEntry.Type
export const MemoryEntry = Schema.TaggedUnion({
	Note: {at: Schema.optionalKey(Point), key: Schema.String, text: Schema.String, updatedAt: Schema.Finite},
	Place: {at: Point, key: Schema.String, name: Schema.String, updatedAt: Schema.Finite},
	// avoid: CORE chose to reroute, so miners keep away even before a second raid.
	RouteAssaulted: {
		at: Point,
		avoid: Schema.Boolean,
		count: Schema.Finite,
		key: Schema.String,
		losses: Schema.Finite,
		updatedAt: Schema.Finite
	},
	Sighting: {at: Point, key: Schema.String, player: Schema.String, updatedAt: Schema.Finite, what: Schema.String},
	Standing: {key: Schema.String, player: Schema.String, reason: Schema.String, stance: Stance, updatedAt: Schema.Finite}
})

export type EntityInfo = typeof EntityInfo.Type
export const EntityInfo = Schema.Struct({
	cargo: Schema.Finite,
	color: Schema.Finite,
	group: Schema.String,
	id: Schema.Finite,
	kind: EntityKind,
	owner: Schema.String,
	routine: Schema.String
})

export type Explored = typeof Explored.Type
export const Explored = Schema.Struct({bits: Schema.Uint8Array, cx: Schema.Finite, cz: Schema.Finite})

export type Member = typeof Member.Type
export const Member = Schema.Struct({color: Schema.Finite, name: Schema.String, online: Schema.Boolean})

export type CoreStatus = typeof CoreStatus.Type
export const CoreStatus = Schema.Struct({planner: Schema.Literals(['ready', 'slowed', 'asleep', 'offline'])})

// CORE's answer so far; once done, the orders it carried out, the drones they moved and the orders the world refused.
export type Reply = typeof Reply.Type
export const Reply = Schema.Struct({
	answer: Schema.String,
	done: Schema.Boolean,
	drones: Schema.Array(Schema.Finite),
	orders: Schema.Array(Schema.String),
	refused: Schema.Array(Schema.String)
})

// One line of a player's conversation with CORE; CORE's lines carry the orders that went through and the refused ones.
export type Turn = typeof Turn.Type
export const Turn = Schema.Struct({
	at: Schema.Finite,
	by: Schema.Literals(['you', 'core']),
	orders: Schema.Array(Schema.String),
	refused: Schema.Array(Schema.String),
	text: Schema.String
})

// An event for the team; the HUD jumps to its drone and shows its place relative to what you are looking at.
export type LogEntry = typeof LogEntry.Type
export const LogEntry = Schema.Struct({
	at: Schema.optionalKey(Point),
	drone: Schema.optionalKey(Schema.Finite),
	text: Schema.String,
	time: Schema.Finite,
	tone: Schema.Literals(['info', 'alert'])
})

export type Hud = typeof Hud.Type
export const Hud = Schema.Struct({
	base: Point,
	chat: Schema.Array(Turn),
	core: CoreStatus,
	invite: Schema.String,
	log: Schema.Array(LogEntry),
	memory: Schema.Array(MemoryEntry),
	ore: Schema.Finite,
	players: Schema.Array(Schema.String),
	team: Schema.Array(Member),
	you: Schema.String
})

// One server frame for one connection: packed positions of everything its team sees, plus changes since the last frame.
export type Frame = typeof Frame.Type
export const Frame = Schema.Struct({
	at: Schema.Finite,
	depleted: Schema.Array(Point),
	entities: Schema.Array(EntityInfo),
	explored: Schema.Array(Explored),
	gone: Schema.Array(Schema.Finite),
	hud: Schema.optionalKey(Hud),
	positions: Schema.Uint8Array,
	shots: Schema.Array(Schema.Tuple([Schema.Finite, Schema.Finite]))
})

export type Selector = typeof Selector.Type
export const Selector = Schema.Struct({
	count: Schema.optionalKey(Schema.Finite),
	group: Schema.optionalKey(Schema.String),
	ids: Schema.optionalKey(Schema.Array(Schema.Finite)),
	kind: Schema.optionalKey(DroneKind)
})

// The typed actions both the CORE planner and the HUD issue; the server validates each against the player's state.
export type Action = typeof Action.Type
export const Action = Schema.TaggedUnion({
	Assign: {group: Schema.optionalKey(Schema.String), routine: Routine, selector: Selector},
	Fabricate: {count: Schema.Finite, kind: DroneKind},
	Forget: {key: Schema.String},
	Relocate: {target: Point},
	Remember: {
		at: Schema.optionalKey(Point),
		name: Schema.optionalKey(Schema.String),
		player: Schema.optionalKey(Schema.String),
		stance: Schema.optionalKey(Stance),
		text: Schema.String
	}
})

export type Steer = typeof Steer.Type
export const Steer = Schema.Struct({drone: Schema.Finite, x: Schema.Finite, z: Schema.Finite})

type SavedEntity = typeof SavedEntity.Type
const SavedEntity = Schema.Struct({
	cargo: Schema.Finite,
	group: Schema.String,
	health: Schema.Finite,
	id: Schema.Finite,
	kind: EntityKind,
	owner: Schema.String,
	routine: Routine,
	x: Schema.Finite,
	z: Schema.Finite
})

export type SavedPlayer = typeof SavedPlayer.Type
export const SavedPlayer = Schema.Struct({
	activeAt: Schema.Finite,
	base: Point,
	color: Schema.Finite,
	id: Schema.String,
	name: Schema.String,
	ore: Schema.Finite,
	team: Schema.String
})

export type Saved = typeof Saved.Type
export const Saved = Schema.Struct({
	depleted: Schema.Array(Schema.String),
	entities: Schema.Array(SavedEntity),
	explored: Schema.Array(Schema.Struct({chunks: Schema.Array(Explored), team: Schema.String})),
	memory: Schema.Array(Schema.Struct({entries: Schema.Array(MemoryEntry), team: Schema.String})),
	nextId: Schema.Finite,
	players: Schema.Array(SavedPlayer)
})
