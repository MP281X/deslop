import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {AuthError, RpcAuth} from '@deslop/runtime/shared/auth'

import {AiKey, AiSetKey, AiUsageReport} from '#services/ai-proxy/schema.ts'
import {AddServer, ConnectionItem, McpUsageReport} from '#services/connections/schema.ts'
import {Period, UsageRange} from '#services/usage/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('ai-proxy.list', {error: AuthError, success: Schema.Array(AiKey.json)}),
	Rpc.make('ai-proxy.setKey', {error: AuthError, payload: AiSetKey}),
	Rpc.make('ai-proxy.usage', {
		error: AuthError,
		payload: Period,
		stream: true,
		success: Schema.Struct({range: UsageRange, report: AiUsageReport})
	}),
	Rpc.make('connections.add', {error: AuthError, payload: AddServer, success: ConnectionItem}),
	Rpc.make('connections.usage', {
		error: AuthError,
		payload: Period,
		stream: true,
		success: Schema.Struct({range: UsageRange, report: McpUsageReport})
	}),
	Rpc.make('connections.watch', {error: AuthError, stream: true, success: Schema.Array(ConnectionItem)})
).middleware(RpcAuth) {}
