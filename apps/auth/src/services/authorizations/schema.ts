import {Schema} from 'effect'

import {Resource, User} from '@deslop/runtime/auth/schema'

const authorizationFields = {
	challenge: Schema.NonEmptyString,
	clientId: Schema.NonEmptyString,
	redirectUri: Schema.NonEmptyString,
	resources: Schema.Array(Resource),
	state: Schema.optionalKey(Schema.NonEmptyString)
}

export type Registration = typeof Registration.Type
export const Registration = Schema.Struct({
	client_name: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(100))),
	// Anyone can register, and every client stays in the saved state, so a registration stays small.
	redirect_uris: Schema.NonEmptyArray(Schema.NonEmptyString.check(Schema.isMaxLength(200))).check(
		Schema.isMaxLength(4)
	),
	token_endpoint_auth_method: Schema.optionalKey(Schema.Literal('none'))
})

export type PendingAuthorization = typeof PendingAuthorization.Type
export const PendingAuthorization = Schema.Struct({
	clientName: Schema.String,
	createdAt: Schema.Finite,
	expiresAt: Schema.Finite,
	id: Schema.NonEmptyString,
	redirectUri: Schema.NonEmptyString,
	resources: Schema.Array(Resource)
})

export type AuthorizationStatus = typeof AuthorizationStatus.Type
export const AuthorizationStatus = Schema.TaggedUnion({
	Completed: {url: Schema.NonEmptyString},
	Expired: {},
	Waiting: {request: PendingAuthorization}
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

export type Stored = typeof Stored.Type
export const Stored = Schema.TaggedUnion({
	Access: {family: Schema.NonEmptyString, resources: Schema.Array(Resource), user: User},
	Client: {name: Schema.optionalKey(Schema.String), redirects: Schema.NonEmptyArray(Schema.NonEmptyString)},
	Code: {...authorizationFields, user: User},
	Delivered: {id: Schema.NonEmptyString, url: Schema.NonEmptyString},
	Login: {
		code: Schema.optionalKey(Schema.NonEmptyString),
		next: Schema.optionalKey(Schema.NonEmptyString),
		request: Schema.optionalKey(Schema.NonEmptyString),
		verifier: Schema.NonEmptyString
	},
	Refresh: {
		clientId: Schema.NonEmptyString,
		family: Schema.NonEmptyString,
		resources: Schema.Array(Resource),
		user: User
	},
	Request: {
		...authorizationFields,
		clientName: Schema.String,
		createdAt: Schema.Finite,
		decision: Schema.TaggedUnion({Approved: {user: User}, Denied: {}, Pending: {}}),
		id: Schema.NonEmptyString
	},
	Session: {user: User},
	// A redeemed code stays until it would have expired, so a second redemption revokes the tokens the first one got.
	UsedCode: {clientId: Schema.NonEmptyString, family: Schema.NonEmptyString},
	UsedRefresh: {clientId: Schema.NonEmptyString, family: Schema.NonEmptyString}
})

export type RequestParams = typeof RequestParams.Type
export const RequestParams = Schema.Struct({request: Schema.NonEmptyString})

export type CodeParams = typeof CodeParams.Type
export const CodeParams = Schema.Struct({code: Schema.NonEmptyString})

export type SignInParams = typeof SignInParams.Type
export const SignInParams = Schema.Struct({
	// The approve link's code, kept through GitHub sign-in on a phone that was signed out.
	code: Schema.optionalKey(Schema.NonEmptyString.check(Schema.isMaxLength(20))),
	next: Schema.optionalKey(Schema.NonEmptyString.check(Schema.isMaxLength(2048))),
	request: Schema.optionalKey(Schema.NonEmptyString)
})

export type ConsentParams = typeof ConsentParams.Type
export const ConsentParams = Schema.Struct({...RequestParams.fields, accept: Schema.Boolean})

export type RevokeParams = typeof RevokeParams.Type
export const RevokeParams = Schema.Struct({client_id: Schema.NonEmptyString, token: Schema.NonEmptyString})

export type CallbackParams = typeof CallbackParams.Type
export const CallbackParams = Schema.Struct({code: Schema.NonEmptyString, state: Schema.NonEmptyString})

export type LoginState = typeof LoginState.Type
export const LoginState = Schema.Struct({state: Schema.NonEmptyString})

export type GitHubToken = typeof GitHubToken.Type
export const GitHubToken = Schema.Struct({access_token: Schema.NonEmptyString})

export type GitHubUser = typeof GitHubUser.Type
export const GitHubUser = Schema.Struct({
	id: Schema.Int,
	login: Schema.NonEmptyString,
	name: Schema.optionalKey(Schema.NullOr(Schema.String))
})

// Admins come from GITHUB_ADMINS; a member is a GitHub account an admin allowed; anyone else who signed in waits for one.
export type Role = typeof Role.Type
export const Role = Schema.Literals(['Admin', 'Member', 'Waiting'])

export type Account = typeof Account.Type
export const Account = Schema.Struct({...User.fields, fullName: Schema.optionalKey(Schema.String), role: Role})

// `since` is when a waiting account asked, or when a member was allowed.
export type Person = typeof Person.Type
export const Person = Schema.Struct({...Account.fields, since: Schema.Finite})

export type MemberStatus = typeof MemberStatus.Type
export const MemberStatus = Schema.Literals(['Waiting', 'Allowed'])

export type MemberRow = typeof MemberRow.Type
export const MemberRow = Schema.Struct({
	fullName: Schema.String,
	id: Schema.NonEmptyString,
	name: Schema.NonEmptyString,
	since: Schema.Finite,
	status: MemberStatus
})

export type AuthState = typeof AuthState.Type
export const AuthState = Schema.Struct({
	members: Schema.Array(MemberRow),
	tokens: Schema.Record(Schema.String, Schema.Struct({expiresAt: Schema.Finite, payload: Stored}))
})

export type AdmitParams = typeof AdmitParams.Type
export const AdmitParams = Schema.Struct({allow: Schema.Boolean, id: Schema.NonEmptyString})

export type PersonParams = typeof PersonParams.Type
export const PersonParams = Schema.Struct({id: Schema.NonEmptyString})

export type VerificationParams = typeof VerificationParams.Type
export const VerificationParams = Schema.Struct({resource: Resource})
