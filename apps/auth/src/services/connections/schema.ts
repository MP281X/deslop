import {Schema} from 'effect'

import {AUTH_URL} from '@deslop/runtime/auth/utils'

export type ServerId = typeof ServerId.Type
export const ServerId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,23}$/u))

export type ServerUrl = typeof ServerUrl.Type
export const ServerUrl = Schema.NonEmptyString.check(
	Schema.isMaxLength(2048),
	Schema.makeFilter(
		(value: string) => {
			if (!URL.canParse(value)) return false
			const url = new URL(value)
			return (
				url.protocol === 'https:' &&
				url.username === '' &&
				url.password === '' &&
				url.hash === '' &&
				url.origin !== AUTH_URL
			)
		},
		{expected: 'a public HTTPS MCP URL without credentials or a fragment, outside Auth itself'}
	)
)

export type AddServer = typeof AddServer.Type
export const AddServer = Schema.Struct({url: ServerUrl})
export type ServerParams = typeof ServerParams.Type
export const ServerParams = Schema.Struct({id: ServerId})

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

export type Connection = typeof Connection.Type
export const Connection = Schema.Struct({
	clientId: Schema.optionalKey(Schema.NonEmptyString),
	enabled: Schema.Boolean,
	expiresAt: Schema.Finite,
	generation: Schema.NonEmptyString,
	id: ServerId,
	metadata: Schema.optionalKey(Metadata),
	mode: Schema.Literals(['deslop', 'oauth', 'public']),
	name: Schema.NonEmptyString,
	scope: Schema.String,
	token: Schema.optionalKey(Token),
	tools: Schema.optionalKey(Schema.Int),
	url: ServerUrl
})

export type ConnectionInfo = typeof ConnectionInfo.Type
export const ConnectionInfo = Schema.Struct({
	connected: Schema.Boolean,
	id: ServerId,
	name: Schema.NonEmptyString,
	status: Schema.Literals(['Connected', 'Not connected', 'Expired']),
	tools: Schema.optionalKey(Schema.Int),
	url: ServerUrl
})

export type Pending = typeof Pending.Type
export const Pending = Schema.Struct({
	expiresAt: Schema.Finite,
	id: ServerId,
	userId: Schema.NonEmptyString,
	verifier: Schema.NonEmptyString
})

export type ConnectionState = typeof ConnectionState.Type
export const ConnectionState = Schema.Struct({
	connections: Schema.Record(Schema.String, Connection),
	pending: Schema.Record(Schema.String, Pending)
})

export type Callback = typeof Callback.Type
export const Callback = Schema.Struct({
	code: Schema.optionalKey(Schema.NonEmptyString),
	error: Schema.optionalKey(Schema.String),
	iss: Schema.optionalKey(Schema.NonEmptyString),
	state: Schema.NonEmptyString
})
