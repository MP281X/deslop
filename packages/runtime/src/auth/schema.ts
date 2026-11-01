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

export const DEFAULT_RESOURCES = [
	'https://gateway.mp281x.xyz',
	'https://gateway.mp281x.xyz/mcp',
	'https://stash.mp281x.xyz',
	'https://stash.mp281x.xyz/mcp',
	'https://opm.mp281x.xyz',
	'https://scope.mp281x.xyz',
	'https://scope.mp281x.xyz/mcp',
	'https://signal.mp281x.xyz',
	'https://signal.mp281x.xyz/mcp',
	'https://otel.mp281x.xyz',
	'https://auth.mp281x.xyz/mcp',
	'https://trips.mp281x.xyz',
	'https://trips.mp281x.xyz/mcp'
] as const

export type Resource = typeof Resource.Type
export const Resource = Schema.String.check(Schema.isMaxLength(2048), Schema.isPattern(/^https:\/\/[^\s@?#]+$/u))

export type EnrollmentRequest = typeof EnrollmentRequest.Type
export const EnrollmentRequest = Schema.Struct({
	name: Schema.NonEmptyString.check(Schema.isMaxLength(100)),
	resource: Resource.check(Schema.isPattern(/^https:\/\/[^/]+$/u))
})

export type Enrollment = typeof Enrollment.Type
export const Enrollment = Schema.Struct({
	...EnrollmentRequest.fields,
	approvedBy: Schema.String,
	createdAt: Schema.Finite,
	id: Schema.NonEmptyString,
	status: Schema.Literals(['pending', 'approved', 'denied'])
})

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
