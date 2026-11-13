import {Schema, pipe} from 'effect'

export type VisitorId = typeof VisitorId.Type
export const VisitorId = pipe(Schema.NonEmptyString.check(Schema.isMaxLength(32)), Schema.brand('PortfolioVisitorId'))

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

// The room's cursors and the wandering server marks; only the visitors are tabs.
export type Scene = typeof Scene.Type
export const Scene = Schema.Struct({bots: Visitors, visitors: Visitors})
