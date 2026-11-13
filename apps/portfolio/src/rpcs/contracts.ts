import {Schema, Struct} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {Scene, Visitor} from '#services/presence/schema.ts'

type Guest = typeof Guest.Type
const Guest = Visitor.mapFields(fields => ({...fields, id: fields.id.check(Schema.isPattern(/^(?!server-)/u))}))

// Visitors are guests, so the room needs no sign-in, unlike every other app's RPC.
export class RpcContracts extends RpcGroup.make(
	Rpc.make('presence.join', {
		payload: Schema.Struct(Struct.pick(Guest.fields, ['color', 'id', 'name'])),
		stream: true,
		success: Scene
	}),
	Rpc.make('presence.move', {payload: Schema.Struct(Struct.pick(Guest.fields, ['color', 'id', 'x', 'y']))})
) {}
