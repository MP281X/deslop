// fallow-ignore-file unused-type -- The type of each schema pairs with it; consumers import the schemas.
import {Schema, pipe} from 'effect'

export class AuthError extends Schema.TaggedError<AuthError>()('AuthError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

// `id` is the provider and its user id, such as `github:42154987`.
export type User = typeof User.Type
export const User = Schema.Struct({id: Schema.NonEmptyString, name: Schema.NonEmptyString})

// The signed half of a session token, and the OAuth cookie: base64url JSON, safe in a cookie, a header and a URL.
export type Session = typeof Session.Type
export const Session = pipe(
	Schema.StringFromBase64Url,
	Schema.decodeTo(Schema.fromJsonString(Schema.Struct({expiresAt: Schema.Finite, user: User})))
)

// What every app needs to verify a token: the auth app's Ed25519 public key, base64url, and the users it lets in.
export type Verification = typeof Verification.Type
export const Verification = Schema.Struct({key: Schema.NonEmptyString, users: Schema.Array(Schema.NonEmptyString)})

// `redirect` is a native app's sign-in URL, such as `stash://auth`, or a web app's https URL.
export type SignInParams = typeof SignInParams.Type
export const SignInParams = Schema.Struct({redirect: Schema.optionalKey(Schema.String)})

// The sign-in's state between the redirect to GitHub and its callback, in a short-lived cookie.
export type OAuthFlow = typeof OAuthFlow.Type
export const OAuthFlow = pipe(
	Schema.StringFromBase64Url,
	Schema.decodeTo(
		Schema.fromJsonString(
			Schema.Struct({...SignInParams.fields, state: Schema.NonEmptyString, verifier: Schema.NonEmptyString})
		)
	)
)

export type CallbackParams = typeof CallbackParams.Type
export const CallbackParams = Schema.Struct({code: Schema.NonEmptyString, state: Schema.NonEmptyString})

// GitHub answers a rejected code with 200 and this body.
export type OAuthTokenError = typeof OAuthTokenError.Type
export const OAuthTokenError = Schema.Struct({error: Schema.NonEmptyString})

export type OAuthTokenResponse = typeof OAuthTokenResponse.Type
export const OAuthTokenResponse = Schema.Union([Schema.Struct({access_token: Schema.NonEmptyString}), OAuthTokenError])

export type GitHubUser = typeof GitHubUser.Type
export const GitHubUser = Schema.Struct({id: Schema.Int, login: Schema.NonEmptyString})
