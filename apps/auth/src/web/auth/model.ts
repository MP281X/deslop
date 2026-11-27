import {Command, UiSchema} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Cause, Effect, Option, Predicate, Schema, String, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import {AsyncResult, Atom, AtomRegistry} from 'effect/reactivity'

import {blockingFailure, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {UserId, signInUrl} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'
import {isNative, nativeSignIn, nativeSignOut} from '@deslop/ui/native'

import {AdmitParams, ListedSession, Person, SignedAccount} from '#contracts'

import {accountAtom, admitAtom, peopleAtom, sessionRuntime, sessionsAtom} from '#web/auth/client.ts'
import {AuthRoute} from '#web/routes.ts'

const AccountRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Option(SignedAccount)})
const PeopleRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(Person)})
const SessionsRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(ListedSession)})
export type Reader = typeof Reader.Type
const Reader = Schema.Literals(['account', 'people', 'sessions'])

export type Model = typeof Model.Type
export const Model = Schema.Struct({
	account: AccountRead,
	admission: Schema.optional(
		Schema.Struct({error: Schema.optionalKey(Schema.String), id: UserId, pending: Schema.Boolean})
	),
	listHidden: Schema.Boolean,
	narrow: Schema.Boolean,
	now: DateTimeUtcFromFiniteMillis,
	people: PeopleRead,
	peopleMenuOpen: Schema.Boolean,
	route: AuthRoute,
	sessions: SessionsRead,
	signIn: Schema.optional(Schema.Literals(['pending', 'failed'])),
	signOut: Schema.optional(Schema.Literals(['pending', 'failed'])),
	waitingOnly: Schema.Boolean
})

export type H = Html.H<Message>

export type Message = typeof Message.Type
export const Message = UiSchema.TaggedEnum({
	Account: {result: AccountRead},
	Admission: {error: Schema.optionalKey(Schema.String), id: UserId, viewer: UserId},
	Answer: AdmitParams.fields,
	Clock: {now: DateTimeUtcFromFiniteMillis},
	EndSession: {},
	FilterPeople: {waitingOnly: Schema.Boolean},
	People: {result: PeopleRead, viewer: UserId},
	PeopleMenu: {open: Schema.Boolean},
	Posture: {narrow: Schema.Boolean},
	Retry: {reader: Reader},
	Route: {route: AuthRoute},
	Select: {id: UserId},
	Sessions: {result: SessionsRead, viewer: UserId},
	SignInSettled: {failed: Schema.Boolean, signedIn: Schema.Boolean},
	SignOutSettled: {failed: Schema.Boolean},
	StartSignIn: {},
	TogglePeople: {}
})

export function readValue<A, E>(result: AsyncResult.AsyncResult<A, E>) {
	if (Option.isSome(blockingFailure(result))) return Option.none<A>()
	return AsyncResult.value(result)
}

export function signed(result: Model['account']) {
	return pipe(readValue(result), Option.flatten, Option.getOrUndefined)
}

function admissionError(cause: Cause.Cause<unknown>) {
	const failure = Cause.squash(cause)
	if (Predicate.hasProperty(failure, 'message') && String.isString(failure.message)) return failure.message
	return 'Couldn’t answer the access request'
}

export class Admit extends Command.Service<Admit>()('Auth/Admit', {
	args: {...AdmitParams.fields, viewer: UserId},
	success: Message
}) {
	static readonly layer = this.toLayer(
		Effect.map(AtomRegistry.AtomRegistry, registry => args => {
			const operation = admitAtom(args.id)
			return pipe(
				Effect.gen(function* () {
					yield* Atom.mount(operation)
					yield* Atom.set(operation, args.allow)
					return yield* Effect.matchCause(Atom.getResult(operation, {suspendOnWaiting: true}), {
						onFailure: cause => Message.Admission({error: admissionError(cause), id: args.id, viewer: args.viewer}),
						onSuccess: () => Message.Admission({id: args.id, viewer: args.viewer})
					})
				}),
				Effect.scoped,
				Effect.provideService(AtomRegistry.AtomRegistry, registry)
			)
		})
	)
}

export class Refresh extends Command.Service<Refresh>()('Auth/Refresh', {
	args: {reader: Reader, sessionChanged: Schema.optionalKey(Schema.Boolean), viewer: Schema.optional(UserId)},
	success: Schema.Void
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			AtomRegistry.AtomRegistry,
			registry => args =>
				Effect.sync(() => {
					if (args.reader === 'account') {
						if (args.sessionChanged === true) registry.refresh(sessionRuntime)
						registry.refresh(accountAtom)
						return
					}
					if (args.viewer === undefined) return
					if (args.reader === 'people') {
						registry.refresh(peopleAtom(args.viewer))
						return
					}
					registry.refresh(sessionsAtom(args.viewer))
				})
		)
	)
}

export const RedirectToSignIn = Command.make('Auth/RedirectToSignIn', {args: {}}, () =>
	Effect.sync(() => location.replace(signInUrl(location.href)))
)

export const StartSignIn = Command.make('Auth/StartSignIn', {args: {next: Schema.optional(Schema.String)}}, args =>
	Effect.sync(() => location.assign(`/sign-in?${new URLSearchParams({next: args.next ?? location.origin})}`))
)

export const StartNativeSignIn = Command.make('Auth/StartNativeSignIn', {args: {}}, () =>
	Effect.match(nativeSignIn, {
		onFailure: () => Message.SignInSettled({failed: true, signedIn: false}),
		onSuccess: signedIn => Message.SignInSettled({failed: false, signedIn})
	})
)

export class SignOut extends Command.Service<SignOut>()('Auth/SignOut', {args: {}, success: Message}) {
	static readonly layer = this.toLayer(
		Effect.map(HttpClient.HttpClient, client => () => {
			if (isNative) {
				return Effect.match(nativeSignOut, {
					onFailure: () => Message.SignOutSettled({failed: true}),
					onSuccess: () => Message.SignOutSettled({failed: false})
				})
			}
			return pipe(
				client.post(new URL('/sign-out', location.origin)),
				Effect.flatMap(HttpClientResponse.filterStatusOk),
				Effect.match({
					onFailure: () => Message.SignOutSettled({failed: true}),
					onSuccess: () => {
						location.replace('/')
						return Message.SignOutSettled({failed: false})
					}
				})
			)
		})
	)
}

export function signInRequested(result: AsyncResult.AsyncResult<unknown, unknown>) {
	return Option.exists(blockingFailure(result), needsSignInCause)
}
