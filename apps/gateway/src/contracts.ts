import {Function, Option, Result, Schema, String, pipe} from 'effect'

import {Url} from 'effect/http'
import {Rpc, RpcGroup} from 'effect/rpc'
import {Model} from 'effect/schema'

import {AuthError, RpcAdmin, RpcAuth} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis, DurationFromFiniteMillis, TimeFrame} from '@deslop/runtime/shared/time'

export const KEY_MESSAGE = 'Enter an OpenCode (oc_sk_), Anthropic (sk-ant-), or OpenAI (sk-) key.'
export type AiProvider = typeof AiProvider.Type
export const AiProvider = Schema.Literals(['opencode', 'anthropic', 'openai'])
export type AiKeySecret = typeof AiKeySecret.Type
export const AiKeySecret = Schema.String.check(
	Schema.isPattern(/^(?:oc_sk_|sk-)[A-Za-z0-9_-]+$/u, {message: KEY_MESSAGE})
)

export function keyProvider(secret: AiKeySecret): AiProvider {
	if (String.startsWith('oc_sk_')(secret)) return 'opencode'
	if (String.startsWith('sk-ant-')(secret)) return 'anthropic'
	return 'openai'
}

export type AiSetKey = typeof AiSetKey.Type
export const AiSetKey = Schema.Struct({secret: Schema.RedactedFromValue(AiKeySecret)})

export type AiKeyItem = typeof AiKeyItem.Type
export const AiKeyItem = Schema.Struct({
	last4: Schema.String,
	lastStatus: Schema.OptionFromNullOr(Schema.Int),
	provider: AiProvider
})

export type ServerId = typeof ServerId.Type
export const ServerId = pipe(
	Schema.String,
	Schema.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,23}$/u)),
	Schema.brand('ServerId')
)

export type ServerUrl = typeof ServerUrl.Type
export const ServerUrl = Schema.NonEmptyString.check(
	Schema.isMaxLength(2048),
	Schema.makeFilter(
		(value: string) =>
			Option.exists(
				Result.getSuccess(Url.fromString(value)),
				url => url.protocol === 'https:' && url.username === '' && url.password === '' && url.hash === ''
			),
		{expected: 'a public HTTPS URL without credentials or a fragment'}
	)
)

export type ServerIcon = typeof ServerIcon.Type
export const ServerIcon = Schema.Struct({
	src: Schema.String,
	theme: Schema.OptionFromOptionalKey(Schema.Literals(['light', 'dark']))
})

export type ConnectionStatus = typeof ConnectionStatus.Type
// Deslop servers take the caller's token and public ones none, so only a third-party server needs a grant; one without a refresh token cannot be renewed once it expires.
export const ConnectionStatus = Schema.Literals(['Connected', 'Not connected', 'Expired'])

export type FailureReason = typeof FailureReason.Type
export const FailureReason = Schema.TaggedUnion({
	HttpStatus: {code: Schema.Int},
	Refused: {},
	Timeout: {},
	Unauthorized: {},
	Unavailable: {},
	Unknown: {}
})

export function failureMessage(reason: FailureReason) {
	return FailureReason.match(reason, {
		HttpStatus: value => `It answered HTTP ${value.code}`,
		Refused: Function.constant('The connection was refused'),
		Timeout: Function.constant('It did not answer in time'),
		Unauthorized: Function.constant('Authorization was refused'),
		Unavailable: Function.constant('Connection unavailable'),
		Unknown: Function.constant('It failed for an unknown reason')
	})
}

// A server as the page shows it.
export type ConnectionItem = typeof ConnectionItem.Type
export const ConnectionItem = Schema.Struct({
	error: Model.optionalOption(FailureReason),
	icons: Schema.Array(ServerIcon),
	id: ServerId,
	name: Schema.NonEmptyString,
	status: ConnectionStatus,
	tools: Schema.Int,
	url: ServerUrl
})

type McpUsageBucket = typeof McpUsageBucket.Type
const McpUsageBucket = Schema.Struct({at: DateTimeUtcFromFiniteMillis, calls: Schema.Int})
export type McpUsageServer = typeof McpUsageServer.Type
export const McpUsageServer = Schema.Struct({id: ServerId, series: Schema.Array(McpUsageBucket)})
export type McpUsageReport = typeof McpUsageReport.Type
export const McpUsageReport = Schema.Array(McpUsageServer)

export type UsageRange = typeof UsageRange.Type
export const UsageRange = Schema.Struct({
	count: Schema.Finite,
	from: DateTimeUtcFromFiniteMillis,
	size: DurationFromFiniteMillis,
	to: DateTimeUtcFromFiniteMillis
})

export type SpendSource = typeof SpendSource.Type
export const SpendSource = Schema.Literals(['balance', 'byok', 'openai', 'free', 'go', 'go-plus'])

export type AiUsageBreakdown = typeof AiUsageBreakdown.Type
export const AiUsageBreakdown = Schema.Struct({
	costUsd: Schema.Finite,
	estimatedCalls: Schema.Finite,
	spendSource: SpendSource,
	unknownCostCalls: Schema.Finite
})
export type AiUsageReport = typeof AiUsageReport.Type
export const AiUsageReport = Schema.Struct({
	series: Schema.Array(Schema.Struct({at: DateTimeUtcFromFiniteMillis, ...AiUsageBreakdown.fields})),
	totals: Schema.Array(AiUsageBreakdown)
})

export type AiUsageWindow = typeof AiUsageWindow.Type
export const AiUsageWindow = Schema.Struct({range: UsageRange, report: AiUsageReport})
export type McpUsageWindow = typeof McpUsageWindow.Type
export const McpUsageWindow = Schema.Struct({range: UsageRange, report: McpUsageReport})

export const AiProxyRpcs = RpcGroup.make(
	Rpc.make('ai-proxy.key', {error: AuthError, stream: true, success: Schema.Array(AiKeyItem)}),
	Rpc.make('ai-proxy.setKey', {error: AuthError, payload: AiSetKey})
).middleware(RpcAuth)

export const AiMeteringRpcs = RpcGroup.make(
	Rpc.make('ai-metering.usage', {error: AuthError, payload: TimeFrame, stream: true, success: AiUsageWindow})
).middleware(RpcAuth)

export const ConnectionRpcs = RpcGroup.make(
	Rpc.make('connections.add', {error: AuthError, payload: Schema.Struct({url: ServerUrl}), success: ConnectionItem}),
	Rpc.make('connections.usage', {error: AuthError, payload: TimeFrame, stream: true, success: McpUsageWindow}),
	Rpc.make('connections.watch', {error: AuthError, stream: true, success: Schema.Array(ConnectionItem)})
)
	.middleware(RpcAdmin)
	.middleware(RpcAuth)

export const GatewayRpcs = AiProxyRpcs.merge(AiMeteringRpcs, ConnectionRpcs)
