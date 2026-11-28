import {Function, Option, Result, Schema, Struct, pipe} from 'effect'

import {Url} from 'effect/http'
import {Rpc, RpcGroup} from 'effect/rpc'
import {Model} from 'effect/schema'

import {AuthError, RpcAdmin, RpcAuth} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis, TimeFrame} from '@deslop/runtime/shared/time'

import {UsageRange} from '#usage/contract.ts'

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
export type McpUsageWindow = typeof McpUsageWindow.Type
export const McpUsageWindow = Schema.Struct({range: UsageRange, report: McpUsageReport})

export const ConnectionsRpcs = RpcGroup.make(
	Rpc.make('connections.add', {error: AuthError, payload: Schema.Struct({url: ServerUrl}), success: ConnectionItem}),
	Rpc.make('connections.usage', {error: AuthError, payload: TimeFrame, stream: true, success: McpUsageWindow}),
	Rpc.make('connections.watch', {error: AuthError, stream: true, success: Schema.Array(ConnectionItem)})
)
	.middleware(RpcAdmin)
	.middleware(RpcAuth)

export class UpstreamError extends Schema.TaggedError<UpstreamError>()('UpstreamError', {cause: Schema.Defect()}) {}

export type ConnectionGeneration = typeof ConnectionGeneration.Type
export const ConnectionGeneration = pipe(Schema.NonEmptyString, Schema.brand('ConnectionGeneration'))
// A failed upstream exchange reduced to a fixed reason before any log or span sees it, since an upstream's own text can carry a body or a token. Only a session the server no longer knows, or a refused bearer, proves the request never ran.
export class UpstreamExchangeError extends Schema.TaggedError<UpstreamExchangeError>()('UpstreamExchangeError', {
	expired: Schema.Boolean,
	reason: FailureReason,
	unauthorized: Schema.Boolean
}) {}

// One MCP server everyone with access shares, as its last discovery found it.
export class Connection extends Model.Class<Connection>('Connection')({
	error: Model.FieldOption(Model.JsonFromString(FailureReason)),
	// Made when the server is added: work begun for a server that was removed and added again never lands on the new one.
	generation: ConnectionGeneration,
	icons: Model.JsonFromString(Schema.Array(ServerIcon)),
	id: ServerId,
	instructions: Model.FieldOption(Schema.String),
	// A third-party server's authorization server, whose metadata each connection reads again, and the scope it asks for.
	issuer: Model.FieldOption(ServerUrl),
	mode: Schema.Literals(['oauth', 'public', 'deslop']),
	name: Schema.NonEmptyString,
	scope: Model.FieldOption(Schema.String),
	// How many tools the server lists.
	tools: Schema.Int,
	url: ServerUrl
}) {
	static readonly table = 'connections'
}

// One proxied tool call; the usage sweep deletes it after thirty days.
export class McpCall extends Model.Class<McpCall>('McpCall')({at: Schema.DateTimeUtcFromMillis, serverId: ServerId}) {
	static readonly table = 'mcp_calls'
}

// A server's row and its status as of the read.
export type ConnectionState = typeof ConnectionState.Type
export const ConnectionState = Schema.Struct({...Connection.fields, status: ConnectionStatus})

export type ServerReference = typeof ServerReference.Type
export const ServerReference = Schema.Struct(Struct.pick(ConnectionState.fields, ['id', 'generation', 'name', 'mode']))
export type ServerIdentity = typeof ServerIdentity.Type
export const ServerIdentity = Schema.Struct(Struct.pick(ConnectionState.fields, ['id', 'generation']))
export type ConnectionTarget = typeof ConnectionTarget.Type
export const ConnectionTarget = Schema.Struct(Struct.pick(Connection.fields, ['generation', 'id', 'name', 'url']))

// What a discovery found: its tools and instructions clear an earlier failure; a failure keeps the last ones.
export type Discovery = typeof Discovery.Type
export const Discovery = Schema.TaggedUnion({
	Discovered: {
		icons: Schema.Array(ServerIcon),
		instructions: Schema.OptionFromOptionalKey(Schema.String),
		tools: Schema.Array(Schema.String)
	},
	Failed: {error: FailureReason}
})
