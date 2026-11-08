import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {AuthError} from '@deslop/runtime/auth/schema'
import {RpcAuth} from '@deslop/runtime/auth/utils'

import {AiProvider, AiKeyInfo, AiSetKey, AiGrantInfo, AiUsageQuery, AiUsageReport} from '#services/ai/schema.ts'
import {AddServer, ConnectionInfo, ServerId, ServerParams} from '#services/connections/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('ai.keys', {error: AuthError, success: Schema.Array(AiKeyInfo)}),
	Rpc.make('ai.setKey', {error: AuthError, payload: AiSetKey}),
	Rpc.make('ai.removeKey', {error: AuthError, payload: Schema.Struct({provider: AiProvider})}),
	Rpc.make('ai.grants', {error: AuthError, success: Schema.Array(AiGrantInfo)}),
	Rpc.make('ai.revokeGrant', {error: AuthError, payload: Schema.Struct({app: Schema.String})}),
	Rpc.make('ai.usage', {error: AuthError, payload: AiUsageQuery, success: AiUsageReport}),
	Rpc.make('gateway.servers', {error: AuthError, stream: true, success: Schema.Array(ConnectionInfo)}),
	Rpc.make('gateway.calls', {error: AuthError, stream: true, success: ServerId}),
	Rpc.make('gateway.add', {error: AuthError, payload: AddServer, success: ConnectionInfo}),
	Rpc.make('gateway.remove', {error: AuthError, payload: ServerParams})
).middleware(RpcAuth) {}
