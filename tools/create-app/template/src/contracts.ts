import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {RpcAdmin} from '@deslop/runtime/shared/auth'

export const Item = Schema.Struct({id: Schema.String, title: Schema.String, line: Schema.String, body: Schema.String})

// Admin-only until the runtime probe's access list names a member API.
export class RpcContracts extends RpcGroup.make(Rpc.make('items.list', {success: Schema.Array(Item)})).middleware(
	RpcAdmin
) {}
