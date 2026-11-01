import {Schema, Struct, pipe} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {RpcAuth} from '@deslop/runtime/auth/utils'

import {PortfolioVisitor, PortfolioVisitors} from '#services/presence/schema.ts'

export class RpcContracts extends RpcGroup.make(
	// Every visitor whenever one moves; each page draws the trails itself.
	Rpc.make('portfolio.join', {
		payload: Schema.Struct(pipe(PortfolioVisitor.fields, Struct.pick(['color', 'id', 'name']))),
		stream: true,
		success: PortfolioVisitors
	}),
	Rpc.make('portfolio.move', {
		payload: Schema.Struct(pipe(PortfolioVisitor.fields, Struct.pick(['color', 'id', 'x', 'y'])))
	})
).middleware(RpcAuth) {}
