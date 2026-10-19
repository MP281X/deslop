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
	'https://scope.mp281x.xyz/mcp',
	'https://portfolio.mp281x.xyz/mcp',
	'https://otel.mp281x.xyz'
])

export type Authorization = typeof Authorization.Type
export const Authorization = Schema.Struct({
	challenge: Schema.NonEmptyString,
	clientId: Schema.NonEmptyString,
	redirectUri: Schema.NonEmptyString,
	resources: Schema.Array(Resource),
	state: Schema.NonEmptyString
})

export type Registration = typeof Registration.Type
export const Registration = Schema.Struct({
	redirect_uris: Schema.NonEmptyArray(Schema.NonEmptyString),
	token_endpoint_auth_method: Schema.optionalKey(Schema.Literal('none'))
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
	Client: {redirects: Schema.NonEmptyArray(Schema.NonEmptyString)},
	Code: {...Authorization.fields, user: User},
	Login: {request: Schema.optionalKey(Schema.NonEmptyString), verifier: Schema.NonEmptyString},
	Refresh: {
		clientId: Schema.NonEmptyString,
		family: Schema.NonEmptyString,
		resources: Schema.Array(Resource),
		user: User
	},
	Request: Authorization.fields,
	Session: {user: User},
	UsedRefresh: {clientId: Schema.NonEmptyString, family: Schema.NonEmptyString}
})

export type StoredRow = typeof StoredRow.Type
export const StoredRow = Schema.Struct({payload: Schema.String})

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

export type Redirect = typeof Redirect.Type
export const Redirect = Schema.Struct({url: Schema.NonEmptyString})

export type VerificationParams = typeof VerificationParams.Type
export const VerificationParams = Schema.Struct({resource: Resource})
