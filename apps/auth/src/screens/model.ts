import {Command, UiSchema} from '@effect/ui'

import {Cause, Effect, Option, Predicate, Schema, String, pipe} from 'effect'

import {AsyncResult, Atom, AtomRegistry} from 'effect/reactivity'

import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {AuthError, UserId} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {AdmitParams, ListedSession, Person, SignedAccount} from '#contracts'

import {AuthReads} from '#screens/reads.ts'
import {AuthRoute} from '#screens/routes.ts'

const AccountRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Option(SignedAccount)})
const PeopleRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(Person)})
const SessionsRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(ListedSession)})
const Reader = Schema.Literals(['account', 'people', 'sessions'])
export type Reader = typeof Reader.Type

export type Model = typeof Model.Type
export const Model = Schema.Struct({
	account: AccountRead,
	admission: Schema.optional(
		Schema.Struct({error: Schema.optionalKey(Schema.String), id: UserId, pending: Schema.Boolean})
	),
	now: DateTimeUtcFromFiniteMillis,
	openedFromList: Schema.Boolean,
	people: PeopleRead,
	route: AuthRoute,
	sessions: SessionsRead,
	signInError: Schema.optional(Schema.String),
	signOutError: Schema.optional(Schema.String),
	waitingOnly: Schema.Boolean
})

export const Message = UiSchema.TaggedEnum({
	Account: {result: AccountRead},
	Admission: {error: Schema.optionalKey(Schema.String), id: UserId, viewer: UserId},
	Back: {},
	Choose: {id: Schema.String},
	Clock: {now: DateTimeUtcFromFiniteMillis},
	People: {result: PeopleRead, viewer: UserId},
	Retry: {reader: Reader},
	Route: {route: AuthRoute},
	Select: {id: UserId},
	Sessions: {result: SessionsRead, viewer: UserId},
	SignIn: {},
	SignInFailed: {error: AuthError},
	SignInFinished: {signedIn: Schema.Boolean},
	SignOut: {},
	SignOutFailed: {error: AuthError},
	SignOutFinished: {}
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
		Effect.gen(function* () {
			const {admit} = yield* AuthReads
			const registry = yield* AtomRegistry.AtomRegistry
			return args => {
				const operation = admit(args.id)
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
			}
		})
	)
}

export class Refresh extends Command.Service<Refresh>()('Auth/Refresh', {
	args: {reader: Reader, sessionChanged: Schema.optionalKey(Schema.Boolean), viewer: Schema.optional(UserId)}
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const reads = yield* AuthReads
			const registry = yield* AtomRegistry.AtomRegistry
			return args =>
				Effect.sync(() => {
					if (args.sessionChanged === true) registry.update(reads.credentials, version => version + 1)
					if (args.reader === 'account') {
						registry.refresh(reads.account)
						return
					}
					if (args.viewer === undefined) return
					registry.refresh(args.reader === 'people' ? reads.people(args.viewer) : reads.sessions(args.viewer))
				})
		})
	)
}

export class StartSignIn extends Command.Service<StartSignIn>()('Auth/StartSignIn', {
	args: {next: Schema.optional(Schema.String)},
	error: AuthError,
	success: Schema.Boolean
}) {}

export class SignOut extends Command.Service<SignOut>()('Auth/SignOut', {args: {}, error: AuthError}) {}

export class RecoverSignIn extends Command.Service<RecoverSignIn>()('Auth/RecoverSignIn', {args: {}}) {}
