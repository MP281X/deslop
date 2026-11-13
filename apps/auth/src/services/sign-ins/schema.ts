import {Schema, pipe} from 'effect'

import {DurationFromSeconds} from '@deslop/runtime/shared/time'

import {ClientRequest, DeviceRequest, Origin, TokenResponse} from '#services/tokens/schema.ts'

export type SignInKind = typeof SignInKind.Type
export const SignInKind = Schema.Literals(['App', 'Browser'])

export type SignInCode = typeof SignInCode.Type
export const SignInCode = pipe(Schema.String, Schema.brand('SignInCode'))

export type PendingAuthorization = typeof PendingAuthorization.Type
export const PendingAuthorization = Schema.Struct({
	address: Schema.OptionFromOptionalKey(Schema.String),
	clientName: Schema.String,
	device: Schema.String,
	expiresAt: Schema.DateTimeUtcFromMillis,
	id: SignInCode.check(Schema.isNonEmpty()),
	kind: SignInKind
})

// The waiting page's view: once decided, it continues at /auth/continue, which delivers the answer.
export type AuthorizationStatus = typeof AuthorizationStatus.Type
export const AuthorizationStatus = Schema.TaggedUnion({
	Decided: {},
	Expired: {},
	Waiting: {request: PendingAuthorization}
})

export type Delivery = typeof Delivery.Type
export const Delivery = Schema.TaggedUnion({
	Browser: {next: Schema.OptionFromOptionalKey(Schema.String)},
	Client: {request: ClientRequest},
	Device: {request: DeviceRequest}
})

export type Collected = typeof Collected.Type
export const Collected = Schema.TaggedUnion({
	Denied: {},
	Granted: {tokens: TokenResponse},
	Redirect: {url: Schema.NonEmptyString},
	Session: {
		next: Schema.OptionFromOptionalKey(Schema.String),
		seconds: DurationFromSeconds,
		token: Schema.NonEmptyString
	}
})

export type SignInInput = typeof SignInInput.Type
export const SignInInput = Schema.Struct({delivery: Delivery, origin: Origin})

export type BrowserParams = typeof BrowserParams.Type
export const BrowserParams = Schema.Struct({
	next: Schema.OptionFromOptionalKey(Schema.NonEmptyString.check(Schema.isMaxLength(2048)))
})

export type RequestParams = typeof RequestParams.Type
export const RequestParams = Schema.Struct({request: SignInCode.check(Schema.isNonEmpty(), Schema.isMaxLength(20))})

export type CodeParams = typeof CodeParams.Type
export const CodeParams = Schema.Struct({code: SignInCode.check(Schema.isNonEmpty(), Schema.isMaxLength(20))})

export type AnswerParams = typeof AnswerParams.Type
export const AnswerParams = Schema.Struct({...RequestParams.fields, accept: Schema.Boolean})
