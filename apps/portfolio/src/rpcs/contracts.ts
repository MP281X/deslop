import {Schema, Struct, pipe} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {PortfolioVisitor, PortfolioVisitors} from '#services/presence/schema.ts'

type Guest = typeof Guest.Type
const Guest = PortfolioVisitor.mapFields(fields => ({
	...fields,
	id: fields.id.check(Schema.isPattern(/^(?!server-)/u))
}))

// Visitors are guests, so the room needs no sign-in, unlike every other app's RPC.
export class RpcContracts extends RpcGroup.make(
	Rpc.make('portfolio.join', {
		payload: Schema.Struct(pipe(Guest.fields, Struct.pick(['color', 'id', 'name']))),
		stream: true,
		success: PortfolioVisitors
	}),
	Rpc.make('portfolio.move', {payload: Schema.Struct(pipe(Guest.fields, Struct.pick(['color', 'id', 'x', 'y'])))})
) {}
