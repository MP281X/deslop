import {Schema, pipe} from 'effect'

export type OAuthState = typeof OAuthState.Type
export const OAuthState = pipe(Schema.NonEmptyString, Schema.brand('OAuthState'))
export type GitHubClientId = typeof GitHubClientId.Type
export const GitHubClientId = pipe(Schema.String, Schema.brand('GitHubClientId'))
export type SignInParams = typeof SignInParams.Type
export const SignInParams = Schema.Struct({next: Schema.NonEmptyString})
export type CallbackParams = typeof CallbackParams.Type
export const CallbackParams = Schema.Struct({code: Schema.NonEmptyString, state: OAuthState})
export type GitHubToken = typeof GitHubToken.Type
export const GitHubToken = Schema.Struct({access_token: Schema.NonEmptyString})
