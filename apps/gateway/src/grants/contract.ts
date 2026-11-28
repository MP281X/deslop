import {Effect, Option, Schema, Struct, pipe} from 'effect'

import {Model} from 'effect/schema'

import {AuthError} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis, DurationFromSeconds} from '@deslop/runtime/shared/time'

import {Connection, ServerId, ServerUrl} from '#connections/contract.ts'

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

export type ConnectionAddress = typeof ConnectionAddress.Type
export const ConnectionAddress = Schema.Struct(Struct.pick(Connection.fields, ['generation', 'id', 'url']))
export type ConnectionIssuer = typeof ConnectionIssuer.Type
export const ConnectionIssuer = Schema.Struct(Struct.pick(ConnectionGrant.fields, ['clientId', 'tokenEndpoint']))

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

// A provider that registers clients gets one per connection, with that server's own callback; otherwise it must name itself in its answers.
export function connectable(metadata: ServerMetadata) {
	if (
		Option.isSome(metadata.registration_endpoint) ||
		(Option.contains(metadata.client_id_metadata_document_supported, true) &&
			Option.contains(metadata.authorization_response_iss_parameter_supported, true))
	) {
		return Effect.void
	}
	return Effect.fail(
		AuthError.make({
			message:
				'This provider neither registers clients nor names itself in its answers, so the gateway cannot connect to it safely.'
		})
	)
}
