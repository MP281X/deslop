import {Schema} from 'effect'

import {Resource, User} from '@deslop/runtime/auth/schema'

export type Registration = typeof Registration.Type
export const Registration = Schema.Struct({
	client_name: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(100))),
	// Anyone can register, and every client stays in the saved state, so a registration stays small.
	redirect_uris: Schema.NonEmptyArray(Schema.NonEmptyString.check(Schema.isMaxLength(200))).check(
		Schema.isMaxLength(4)
	),
	token_endpoint_auth_method: Schema.optionalKey(Schema.Literal('none'))
})

// What an authorization request must carry before the server may send any answer to its callback.
export type AuthorizeClient = typeof AuthorizeClient.Type
export const AuthorizeClient = Schema.Struct({
	client_id: Schema.NonEmptyString,
	redirect_uri: Schema.optionalKey(Schema.String),
	state: Schema.optionalKey(Schema.String)
})

// The rest is checked field by field, so each failure returns its own OAuth error to the callback.
export type AuthorizeParams = typeof AuthorizeParams.Type
export const AuthorizeParams = Schema.Struct({
	code_challenge: Schema.optionalKey(Schema.NonEmptyString),
	code_challenge_method: Schema.optionalKey(Schema.String),
	resource: Schema.optionalKey(Schema.ArrayEnsure(Schema.String)),
	response_type: Schema.optionalKey(Schema.String),
	scope: Schema.optionalKey(Schema.String)
})

// A checked authorization request: what its code is later bound to.
export type ClientRequest = typeof ClientRequest.Type
export const ClientRequest = Schema.Struct({
	challenge: Schema.NonEmptyString,
	clientId: Schema.NonEmptyString,
	clientName: Schema.String,
	redirectUri: Schema.NonEmptyString,
	resources: Schema.NonEmptyArray(Resource),
	state: Schema.optionalKey(Schema.NonEmptyString)
})

export type TokenGrant = typeof TokenGrant.Type
export const TokenGrant = Schema.Struct({grant_type: Schema.String})

type TokenResources = typeof TokenResources.Type
const TokenResources = Schema.optionalKey(Schema.ArrayEnsure(Resource).check(Schema.isMinLength(1)))

// OAuth 2.1 drops redirect_uri from the code exchange, and a public client may leave client_id out of a refresh; each is checked when sent.
export type TokenParams = typeof TokenParams.Type
export const TokenParams = Schema.Union([
	Schema.Struct({
		client_id: Schema.NonEmptyString,
		code: Schema.NonEmptyString,
		code_verifier: Schema.NonEmptyString,
		grant_type: Schema.Literal('authorization_code'),
		redirect_uri: Schema.optionalKey(Schema.String),
		resource: TokenResources
	}),
	Schema.Struct({
		client_id: Schema.optionalKey(Schema.String),
		grant_type: Schema.Literal('refresh_token'),
		refresh_token: Schema.NonEmptyString,
		resource: TokenResources
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

export type Stored = typeof Stored.Type
export const Stored = Schema.TaggedUnion({
	Access: {family: Schema.NonEmptyString, resources: Schema.Array(Resource), user: User},
	Client: {name: Schema.optionalKey(Schema.String), redirects: Schema.NonEmptyArray(Schema.NonEmptyString)},
	Code: {
		challenge: Schema.NonEmptyString,
		clientId: Schema.NonEmptyString,
		clientName: Schema.String,
		redirectUri: Schema.NonEmptyString,
		resources: Schema.Array(Resource),
		state: Schema.optionalKey(Schema.NonEmptyString),
		user: User
	},
	// A sign-in keeps the name its client registered, so pruning idle registrations never renames it; the previous release saved none.
	Refresh: {
		address: Schema.optionalKey(Schema.String),
		clientId: Schema.NonEmptyString,
		clientName: Schema.optionalKey(Schema.String),
		family: Schema.NonEmptyString,
		resources: Schema.Array(Resource),
		user: User
	},
	Session: {user: User},
	// A redeemed code stays until it would have expired, so a second redemption revokes the tokens the first one got.
	UsedCode: {clientId: Schema.NonEmptyString, family: Schema.NonEmptyString},
	UsedRefresh: {clientId: Schema.NonEmptyString, family: Schema.NonEmptyString}
})

export type TokenEntry = typeof TokenEntry.Type
export const TokenEntry = Schema.Struct({expiresAt: Schema.Finite, payload: Stored})

// Keyed by the SHA-256 of each token, so the saved state holds no usable credential.
export type TokenState = typeof TokenState.Type
export const TokenState = Schema.Record(Schema.String, TokenEntry)

// One app or agent the account signed in to: its refresh-token family, and when it last refreshed.
export type SignedInApp = typeof SignedInApp.Type
export const SignedInApp = Schema.Struct({
	clientName: Schema.String,
	family: Schema.NonEmptyString,
	lastActive: Schema.Finite,
	resources: Schema.Array(Resource)
})

export type FamilyParams = typeof FamilyParams.Type
export const FamilyParams = Schema.Struct({family: Schema.NonEmptyString})

export type RevokeParams = typeof RevokeParams.Type
export const RevokeParams = Schema.Struct({client_id: Schema.NonEmptyString, token: Schema.NonEmptyString})

export type VerificationParams = typeof VerificationParams.Type
export const VerificationParams = Schema.Struct({resource: Resource})

// The previous release kept members and tokens in one value, with sign-ins in progress among the tokens.
export type LegacyState = typeof LegacyState.Type
export const LegacyState = Schema.Struct({
	members: Schema.Array(Schema.Unknown),
	tokens: Schema.Record(Schema.String, Schema.Unknown)
})
