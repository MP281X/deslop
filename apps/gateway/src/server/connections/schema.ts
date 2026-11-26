import {Schema, Struct, pipe} from 'effect'

import {Model} from 'effect/schema'

import {DateTimeUtcFromFiniteMillis, DurationFromSeconds} from '@deslop/runtime/shared/time'

import {ConnectionStatus, FailureReason, ServerIcon, ServerId, ServerUrl} from '#contracts'

export class UpstreamError extends Schema.TaggedError<UpstreamError>()('UpstreamError', {cause: Schema.Defect()}) {}

export type ConnectionGeneration = typeof ConnectionGeneration.Type
export const ConnectionGeneration = pipe(Schema.NonEmptyString, Schema.brand('ConnectionGeneration'))
export type OAuthClientId = typeof OAuthClientId.Type
export const OAuthClientId = pipe(Schema.NonEmptyString, Schema.brand('OAuthClientId'))
export type ConnectionOAuthState = typeof ConnectionOAuthState.Type
export const ConnectionOAuthState = pipe(Schema.NonEmptyString, Schema.brand('GatewayOAuthState'))
export type OAuthCode = typeof OAuthCode.Type
export const OAuthCode = pipe(Schema.NonEmptyString, Schema.brand('GatewayOAuthCode'))

export type ServerParams = typeof ServerParams.Type
export const ServerParams = Schema.Struct({id: ServerId})

export type ServerMetadata = typeof ServerMetadata.Type
export const ServerMetadata = Schema.Struct({
	authorization_endpoint: ServerUrl,
	authorization_response_iss_parameter_supported: Schema.OptionFromOptionalKey(Schema.Boolean),
	client_id_metadata_document_supported: Schema.OptionFromOptionalKey(Schema.Boolean),
	code_challenge_methods_supported: Schema.OptionFromOptionalKey(Schema.Array(Schema.String)),
	issuer: ServerUrl,
	registration_endpoint: Schema.OptionFromOptionalKey(ServerUrl),
	response_types_supported: Schema.OptionFromOptionalKey(Schema.Array(Schema.String)),
	token_endpoint: ServerUrl
})

export type Registration = typeof Registration.Type
export const Registration = Schema.Struct({client_id: OAuthClientId})
export type Token = typeof Token.Type
export const Token = Schema.Struct({
	access_token: Schema.RedactedFromValue(Schema.NonEmptyString),
	expires_in: Schema.OptionFromOptionalKey(
		pipe(Schema.Finite.check(Schema.isGreaterThan(0)), Schema.decodeTo(DurationFromSeconds))
	),
	refresh_token: Schema.OptionFromOptionalKey(Schema.RedactedFromValue(Schema.NonEmptyString)),
	token_type: Schema.String.check(Schema.isPattern(/^Bearer$/iu))
})

// How the gateway signs in to a provider while a connection is in progress: a client it registered there with its own callback, or its client metadata document, which needs the provider to name itself in every answer.
export type OAuthClient = typeof OAuthClient.Type
export const OAuthClient = Schema.TaggedUnion({Document: {}, Registered: {clientId: OAuthClientId}})

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

// A third-party server's authorization: the tokens its provider issued, and the client and endpoint that renew them.
export class ConnectionGrant extends Model.Class<ConnectionGrant>('ConnectionGrant')({
	accessToken: Model.Sensitive(Token.fields.access_token),
	clientId: OAuthClientId,
	// Epoch milliseconds; zero once the provider refused to renew it.
	expiresAt: DateTimeUtcFromFiniteMillis,
	refreshToken: Model.FieldOption(Model.Sensitive(Token.fields.access_token)),
	serverId: ServerId,
	tokenEndpoint: ServerUrl
}) {
	static readonly table = 'connection_grants'
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
export type ConnectionAddress = typeof ConnectionAddress.Type
export const ConnectionAddress = Schema.Struct(Struct.pick(Connection.fields, ['generation', 'id', 'url']))
export type ConnectionIssuer = typeof ConnectionIssuer.Type
export const ConnectionIssuer = Schema.Struct(Struct.pick(ConnectionGrant.fields, ['clientId', 'tokenEndpoint']))
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

export type Callback = typeof Callback.Type
export const Callback = Schema.Struct({
	code: Schema.OptionFromOptionalKey(OAuthCode),
	error: Schema.OptionFromOptionalKey(Schema.String),
	iss: Schema.OptionFromOptionalKey(Schema.NonEmptyString),
	state: ConnectionOAuthState
})

export type TokenExchange = typeof TokenExchange.Type
export const TokenExchange = Schema.Union([
	Schema.Struct({
		code: OAuthCode,
		code_verifier: Schema.String,
		grant_type: Schema.Literal('authorization_code'),
		redirect_uri: Schema.String
	}),
	Schema.Struct({grant_type: Schema.Literal('refresh_token'), refresh_token: Schema.String})
])
