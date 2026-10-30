import {Schema} from 'effect'

import {Resource} from '@deslop/runtime/auth/schema'

import {ClientRequest, Origin} from '#services/tokens/schema.ts'

// An app or agent asks for tokens to Deslop apps; a browser asks for the shared session.
export type SignInKind = typeof SignInKind.Type
export const SignInKind = Schema.Literals(['App', 'Browser'])

// What the approver sees of a waiting sign-in: the app or browser, the device and address it was started from.
export type PendingAuthorization = typeof PendingAuthorization.Type
export const PendingAuthorization = Schema.Struct({
	address: Schema.optionalKey(Schema.String),
	clientName: Schema.String,
	createdAt: Schema.Finite,
	device: Schema.String,
	expiresAt: Schema.Finite,
	id: Schema.NonEmptyString,
	kind: SignInKind,
	resources: Schema.Array(Resource)
})

// The waiting page's view: once decided, it continues at /auth/continue, which delivers the answer.
export type AuthorizationStatus = typeof AuthorizationStatus.Type
export const AuthorizationStatus = Schema.TaggedUnion({
	Decided: {},
	Expired: {},
	Waiting: {request: PendingAuthorization}
})

// Where an approval goes: an app's checked authorization request, or the page a browser returns to.
export type Delivery = typeof Delivery.Type
export const Delivery = Schema.TaggedUnion({
	Browser: {next: Schema.optionalKey(Schema.String)},
	Client: {request: ClientRequest}
})

// What /auth/continue answers: a redirect, a session for the waiting browser, or still waiting.
export type Collected = typeof Collected.Type
export const Collected = Schema.TaggedUnion({
	Redirect: {url: Schema.NonEmptyString},
	Session: {next: Schema.optionalKey(Schema.String), seconds: Schema.Int, token: Schema.NonEmptyString},
	Waiting: {}
})

// What a sign-in's process starts with: how its answer is delivered and where it was started from.
export type SignInInput = typeof SignInInput.Type
export const SignInInput = Schema.Struct({delivery: Delivery, origin: Origin})

export type BrowserParams = typeof BrowserParams.Type
export const BrowserParams = Schema.Struct({
	next: Schema.optionalKey(Schema.NonEmptyString.check(Schema.isMaxLength(2048)))
})

export type RequestParams = typeof RequestParams.Type
export const RequestParams = Schema.Struct({request: Schema.NonEmptyString.check(Schema.isMaxLength(20))})

export type CodeParams = typeof CodeParams.Type
export const CodeParams = Schema.Struct({code: Schema.NonEmptyString.check(Schema.isMaxLength(20))})

export type AnswerParams = typeof AnswerParams.Type
export const AnswerParams = Schema.Struct({...RequestParams.fields, accept: Schema.Boolean})
