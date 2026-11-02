// fallow-ignore-file unused-type -- Schema types pair with their values so consumers can import either.
import {Schema} from 'effect'

export class AuthError extends Schema.TaggedError<AuthError>()('AuthError', {
	cause: Schema.optional(Schema.Defect()),
	error: Schema.optionalKey(
		Schema.Literals([
			'invalid_request',
			'invalid_client',
			'invalid_client_metadata',
			'invalid_redirect_uri',
			'invalid_grant',
			'invalid_target',
			'invalid_scope',
			'unsupported_grant_type',
			'unsupported_response_type',
			'access_denied',
			'temporarily_unavailable'
		])
	),
	message: Schema.String
}) {}

export type User = typeof User.Type
export const User = Schema.Struct({id: Schema.NonEmptyString, name: Schema.NonEmptyString})

export type Resource = typeof Resource.Type
// An app or its MCP endpoint on the domain the shared sign-in cookie covers.
export const Resource = Schema.String.check(Schema.isPattern(/^https:\/\/[a-z\d-]+\.mp281x\.xyz(?:\/mcp)?$/u))

export type Credentials = typeof Credentials.Type
export const Credentials = Schema.Struct({
	accessToken: Schema.NonEmptyString,
	clientId: Schema.NonEmptyString,
	expiresAt: Schema.Finite,
	refreshToken: Schema.NonEmptyString
})

export type ClientRegistration = typeof ClientRegistration.Type
export const ClientRegistration = Schema.Struct({client_id: Schema.NonEmptyString})

export type TokenResponse = typeof TokenResponse.Type
export const TokenResponse = Schema.Struct({
	access_token: Schema.NonEmptyString,
	expires_in: Schema.Finite,
	refresh_token: Schema.NonEmptyString
})
