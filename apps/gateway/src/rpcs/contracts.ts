import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {AuthError, RpcAdmin, RpcAuth} from '@deslop/runtime/shared/auth'
import {TimeFrame} from '@deslop/runtime/shared/time'

import {AiUsageReport} from '#services/ai-metering/schema.ts'
import {AiKeyItem, AiSetKey} from '#services/ai-proxy/schema.ts'
import {AddServer, ConnectionItem, McpUsageReport} from '#services/connections/schema.ts'
import {UsageRange} from '#services/usage/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('ai-proxy.key', {error: AuthError, stream: true, success: Schema.Array(AiKeyItem)}),
	Rpc.make('ai-proxy.setKey', {error: AuthError, payload: AiSetKey}),
	Rpc.make('ai-metering.usage', {
		error: AuthError,
		payload: TimeFrame,
		stream: true,
		success: Schema.Struct({range: UsageRange, report: AiUsageReport})
	}),
	Rpc.make('connections.add', {error: AuthError, payload: AddServer, success: ConnectionItem}).middleware(RpcAdmin),
	Rpc.make('connections.usage', {
		error: AuthError,
		payload: TimeFrame,
		stream: true,
		success: Schema.Struct({range: UsageRange, report: McpUsageReport})
	}).middleware(RpcAdmin),
	Rpc.make('connections.watch', {error: AuthError, stream: true, success: Schema.Array(ConnectionItem)}).middleware(
		RpcAdmin
	)
).middleware(RpcAuth) {}
