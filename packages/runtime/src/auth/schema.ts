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
			'authorization_pending',
			'expired_token',
			'temporarily_unavailable'
		])
	),
	message: Schema.String
}) {}

export type User = typeof User.Type
export const User = Schema.Struct({id: Schema.NonEmptyString, name: Schema.NonEmptyString})

// What Auth signs into every access token: the person, the client that asked and the sign-in it belongs to, valid at every Deslop app for ten minutes.
export type AccessClaims = typeof AccessClaims.Type
export const AccessClaims = Schema.Struct({
	aud: Schema.Literal('deslop'),
	azp: Schema.NonEmptyString,
	exp: Schema.Int,
	iat: Schema.Int,
	iss: Schema.NonEmptyString,
	name: Schema.NonEmptyString,
	sid: Schema.NonEmptyString,
	sub: Schema.NonEmptyString
})

// A registered client is its own id: the name and callbacks it registered, so registration stores nothing.
export type ClientInfo = typeof ClientInfo.Type
export const ClientInfo = Schema.Struct({
	name: Schema.String,
	redirects: Schema.NonEmptyArray(Schema.NonEmptyString.check(Schema.isMaxLength(200))).check(Schema.isMaxLength(4))
})

// A sign-in's authorization code with what Auth checks it against, which an iOS app hands its server to exchange.
export type CodeGrant = typeof CodeGrant.Type
export const CodeGrant = Schema.Struct({
	client_id: Schema.NonEmptyString,
	code: Schema.NonEmptyString,
	code_verifier: Schema.NonEmptyString,
	redirect_uri: Schema.NonEmptyString
})

// What an app's server answers an iOS sign-in with, and all the phone keeps: the id of its session there.
export type SessionHandle = typeof SessionHandle.Type
export const SessionHandle = Schema.Struct({session: Schema.NonEmptyString})

export type TokenResponse = typeof TokenResponse.Type
export const TokenResponse = Schema.Struct({
	access_token: Schema.NonEmptyString,
	expires_in: Schema.Finite,
	refresh_token: Schema.NonEmptyString
})
