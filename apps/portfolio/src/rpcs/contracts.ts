import {Schema, Struct, pipe} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {PortfolioState, PortfolioVisitor} from '#services/presence/schema.ts'

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
