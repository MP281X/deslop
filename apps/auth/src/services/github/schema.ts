import {Schema, pipe} from 'effect'

export type OAuthState = typeof OAuthState.Type
export const OAuthState = pipe(Schema.NonEmptyString, Schema.brand('OAuthState'))
export type GitHubClientId = typeof GitHubClientId.Type
export const GitHubClientId = pipe(Schema.String, Schema.brand('GitHubClientId'))
// An app opened the sign-in in iOS's authentication sheet, which hands the callback only to the app that opened it; `app` is its URL scheme.
export type AppSignIn = typeof AppSignIn.Type
export const AppSignIn = Schema.Struct({app: Schema.String.check(Schema.isPattern(/^[a-z]+(-dev)?$/u))})
export type SignInParams = typeof SignInParams.Type
export const SignInParams = Schema.Struct({app: Schema.OptionFromOptionalKey(AppSignIn), next: Schema.NonEmptyString})
export type CallbackParams = typeof CallbackParams.Type
export const CallbackParams = Schema.Struct({code: Schema.NonEmptyString, state: OAuthState})
export type GitHubToken = typeof GitHubToken.Type
export const GitHubToken = Schema.Struct({access_token: Schema.NonEmptyString})
