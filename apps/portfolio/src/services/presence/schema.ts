import {Schema, pipe} from 'effect'

export type PortfolioColor = typeof PortfolioColor.Type
export const PortfolioColor = Schema.Literals([
	'oklch(0.74 0.19 118)',
	'oklch(0.76 0.2 128)',
	'oklch(0.75 0.18 138)',
	'oklch(0.73 0.17 150)',
	'oklch(0.74 0.18 162)',
	'oklch(0.76 0.17 174)',
	'oklch(0.75 0.18 186)',
	'oklch(0.73 0.19 198)',
	'oklch(0.72 0.2 210)',
	'oklch(0.74 0.18 222)',
	'oklch(0.71 0.18 234)',
	'oklch(0.73 0.19 246)',
	'oklch(0.75 0.19 258)',
	'oklch(0.74 0.2 270)',
	'oklch(0.73 0.21 282)',
	'oklch(0.74 0.2 296)',
	'oklch(0.75 0.19 310)',
	'oklch(0.74 0.18 324)',
	'oklch(0.73 0.19 338)',
	'oklch(0.72 0.2 352)'
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
