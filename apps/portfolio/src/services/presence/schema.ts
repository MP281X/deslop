import {Schema, Struct, pipe} from 'effect'

export class PresenceError extends Schema.TaggedError<PresenceError>()('PresenceError', {message: Schema.String}) {}

// The room names each cursor; every page sees it, so it grants nothing.
export type VisitorId = typeof VisitorId.Type
export const VisitorId = pipe(Schema.NonEmptyString.check(Schema.isMaxLength(32)), Schema.brand('PortfolioVisitorId'))

// A tab's private guest key: tabs that hold it share one cursor, and no scene carries it.
export type GuestKey = typeof GuestKey.Type
export const GuestKey = pipe(Schema.String.check(Schema.isUUID(4)), Schema.brand('PortfolioGuestKey'))

// A visitor's cursor and trail stay in theme.css's palette.
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

// What a joined socket may change.
export type Command = typeof Command.Type
export const Command = Schema.Literals(['move', 'recolor'])

export type JoinVisitor = typeof JoinVisitor.Type
export const JoinVisitor = Schema.Struct({...Struct.pick(Visitor.fields, ['color', 'name']), key: GuestKey})
export type MoveVisitor = typeof MoveVisitor.Type
export const MoveVisitor = Schema.Struct(Struct.pick(Visitor.fields, ['x', 'y']))
export type RecolorVisitor = typeof RecolorVisitor.Type
export const RecolorVisitor = Schema.Struct(Struct.pick(Visitor.fields, ['color']))
