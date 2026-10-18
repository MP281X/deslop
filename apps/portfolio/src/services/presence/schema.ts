import {Effect, Schema, pipe} from 'effect'

export type PortfolioVisitor = typeof PortfolioVisitor.Type
export const PortfolioVisitor = Schema.Struct({
	color: Schema.NonEmptyString,
	id: Schema.NonEmptyString,
	name: Schema.NonEmptyString,
	x: Schema.Finite,
	y: Schema.Finite
})

export type PortfolioTrail = typeof PortfolioTrail.Type
export const PortfolioTrail = Schema.Struct({
	color: Schema.NonEmptyString,
	visitorId: Schema.NonEmptyString,
	x: Schema.Finite,
	y: Schema.Finite
})

export type PortfolioState = typeof PortfolioState.Type
export const PortfolioState = Schema.Struct({
	trails: pipe(Schema.Array(PortfolioTrail), Schema.withConstructorDefault(Effect.succeed([]))),
	visitors: pipe(Schema.Array(PortfolioVisitor), Schema.withConstructorDefault(Effect.succeed([])))
})
