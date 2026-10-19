// fallow-ignore-file unused-type -- Schema types pair with their values so consumers can import either.
import {Schema} from 'effect'

export class AuthError extends Schema.TaggedError<AuthError>()('AuthError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type User = typeof User.Type
export const User = Schema.Struct({id: Schema.NonEmptyString, name: Schema.NonEmptyString})

export type Verification = typeof Verification.Type
export const Verification = Schema.Struct({users: Schema.Array(Schema.NonEmptyString)})

export type Account = typeof Account.Type
export const Account = Schema.Struct({githubId: Schema.NonEmptyString, name: Schema.NonEmptyString})

export type GitHubIdentity = typeof GitHubIdentity.Type
export const GitHubIdentity = Schema.Struct({id: Schema.Union([Schema.String, Schema.Int])})

export type BrowserSession = typeof BrowserSession.Type
export const BrowserSession = Schema.NullOr(Schema.Struct({user: Account}))

export type AccessClaims = typeof AccessClaims.Type
export const AccessClaims = Schema.Struct({user: User})

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
