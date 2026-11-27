import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {RpcAdmin} from '@deslop/runtime/shared/auth'

export type Item = typeof Item.Type
export const Item = Schema.Struct({body: Schema.String, id: Schema.String, line: Schema.String, title: Schema.String})

// Admin-only until the runtime probe's access list names a member API.
export class RpcContracts extends RpcGroup.make(Rpc.make('items.list', {success: Schema.Array(Item)})).middleware(
	RpcAdmin
) {}
