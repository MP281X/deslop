import {Context, Effect, Schema, pipe} from 'effect'

import {ClientInfo, User} from '@deslop/runtime/shared/auth'

// Credentials retain the registration that issued them, never a later membership with the same GitHub id.
export type CredentialOwner = typeof CredentialOwner.Type
export const CredentialOwner = Schema.Struct({incarnation: Schema.NonEmptyString, user: User})

export class CurrentOwner extends Context.Service<CurrentOwner, CredentialOwner>()(
	'@deslop/auth/services/tokens/schema/CurrentOwner'
) {}

// Only records from the immediately previous release may omit their incarnation.
export type StoredOwner = typeof StoredOwner.Type
export const StoredOwner = Schema.Struct({
	...CredentialOwner.fields,
	incarnation: pipe(Schema.NonEmptyString, Schema.withDecodingDefaultKey(Effect.succeed('legacy')))
})

export type Registration = typeof Registration.Type
export const Registration = Schema.Struct({
	client_name: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(100))),
	redirect_uris: ClientInfo.fields.redirects,
	token_endpoint_auth_method: Schema.optionalKey(Schema.Literal('none'))
})

// What an authorization request must carry before the server may send any answer to its callback.
export type AuthorizeClient = typeof AuthorizeClient.Type
export const AuthorizeClient = Schema.Struct({
	client_id: Schema.NonEmptyString.check(Schema.isMaxLength(2048)),
	redirect_uri: Schema.optionalKey(Schema.String),
	state: Schema.optionalKey(Schema.String)
})

// The rest is checked field by field, so each failure returns its own OAuth error to the callback.
export type AuthorizeParams = typeof AuthorizeParams.Type
export const AuthorizeParams = Schema.Struct({
	code_challenge: Schema.optionalKey(Schema.NonEmptyString),
	code_challenge_method: Schema.optionalKey(Schema.String),
	response_type: Schema.optionalKey(Schema.String),
	scope: Schema.optionalKey(Schema.String)
})

export type ClientRequest = typeof ClientRequest.Type
export const ClientRequest = Schema.Struct({
	challenge: Schema.NonEmptyString,
	clientId: Schema.NonEmptyString,
	clientName: Schema.String,
	parent: Schema.optionalKey(Schema.NonEmptyString),
	redirectUri: Schema.NonEmptyString,
	state: Schema.optionalKey(Schema.NonEmptyString)
})

export type DeviceRequest = typeof DeviceRequest.Type
export const DeviceRequest = Schema.Struct({clientId: Schema.NonEmptyString, clientName: Schema.String})

// RFC 8628 §3.1.
export type DeviceParams = typeof DeviceParams.Type
export const DeviceParams = Schema.Struct({
	client_id: Schema.NonEmptyString.check(Schema.isMaxLength(2048)),
	scope: Schema.optionalKey(Schema.String)
})

export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

// RFC 8628 §3.4.
export type DeviceTokenParams = typeof DeviceTokenParams.Type
export const DeviceTokenParams = Schema.Struct({
	client_id: Schema.NonEmptyString,
	device_code: Schema.NonEmptyString,
	grant_type: Schema.Literal(DEVICE_GRANT)
})

export type TokenGrant = typeof TokenGrant.Type
export const TokenGrant = Schema.Struct({grant_type: Schema.String})

// OAuth 2.1 drops redirect_uri from the code exchange, and a public client may leave client_id out of a refresh; each is checked when sent.
export type TokenParams = typeof TokenParams.Type
export const TokenParams = Schema.Union([
	Schema.Struct({
		client_id: Schema.NonEmptyString,
		code: Schema.NonEmptyString,
		code_verifier: Schema.NonEmptyString,
		grant_type: Schema.Literal('authorization_code'),
		redirect_uri: Schema.optionalKey(Schema.String)
	}),
	Schema.Struct({
		client_id: Schema.optionalKey(Schema.String),
		grant_type: Schema.Literal('refresh_token'),
		refresh_token: Schema.NonEmptyString
	})
])

export type TokenResponse = typeof TokenResponse.Type
export const TokenResponse = Schema.Struct({
	access_token: Schema.NonEmptyString,
	expires_in: Schema.Finite,
	refresh_token: Schema.NonEmptyString,
	scope: Schema.Literal('deslop'),
	token_type: Schema.Literal('Bearer')
})

// A replayed grant still revokes its family, so the token endpoint answers it as a result rather than a failure.
export type Exchange = typeof Exchange.Type
export const Exchange = Schema.TaggedUnion({Granted: {tokens: TokenResponse}, Replayed: {message: Schema.String}})

// Where a request came from, as Traefik and the client report it; it names a sign-in, it never proves one.
export type Origin = typeof Origin.Type
export const Origin = Schema.Struct({
	address: Schema.optionalKey(Schema.String),
	userAgent: Schema.optionalKey(Schema.String)
})

// How a browser signed in: GitHub and a passkey prove the owner's browser; a code may have been approved for someone else's.
export type SessionVia = typeof SessionVia.Type
export const SessionVia = Schema.Literals(['Code', 'GitHub', 'Passkey'])

// Only the address a sign-in came from is read again; the user agent labels it when it is made.
export type StoredOrigin = typeof StoredOrigin.Type
export const StoredOrigin = Schema.Struct({address: Schema.optionalKey(Schema.String)})

export type Grant = typeof Grant.Type
export const Grant = Schema.Struct({
	...CredentialOwner.fields,
	client: Schema.String,
	credential: Schema.TaggedUnion({
		// Keep every spent refresh token's hash until the family ends.
		App: {
			clientId: Schema.NonEmptyString,
			expiresAt: Schema.Finite,
			generation: Schema.Int,
			hash: Schema.String,
			replaced: Schema.Array(Schema.String)
		},
		Browser: {expiresAt: Schema.Finite, hash: Schema.String, via: SessionVia}
	}),
	device: Schema.String,
	lastActive: Schema.Finite,
	origin: StoredOrigin,
	parent: Schema.optionalKey(Schema.NonEmptyString)
})

export type Grants = typeof Grants.Type
export const Grants = Schema.Record(Schema.String, Grant)

export type SignedInApp = typeof SignedInApp.Type
export const SignedInApp = Schema.Struct({
	address: Schema.optionalKey(Schema.String),
	client: Schema.String,
	device: Schema.String,
	family: Schema.NonEmptyString,
	kind: Schema.Literals(['App', 'Browser']),
	lastActive: Schema.Finite,
	parent: Schema.optionalKey(Schema.NonEmptyString)
})

export type RevokeParams = typeof RevokeParams.Type
export const RevokeParams = Schema.Struct({client_id: Schema.NonEmptyString, token: Schema.NonEmptyString})
