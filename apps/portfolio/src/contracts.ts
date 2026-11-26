import {Schema, Struct, pipe} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

export class PresenceError extends Schema.TaggedError<PresenceError>()('PresenceError', {message: Schema.String}) {}

// The room names each cursor; every page sees it, so it grants nothing.
export type VisitorId = typeof VisitorId.Type
export const VisitorId = pipe(Schema.NonEmptyString.check(Schema.isMaxLength(32)), Schema.brand('PortfolioVisitorId'))

// A tab's private guest key: tabs that hold it share one cursor, and no scene carries it.
export type GuestKey = typeof GuestKey.Type
export const GuestKey = pipe(Schema.String.check(Schema.isUUID(4)), Schema.brand('PortfolioGuestKey'))

// A visitor's cursor and trail stay in the same palette.
export type Color = typeof Color.Type
export const Color = Schema.Literals(['#da702c', '#d0a215', '#3aa99f', '#4385be', '#8b7ec8', '#ce5d97'])

// Anyone can send a cursor, and every page draws and resends it: positions stay on the viewport and labels stay short.
export type Visitor = typeof Visitor.Type
export const Visitor = Schema.Struct({
	color: Color,
	id: VisitorId,
	name: Schema.NonEmptyString.check(Schema.isMaxLength(32)),
	x: Schema.Finite.check(Schema.isBetween({maximum: 1, minimum: 0})),
	y: Schema.Finite.check(Schema.isBetween({maximum: 1, minimum: 0}))
})

export type Visitors = typeof Visitors.Type
export const Visitors = Schema.Array(Visitor)

// The room's cursors and the wandering server marks; only the visitors are tabs, and `own` is the joining tab's cursor.
export type Scene = typeof Scene.Type
export const Scene = Schema.Struct({bots: Visitors, own: VisitorId, visitors: Visitors})

export type JoinVisitor = typeof JoinVisitor.Type
const JoinVisitor = Schema.Struct({...Struct.pick(Visitor.fields, ['color', 'name']), key: GuestKey})
export type MoveVisitor = typeof MoveVisitor.Type
export const MoveVisitor = Schema.Struct(Struct.pick(Visitor.fields, ['x', 'y']))
export type RecolorVisitor = typeof RecolorVisitor.Type
const RecolorVisitor = Schema.Struct(Struct.pick(Visitor.fields, ['color']))

// Visitors are guests, so the room needs no sign-in; a guest key, not the caller, decides whose cursor a socket moves.
export const RpcContracts = RpcGroup.make(
	Rpc.make('presence.join', {error: PresenceError, payload: JoinVisitor, stream: true, success: Scene}),
	Rpc.make('presence.move', {error: PresenceError, payload: MoveVisitor}),
	Rpc.make('presence.recolor', {error: PresenceError, payload: RecolorVisitor})
)

// Moves under a quarter of a percent of the viewport are neither sent nor drawn.
export function hasMeaningfulMove(current: {x: number; y: number}, next: {x: number; y: number}) {
	const deltaX = next.x - current.x
	const deltaY = next.y - current.y

	return deltaX * deltaX + deltaY * deltaY >= 0.0025 * 0.0025
}
