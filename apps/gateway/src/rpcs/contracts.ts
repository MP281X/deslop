import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {AuthError, RpcAuth} from '@deslop/runtime/shared/auth'

import {AiKey, AiSetKey, AiUsageReport} from '#services/ai/schema.ts'
import {AddServer, ConnectionInfo, McpUsageReport} from '#services/connections/schema.ts'
import {Period, UsageRange} from '#services/usage/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('ai.keys', {error: AuthError, success: Schema.Array(AiKey.json)}),
	Rpc.make('ai.setKey', {error: AuthError, payload: AiSetKey}),
	Rpc.make('ai.usage', {
		error: AuthError,
		payload: Period,
		stream: true,
		success: Schema.Struct({range: UsageRange, report: AiUsageReport})
	}),
	Rpc.make('connections.add', {error: AuthError, payload: AddServer, success: ConnectionInfo}),
	Rpc.make('connections.usage', {
		error: AuthError,
		payload: Period,
		stream: true,
		success: Schema.Struct({range: UsageRange, report: McpUsageReport})
	}),
	Rpc.make('connections.watch', {error: AuthError, stream: true, success: Schema.Array(ConnectionInfo)})
).middleware(RpcAuth) {}
