import {Schema, Struct} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {PortfolioScene, PortfolioVisitor} from '#services/presence/schema.ts'

type Guest = typeof Guest.Type
const Guest = PortfolioVisitor.mapFields(fields => ({
	...fields,
	id: fields.id.check(Schema.isPattern(/^(?!server-)/u))
}))

// Visitors are guests, so the room needs no sign-in, unlike every other app's RPC.
export class RpcContracts extends RpcGroup.make(
	Rpc.make('presence.join', {
		payload: Schema.Struct(Struct.pick(Guest.fields, ['color', 'id', 'name'])),
		stream: true,
		success: PortfolioScene
	}),
	Rpc.make('presence.move', {payload: Schema.Struct(Struct.pick(Guest.fields, ['color', 'id', 'x', 'y']))})
) {}
