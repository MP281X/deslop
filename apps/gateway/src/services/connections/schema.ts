import {Option, Result, Schema, Struct} from 'effect'

import {Url} from 'effect/http'
import {Model} from 'effect/schema'

export class UpstreamError extends Schema.TaggedError<UpstreamError>()('UpstreamError', {cause: Schema.Defect()}) {}

export type ServerId = typeof ServerId.Type
export const ServerId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,23}$/u))

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

export type AddServer = typeof AddServer.Type
export const AddServer = Schema.Struct({url: ServerUrl})
export type ServerParams = typeof ServerParams.Type
export const ServerParams = Schema.Struct({id: ServerId})

export type Metadata = typeof Metadata.Type
export const Metadata = Schema.Struct({
	authorization_endpoint: ServerUrl,
	authorization_response_iss_parameter_supported: Schema.optionalKey(Schema.Boolean),
	client_id_metadata_document_supported: Schema.optionalKey(Schema.Boolean),
	code_challenge_methods_supported: Schema.optionalKey(Schema.Array(Schema.String)),
	issuer: ServerUrl,
	registration_endpoint: Schema.optionalKey(ServerUrl),
	response_types_supported: Schema.optionalKey(Schema.Array(Schema.String)),
	token_endpoint: ServerUrl
})

export type Registration = typeof Registration.Type
export const Registration = Schema.Struct({client_id: Schema.NonEmptyString})
export type Token = typeof Token.Type
export const Token = Schema.Struct({
	access_token: Schema.RedactedFromValue(Schema.NonEmptyString),
	expires_in: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThan(0))),
	refresh_token: Schema.optionalKey(Schema.RedactedFromValue(Schema.NonEmptyString)),
	token_type: Schema.String.check(Schema.isPattern(/^Bearer$/iu))
})

// How the gateway signs in to a provider while a connection is in progress: a client it registered there with its own callback, or its client metadata document, which needs the provider to name itself in every answer.
export type OAuthClient = typeof OAuthClient.Type
export const OAuthClient = Schema.TaggedUnion({Document: {}, Registered: {clientId: Schema.NonEmptyString}})

export type ServerIcon = typeof ServerIcon.Type
export const ServerIcon = Schema.Struct({
	src: Schema.String,
	theme: Schema.optionalKey(Schema.Literals(['light', 'dark']))
})

// Deslop servers take the caller's token and public ones none, so only a third-party server needs a grant; one without a refresh token cannot be renewed once it expires.
export type ConnectionStatus = typeof ConnectionStatus.Type
export const ConnectionStatus = Schema.Literals(['Connected', 'Not connected', 'Expired'])

// One MCP server everyone with access shares, as its last discovery found it.
export class Connection extends Model.Class<Connection>('Connection')({
	error: Model.FieldOption(Schema.String),
	// Made when the server is added: work begun for a server that was removed and added again never lands on the new one.
	generation: Schema.NonEmptyString,
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

// A third-party server's authorization: the tokens its provider issued, and the client and endpoint that renew them.
export class ConnectionGrant extends Model.Class<ConnectionGrant>('ConnectionGrant')({
	accessToken: Model.Sensitive(Token.fields.access_token),
	clientId: Schema.NonEmptyString,
	// Epoch milliseconds; zero once the provider refused to renew it.
	expiresAt: Schema.Finite,
	refreshToken: Model.FieldOption(Model.Sensitive(Token.fields.access_token)),
	serverId: ServerId,
	tokenEndpoint: ServerUrl
}) {
	static readonly table = 'connection_grants'
}

// A server's proxied tool calls in one hour; the page sums the hours into the bar's period, and an hour older than its longest period goes.
export class ConnectionCalls extends Model.Class<ConnectionCalls>('ConnectionCalls')({
	calls: Schema.Int,
	hour: Schema.Int,
	serverId: ServerId
}) {
	static readonly table = 'connection_calls'
}

// A server's row and its status as of the read.
export type ConnectionState = typeof ConnectionState.Type
export const ConnectionState = Schema.Struct({...Connection.fields, status: ConnectionStatus})

// A server as the page shows it.
export type ConnectionItem = typeof ConnectionItem.Type
export const ConnectionItem = Schema.Struct({
	...Struct.pick(Connection.json.fields, ['error', 'icons', 'id', 'name', 'tools', 'url']),
	status: ConnectionStatus
})

export type McpUsageBucket = typeof McpUsageBucket.Type
export const McpUsageBucket = Schema.Struct({at: Schema.Finite, calls: Schema.Int})
export type McpUsageServer = typeof McpUsageServer.Type
export const McpUsageServer = Schema.Struct({id: ServerId, series: Schema.Array(McpUsageBucket)})
export type McpUsageReport = typeof McpUsageReport.Type
export const McpUsageReport = Schema.Array(McpUsageServer)

// What a discovery found: its tools and instructions clear an earlier failure; a failure keeps the last ones.
export type Discovery = typeof Discovery.Type
export const Discovery = Schema.TaggedUnion({
	Discovered: {
		icons: Schema.Array(ServerIcon),
		instructions: Schema.optionalKey(Schema.String),
		tools: Schema.Array(Schema.String)
	},
	Failed: {error: Schema.String}
})

export type Callback = typeof Callback.Type
export const Callback = Schema.Struct({
	code: Schema.optionalKey(Schema.NonEmptyString),
	error: Schema.optionalKey(Schema.String),
	iss: Schema.optionalKey(Schema.NonEmptyString),
	state: Schema.NonEmptyString
})
