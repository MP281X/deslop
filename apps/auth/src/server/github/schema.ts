import {Schema, pipe} from 'effect'

import {GitHubId} from '@deslop/runtime/shared/auth'

export type GitHubOAuthState = typeof GitHubOAuthState.Type
export const GitHubOAuthState = pipe(Schema.NonEmptyString, Schema.brand('OAuthState'))
export type GitHubClientId = typeof GitHubClientId.Type
export const GitHubClientId = pipe(Schema.String, Schema.brand('GitHubClientId'))
export type AppSignIn = typeof AppSignIn.Type
export const AppSignIn = Schema.Struct({app: Schema.Literals(['opm', 'stash', 'trips'])})
export type SignInParams = typeof SignInParams.Type
export const SignInParams = Schema.Struct({app: Schema.OptionFromOptionalKey(AppSignIn), next: Schema.NonEmptyString})
// A started sign-in, sealed into its browser's login cookie until GitHub returns.
export type PendingSignIn = typeof PendingSignIn.Type
export const PendingSignIn = Schema.Struct({
	...SignInParams.fields,
	expires: Schema.DateTimeUtcFromMillis,
	verifier: Schema.NonEmptyString
})
export type PendingSignInJson = typeof PendingSignInJson.Type
export const PendingSignInJson = Schema.fromJsonString(PendingSignIn)
export type CallbackParams = typeof CallbackParams.Type
export const CallbackParams = Schema.Struct({code: Schema.NonEmptyString, state: GitHubOAuthState})
export type GitHubRefusal = typeof GitHubRefusal.Type
// GitHub answers a refused exchange with 200 and an error code.
export const GitHubRefusal = Schema.Struct({error: Schema.String})
export type GitHubToken = typeof GitHubToken.Type
export const GitHubToken = Schema.Union([Schema.Struct({access_token: Schema.NonEmptyString}), GitHubRefusal])

export type GitHubUser = typeof GitHubUser.Type
export const GitHubUser = Schema.Struct({
	id: GitHubId,
	login: Schema.NonEmptyString,
	name: Schema.OptionFromOptionalNullOr(Schema.String)
})
