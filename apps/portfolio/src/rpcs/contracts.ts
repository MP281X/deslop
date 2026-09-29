import {Effect, Schema, Struct, pipe} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

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

export class RpcContracts extends RpcGroup.make(
	Rpc.make('portfolio.join', {
		payload: Schema.Struct(pipe(PortfolioVisitor.fields, Struct.pick(['color', 'id', 'name']))),
		stream: true,
		success: PortfolioState
	}),
	Rpc.make('portfolio.move', {
		payload: Schema.Struct(pipe(PortfolioVisitor.fields, Struct.pick(['color', 'id', 'x', 'y'])))
	})
) {}
