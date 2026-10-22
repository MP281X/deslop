// fallow-ignore-file unused-type -- Schema types pair with their values so consumers can import either.
import {Schema} from 'effect'

export class AuthError extends Schema.TaggedError<AuthError>()('AuthError', {
	cause: Schema.optional(Schema.Defect()),
	error: Schema.optionalKey(
		Schema.Literals([
			'invalid_request',
			'invalid_client',
			'invalid_grant',
			'invalid_target',
			'invalid_scope',
			'access_denied'
		])
	),
	message: Schema.String
}) {}

export type User = typeof User.Type
export const User = Schema.Struct({id: Schema.NonEmptyString, name: Schema.NonEmptyString})

export type Resource = typeof Resource.Type
export const Resource = Schema.Literals([
	'https://stash.mp281x.xyz',
	'https://stash.mp281x.xyz/mcp',
	'https://opm.mp281x.xyz',
	'https://scope.mp281x.xyz/mcp',
	'https://otel.mp281x.xyz'
])

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
