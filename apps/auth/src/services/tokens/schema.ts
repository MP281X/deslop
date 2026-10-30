import {Schema} from 'effect'

import {Resource, User} from '@deslop/runtime/auth/schema'

export type Registration = typeof Registration.Type
export const Registration = Schema.Struct({
	client_name: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(100))),
	redirect_uris: Schema.NonEmptyArray(Schema.NonEmptyString.check(Schema.isMaxLength(200))).check(
		Schema.isMaxLength(4)
	),
	token_endpoint_auth_method: Schema.optionalKey(Schema.Literal('none'))
})

// A registered client is its own id: the name and callbacks it registered, so registration stores nothing.
export type ClientInfo = typeof ClientInfo.Type
export const ClientInfo = Schema.Struct({name: Schema.String, redirects: Registration.fields.redirect_uris})

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

// Where a request came from, as Traefik and the client report it; it names a sign-in, it never proves one.
export type Origin = typeof Origin.Type
export const Origin = Schema.Struct({
	address: Schema.optionalKey(Schema.String),
	userAgent: Schema.optionalKey(Schema.String)
})

// A secret is stored only as its SHA-256.
export type Access = typeof Access.Type
export const Access = Schema.Struct({expiresAt: Schema.Finite, hash: Schema.String, resources: Schema.Array(Resource)})

// One signed-in app or browser, keyed by its family: what the signed-in list shows and what signing it out removes.
export type Grant = typeof Grant.Type
export const Grant = Schema.Struct({
	client: Schema.String,
	createdAt: Schema.Finite,
	credential: Schema.TaggedUnion({
		// A refresh token names its generation, so presenting an earlier one is a replay that ends the family.
		App: {
			access: Schema.Array(Access),
			clientId: Schema.NonEmptyString,
			expiresAt: Schema.Finite,
			generation: Schema.Int,
			hash: Schema.String,
			resources: Schema.Array(Resource)
		},
		Browser: {expiresAt: Schema.Finite, hash: Schema.String}
	}),
	device: Schema.String,
	lastActive: Schema.Finite,
	origin: Origin,
	user: User
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
	resources: Schema.Array(Resource)
})

export type FamilyParams = typeof FamilyParams.Type
export const FamilyParams = Schema.Struct({family: Schema.NonEmptyString})

export type RevokeParams = typeof RevokeParams.Type
export const RevokeParams = Schema.Struct({client_id: Schema.NonEmptyString, token: Schema.NonEmptyString})

export type VerificationParams = typeof VerificationParams.Type
export const VerificationParams = Schema.Struct({resource: Resource})
