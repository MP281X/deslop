import {Schema, pipe} from 'effect'

import {SignInCode} from '#services/sign-ins/schema.ts'

export type OAuthState = typeof OAuthState.Type
export const OAuthState = pipe(Schema.NonEmptyString, Schema.brand('OAuthState'))

export type GitHubClientId = typeof GitHubClientId.Type
export const GitHubClientId = pipe(Schema.String, Schema.brand('GitHubClientId'))

export type SignInParams = typeof SignInParams.Type
export const SignInParams = Schema.Struct({
	// The approve link's code, kept through GitHub sign-in on a phone that was signed out.
	code: Schema.OptionFromOptionalKey(SignInCode.check(Schema.isNonEmpty(), Schema.isMaxLength(20))),
	next: Schema.OptionFromOptionalKey(Schema.NonEmptyString.check(Schema.isMaxLength(2048))),
	request: Schema.OptionFromOptionalKey(SignInCode.check(Schema.isNonEmpty(), Schema.isMaxLength(20)))
})

export type CallbackParams = typeof CallbackParams.Type
export const CallbackParams = Schema.Struct({code: Schema.NonEmptyString, state: OAuthState})

export type LoginState = typeof LoginState.Type
export const LoginState = Schema.Struct({state: OAuthState})

export type GitHubToken = typeof GitHubToken.Type
export const GitHubToken = Schema.Struct({access_token: Schema.NonEmptyString})
