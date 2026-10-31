import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {AuthError} from '@deslop/runtime/auth/schema'
import {RpcAuth} from '@deslop/runtime/auth/utils'

import {AddServer, ConnectionInfo, ServerParams, ToolVisibility} from '#services/connections/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('gateway.servers', {error: AuthError, stream: true, success: Schema.Array(ConnectionInfo)}),
	Rpc.make('gateway.add', {error: AuthError, payload: AddServer, success: ConnectionInfo}),
	Rpc.make('gateway.disconnect', {error: AuthError, payload: ServerParams}),
	Rpc.make('gateway.remove', {error: AuthError, payload: ServerParams}),
	Rpc.make('gateway.hide', {error: AuthError, payload: ToolVisibility})
).middleware(RpcAuth) {}
