import {Schema} from 'effect'

// Where a GitHub sign-in returns: a waiting sign-in, an approve link's code or a page of an app.
export type SignInParams = typeof SignInParams.Type
export const SignInParams = Schema.Struct({
	// The approve link's code, kept through GitHub sign-in on a phone that was signed out.
	code: Schema.optionalKey(Schema.NonEmptyString.check(Schema.isMaxLength(20))),
	next: Schema.optionalKey(Schema.NonEmptyString.check(Schema.isMaxLength(2048))),
	request: Schema.optionalKey(Schema.NonEmptyString.check(Schema.isMaxLength(20)))
})

export type CallbackParams = typeof CallbackParams.Type
export const CallbackParams = Schema.Struct({code: Schema.NonEmptyString, state: Schema.NonEmptyString})

export type LoginState = typeof LoginState.Type
export const LoginState = Schema.Struct({state: Schema.NonEmptyString})

export type GitHubToken = typeof GitHubToken.Type
export const GitHubToken = Schema.Struct({access_token: Schema.NonEmptyString})
