import {Schema} from 'effect'

export type PortfolioVisitor = typeof PortfolioVisitor.Type
export const PortfolioVisitor = Schema.Struct({
	color: Schema.NonEmptyString,
	id: Schema.NonEmptyString,
	name: Schema.NonEmptyString,
	x: Schema.Finite,
	y: Schema.Finite
})

export type PortfolioVisitors = typeof PortfolioVisitors.Type
export const PortfolioVisitors = Schema.Array(PortfolioVisitor)
