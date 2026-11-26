import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {RpcAdmin} from '@deslop/runtime/shared/auth'

// Admin-only until the runtime probe's access list names a member API: `probe` refuses any other member access.
export class RpcContracts extends RpcGroup.make(Rpc.make('app.name', {success: Schema.String})).middleware(RpcAdmin) {}
