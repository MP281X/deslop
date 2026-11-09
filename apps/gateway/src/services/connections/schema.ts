import {Option, Result, Schema} from 'effect'

import {Url} from 'effect/http'

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
	access_token: Schema.NonEmptyString,
	expires_in: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThan(0))),
	refresh_token: Schema.optionalKey(Schema.NonEmptyString),
	token_type: Schema.String.check(Schema.isPattern(/^Bearer$/iu))
})

// How the gateway signs in to a provider: a client it registered there with its own callback, or its client metadata document, which needs the provider to name itself in every answer.
export type OAuth = typeof OAuth.Type
export const OAuth = Schema.Struct({
	client: Schema.TaggedUnion({Document: {}, Registered: {clientId: Schema.NonEmptyString}}),
	metadata: Metadata,
	scope: Schema.String
})

// Deslop servers take the caller's token; only third-party OAuth tokens are stored.
export type Link = typeof Link.Type
export const Link = Schema.TaggedUnion({
	Authorized: {expiresAt: Schema.Finite, token: Token},
	Connected: {},
	Disconnected: {}
})

export type ServerIcon = typeof ServerIcon.Type
export const ServerIcon = Schema.Struct({
	src: Schema.String,
	theme: Schema.optionalKey(Schema.Literals(['light', 'dark']))
})

export type Connection = typeof Connection.Type
export const Connection = Schema.Struct({
	error: Schema.optionalKey(Schema.String),
	generation: Schema.NonEmptyString,
	icons: Schema.optionalKey(Schema.Array(ServerIcon)),
	id: ServerId,
	instructions: Schema.optionalKey(Schema.String),
	link: Link,
	mode: Schema.Literals(['oauth', 'public', 'deslop']),
	name: Schema.NonEmptyString,
	oauth: Schema.optionalKey(OAuth),
	// The tools a server offers, by name; the descriptions a later discovery found, kept apart so older rows still read.
	toolDescriptions: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	tools: Schema.Array(Schema.String),
	url: ServerUrl
})

export type ConnectionStore = typeof ConnectionStore.Type
export const ConnectionStore = Schema.Record(Schema.String, Connection)

export type ToolInfo = typeof ToolInfo.Type
export const ToolInfo = Schema.Struct({description: Schema.optionalKey(Schema.String), name: Schema.NonEmptyString})

export type ConnectionInfo = typeof ConnectionInfo.Type
export const ConnectionInfo = Schema.Struct({
	error: Schema.optionalKey(Schema.String),
	icons: Schema.Array(ServerIcon),
	id: ServerId,
	name: Schema.NonEmptyString,
	status: Schema.Literals(['Connected', 'Not connected', 'Expired']),
	tools: Schema.Array(ToolInfo),
	url: ServerUrl
})

// What a discovery found: its tools and instructions clear an earlier failure; a failure keeps the last ones.
export type Discovery = typeof Discovery.Type
export const Discovery = Schema.TaggedUnion({
	Discovered: {
		icons: Schema.Array(ServerIcon),
		instructions: Schema.optionalKey(Schema.String),
		toolDescriptions: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
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
