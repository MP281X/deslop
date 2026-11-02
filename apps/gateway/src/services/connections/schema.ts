import {Schema} from 'effect'

export type ServerId = typeof ServerId.Type
export const ServerId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,23}$/u))

export type ServerUrl = typeof ServerUrl.Type
export const ServerUrl = Schema.NonEmptyString.check(
	Schema.isMaxLength(2048),
	Schema.makeFilter(
		(value: string) => {
			if (!URL.canParse(value)) return false
			const url = new URL(value)
			return url.protocol === 'https:' && url.username === '' && url.password === '' && url.hash === ''
		},
		{expected: 'a public HTTPS URL without credentials or a fragment'}
	)
)

export type AddServer = typeof AddServer.Type
export const AddServer = Schema.Struct({url: ServerUrl})
export type ServerParams = typeof ServerParams.Type
export const ServerParams = Schema.Struct({id: ServerId})
// One tool's visibility, so two quick toggles each change only their own tool.
export type ToolVisibility = typeof ToolVisibility.Type
export const ToolVisibility = Schema.Struct({hidden: Schema.Boolean, id: ServerId, tool: Schema.NonEmptyString})

export type Metadata = typeof Metadata.Type
export const Metadata = Schema.Struct({
	authorization_endpoint: Schema.NonEmptyString,
	authorization_response_iss_parameter_supported: Schema.optionalKey(Schema.Boolean),
	client_id_metadata_document_supported: Schema.optionalKey(Schema.Boolean),
	issuer: Schema.NonEmptyString,
	registration_endpoint: Schema.optionalKey(Schema.NonEmptyString),
	token_endpoint: Schema.NonEmptyString
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

// A public server takes no token; an OAuth server, the owner's apps included, the token the gateway holds.
export type Link = typeof Link.Type
export const Link = Schema.TaggedUnion({
	Authorized: {expiresAt: Schema.Finite, token: Token},
	Connected: {},
	Disconnected: {}
})

// An icon the server names for itself in its MCP server info, for a light or dark background, or either.
export type ServerIcon = typeof ServerIcon.Type
export const ServerIcon = Schema.Struct({
	src: Schema.String,
	theme: Schema.optionalKey(Schema.Literals(['light', 'dark']))
})

export type Connection = typeof Connection.Type
export const Connection = Schema.Struct({
	// Why the last connection or discovery failed, until one succeeds.
	error: Schema.optionalKey(Schema.String),
	generation: Schema.NonEmptyString,
	hidden: Schema.Array(Schema.String),
	icons: Schema.optionalKey(Schema.Array(ServerIcon)),
	id: ServerId,
	// The server's own instructions from its last discovery: the first sentence is its line in the gateway's instructions.
	instructions: Schema.optionalKey(Schema.String),
	link: Link,
	mode: Schema.Literals(['oauth', 'public']),
	name: Schema.NonEmptyString,
	oauth: Schema.optionalKey(OAuth),
	tools: Schema.Array(Schema.String),
	url: ServerUrl
})

export type ConnectionStore = typeof ConnectionStore.Type
export const ConnectionStore = Schema.Record(Schema.String, Connection)

export type ConnectionInfo = typeof ConnectionInfo.Type
export const ConnectionInfo = Schema.Struct({
	error: Schema.optionalKey(Schema.String),
	hidden: Schema.Array(Schema.String),
	icons: Schema.Array(ServerIcon),
	id: ServerId,
	name: Schema.NonEmptyString,
	status: Schema.Literals(['Connected', 'Not connected', 'Expired']),
	tools: Schema.Array(Schema.String),
	url: ServerUrl
})

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
