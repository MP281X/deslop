import {Schema, pipe} from 'effect'

export type GitHubOAuthState = typeof GitHubOAuthState.Type
export const GitHubOAuthState = pipe(Schema.NonEmptyString, Schema.brand('OAuthState'))
export type GitHubClientId = typeof GitHubClientId.Type
export const GitHubClientId = pipe(Schema.String, Schema.brand('GitHubClientId'))
export type AppSignIn = typeof AppSignIn.Type
export const AppSignIn = Schema.Struct({app: Schema.Literals(['opm', 'stash', 'trips'])})
export type SignInParams = typeof SignInParams.Type
const SignInParams = Schema.Struct({app: Schema.OptionFromOptionalKey(AppSignIn), next: Schema.NonEmptyString})
export type CallbackParams = typeof CallbackParams.Type
export const CallbackParams = Schema.Struct({code: Schema.NonEmptyString, state: GitHubOAuthState})
export type GitHubToken = typeof GitHubToken.Type
export const GitHubToken = Schema.Struct({access_token: Schema.NonEmptyString})
