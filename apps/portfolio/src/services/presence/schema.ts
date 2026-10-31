import {Schema, pipe} from 'effect'

// A visitor's cursor and trail take one of the apps' hues from DESIGN.md, so the page stays in the same palette.
export type PortfolioColor = typeof PortfolioColor.Type
export const PortfolioColor = Schema.Literals([
	'#da702c',
	'#d0a215',
	'#879a39',
	'#3aa99f',
	'#4385be',
	'#8b7ec8',
	'#ce5d97'
])

// Anyone can send a cursor, and every page draws and resends it: positions stay on the viewport and labels stay short.
export type PortfolioVisitor = typeof PortfolioVisitor.Type
export const PortfolioVisitor = Schema.Struct({
	color: PortfolioColor,
	id: pipe(Schema.NonEmptyString, Schema.check(Schema.isMaxLength(32))),
	name: pipe(Schema.NonEmptyString, Schema.check(Schema.isMaxLength(32))),
	x: pipe(Schema.Finite, Schema.check(Schema.isBetween({maximum: 1, minimum: 0}))),
	y: pipe(Schema.Finite, Schema.check(Schema.isBetween({maximum: 1, minimum: 0})))
})

export type PortfolioVisitors = typeof PortfolioVisitors.Type
export const PortfolioVisitors = Schema.Array(PortfolioVisitor)
