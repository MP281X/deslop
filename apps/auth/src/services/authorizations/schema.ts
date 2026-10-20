import {Schema} from 'effect'

import {Resource, User} from '@deslop/runtime/auth/schema'

const authorizationFields = {
	challenge: Schema.NonEmptyString,
	clientId: Schema.NonEmptyString,
	redirectUri: Schema.NonEmptyString,
	resources: Schema.Array(Resource),
	state: Schema.NonEmptyString
}

export type Registration = typeof Registration.Type
export const Registration = Schema.Struct({
	client_name: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(100))),
	redirect_uris: Schema.NonEmptyArray(Schema.NonEmptyString),
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

export type AuthorizeParams = typeof AuthorizeParams.Type
export const AuthorizeParams = Schema.Struct({
	client_id: Schema.NonEmptyString,
	code_challenge: Schema.NonEmptyString,
	code_challenge_method: Schema.Literal('S256'),
	redirect_uri: Schema.NonEmptyString,
	resource: Schema.ArrayEnsure(Resource).check(Schema.isMinLength(1)),
	response_type: Schema.Literal('code'),
	scope: Schema.optionalKey(Schema.NonEmptyString),
	state: Schema.NonEmptyString
})

export type TokenParams = typeof TokenParams.Type
export const TokenParams = Schema.Union([
	Schema.Struct({
		client_id: Schema.NonEmptyString,
		code: Schema.NonEmptyString,
		code_verifier: Schema.NonEmptyString,
		grant_type: Schema.Literal('authorization_code'),
		redirect_uri: Schema.NonEmptyString,
		resource: Schema.optionalKey(Schema.ArrayEnsure(Resource).check(Schema.isMinLength(1)))
	}),
	Schema.Struct({
		client_id: Schema.NonEmptyString,
		grant_type: Schema.Literal('refresh_token'),
		refresh_token: Schema.NonEmptyString,
		resource: Schema.optionalKey(Schema.ArrayEnsure(Resource).check(Schema.isMinLength(1)))
	})
])

export type Stored = typeof Stored.Type
export const Stored = Schema.TaggedUnion({
	Access: {family: Schema.NonEmptyString, resources: Schema.Array(Resource), user: User},
	Client: {name: Schema.optionalKey(Schema.String), redirects: Schema.NonEmptyArray(Schema.NonEmptyString)},
	Code: {...authorizationFields, user: User},
	Delivered: {id: Schema.NonEmptyString, url: Schema.NonEmptyString},
	Login: {request: Schema.optionalKey(Schema.NonEmptyString), verifier: Schema.NonEmptyString},
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
	UsedRefresh: {clientId: Schema.NonEmptyString, family: Schema.NonEmptyString}
})

export type StoredRow = typeof StoredRow.Type
export const StoredRow = Schema.Struct({payload: Schema.String})

export type AuthorizationRow = typeof AuthorizationRow.Type
export const AuthorizationRow = Schema.Struct({expiresAt: Schema.Finite, hash: Schema.String, payload: Schema.String})

export type RequestParams = typeof RequestParams.Type
export const RequestParams = Schema.Struct({request: Schema.NonEmptyString})

export type SignInParams = typeof SignInParams.Type
export const SignInParams = Schema.Struct({request: Schema.optionalKey(Schema.NonEmptyString)})

export type ConsentParams = typeof ConsentParams.Type
export const ConsentParams = Schema.Struct({...RequestParams.fields, accept: Schema.Boolean})

export type RevokeParams = typeof RevokeParams.Type
export const RevokeParams = Schema.Struct({client_id: Schema.NonEmptyString, token: Schema.NonEmptyString})

export type CallbackParams = typeof CallbackParams.Type
export const CallbackParams = Schema.Struct({code: Schema.NonEmptyString, state: Schema.NonEmptyString})

export type GitHubToken = typeof GitHubToken.Type
export const GitHubToken = Schema.Struct({access_token: Schema.NonEmptyString})

export type GitHubUser = typeof GitHubUser.Type
export const GitHubUser = Schema.Struct({id: Schema.Int, login: Schema.NonEmptyString})

export type VerificationParams = typeof VerificationParams.Type
export const VerificationParams = Schema.Struct({resource: Resource})
