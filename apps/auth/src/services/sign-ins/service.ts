import {
	Clock,
	Context,
	Effect,
	Exit,
	HashMap,
	Layer,
	Match,
	Option,
	Ref,
	Schema,
	Scope,
	Semaphore,
	Stream,
	Struct,
	pipe
} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {Digest, SecureRandom} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {Cookies} from 'effect/http'
import type {Headers} from 'effect/http'

import {AuthError, User} from '@deslop/runtime/auth/schema'

import {Changes} from '#services/changes/service.ts'
import {People} from '#services/people/service.ts'
import {CODE_LENGTH, codeFrom, typedCode} from '#services/sign-ins/lib/utils.ts'
import type {AnswerParams, Delivery} from '#services/sign-ins/schema.ts'
import {AuthorizationStatus, Collected, PendingAuthorization} from '#services/sign-ins/schema.ts'
import {callbackUrl} from '#services/tokens/lib/utils.ts'
import {Tokens} from '#services/tokens/service.ts'

export const REQUEST_COOKIE = '__Host-request-'

function rejected(message: string) {
	return Effect.mapError(cause => {
		if (Schema.is(AuthError)(cause)) return cause
		return AuthError.make({cause, message})
	})
}

const expired = AuthError.make({message: 'This sign-in expired. Start it again in the app.'})
const notWaiting = AuthError.make({
	message:
		'No waiting sign-in has this code: it is mistyped, already answered or expired after 10 minutes. Read the code again from the page or command that is still waiting; start a new sign-in only if none is.'
})

const SignInStates = Machine.state({
	states: {
		Collected: {type: 'final'},
		Expired: {type: 'final'},
		Open: {states: {Approved: {fields: {user: User}}, Denied: {}, Waiting: {}}}
	}
})

// A sign-in waits for one answer, which /auth/continue collects once; either way it ends ten minutes after it started.
const SignIn = Machine.make({
	branches: {answered: {approved: {target: 'Open.Approved'}, denied: {target: 'Open.Denied'}}},
	events: Machine.events({Answered: {accept: Schema.Boolean, user: User}, Collected: {}}),
	root: SignInStates,
	timers: {lifetime: '10 minutes'}
}).handle({
	initial: {target: 'Open'},
	states: {
		Collected: {},
		Expired: {},
		Open: {
			initial: {target: 'Open.Waiting'},
			invoke: {onDone: {target: 'Expired'}, src: 'lifetime'},
			states: {
				Approved: {on: {Collected: {target: 'Collected'}}},
				Denied: {on: {Collected: {target: 'Collected'}}},
				Waiting: {
					on: {
						Answered: {
							branches: 'answered',
							resolve: transition => {
								if (transition.event.accept) return transition.select.approved({data: {user: transition.event.user}})
								return transition.select.denied()
							}
						}
					}
				}
			}
		}
	}
})

function run() {
	return Machine.start(SignIn)
}

// A started sign-in: what it asks for, how its answer is delivered, the browser it is bound to, and its process.
type Open = {
	delivery: Delivery
	pending: PendingAuthorization
	receiver: string
	ref: Effect.Success<ReturnType<typeof run>>
}

export class SignIns extends Context.Service<
	SignIns,
	{
		readonly answer: (params: AnswerParams, user: User) => Effect.Effect<{clientName: string}, AuthError>
		readonly collect: (code: string, headers: Headers.Headers) => Effect.Effect<Collected, AuthError>
		readonly lookup: (code: string) => Stream.Stream<Option.Option<PendingAuthorization>, AuthError>
		readonly start: (
			delivery: Delivery,
			address: Option.Option<string>
		) => Effect.Effect<{code: string; receiver: string}, AuthError>
		readonly status: (code: string, headers: Headers.Headers) => Stream.Stream<AuthorizationStatus, AuthError>
	}
>()('@deslop/auth/services/sign-ins/service/SignIns') {
	// Sign-ins live in memory: a restart ends the waiting ones, and their apps start again.
	static readonly layer = Layer.effect(
		SignIns,
		Effect.gen(function* () {
			const tokens = yield* Tokens
			const people = yield* People
			const changes = yield* Changes
			const random = yield* SecureRandom.SecureRandom
			const digest = yield* Digest.Digest
			const scope = yield* Effect.scope
			const open = yield* Ref.make(HashMap.empty<string, Open>())
			// Answers and collections are decided one at a time, so a sign-in takes one answer and delivers it once.
			const decisions = yield* Semaphore.make(1)
			const hash = Effect.fnUntraced(function* (value: string) {
				return Base64Url.encode(yield* digest.digest(Digest.sha256, new TextEncoder().encode(value)))
			})
			function find(code: string) {
				return Effect.map(Ref.get(open), HashMap.get(typedCode(code)))
			}
			const waiting = Effect.fnUntraced(function* (found: Open) {
				return SignInStates.matches((yield* found.ref.snapshot).state, 'Open.Waiting')
			})
			// Only the browser or command that started a sign-in, holding its cookie, receives the answer.
			const received = Effect.fnUntraced(function* (code: string, headers: Headers.Headers) {
				const found = yield* Effect.mapError(Effect.fromOption(yield* find(code)), () => expired)
				const token = Cookies.parseHeader(headers['cookie'] ?? '')[`${REQUEST_COOKIE}${found.pending.id}`]
				if (token === undefined) return yield* AuthError.make({message: 'Open the sign-in link again'})
				if ((yield* hash(token)) !== found.receiver) {
					return yield* AuthError.make({message: 'The sign-in belongs to another browser'})
				}
				return found
			})
			const deliver = Effect.fnUntraced(function* (found: Open, user: Option.Option<User>) {
				return yield* Match.valueTags(found.delivery, {
					Browser: browser =>
						Option.match(user, {
							onNone: () => Effect.succeed(Collected.cases.Redirect.make({url: '/'})),
							onSome: approver =>
								Effect.map(tokens.startSession(approver), token =>
									Collected.cases.Session.make({...Struct.pick(browser, ['next']), token})
								)
						}),
					Client: client =>
						Option.match(user, {
							onNone: () =>
								Effect.succeed(
									Collected.cases.Redirect.make({url: callbackUrl(client.request, {error: 'access_denied'})})
								),
							onSome: approver =>
								Effect.map(tokens.issue(client.request, approver), code =>
									Collected.cases.Redirect.make({url: callbackUrl(client.request, {code})})
								)
						})
				})
			})

			return SignIns.of({
				answer: Effect.fn('SignIns.answer')(function* (params: AnswerParams, user: User) {
					yield* people.allowed(user)
					return yield* decisions.withPermit(
						Effect.gen(function* () {
							const found = yield* Effect.mapError(Effect.fromOption(yield* find(params.request)), () => notWaiting)
							if (!(yield* waiting(found))) return yield* notWaiting
							yield* found.ref.send({_tag: 'Answered', accept: params.accept, user})
							yield* changes.publish
							return {clientName: found.pending.clientName}
						})
					)
				}, rejected('Cannot answer the sign-in')),
				// Waits up to 50 seconds for the answer, below the proxy's timeout; a command repeats the request until it arrives.
				collect: Effect.fn('SignIns.collect')(function* (code: string, headers: Headers.Headers) {
					const found = yield* received(code, headers)
					const decided = yield* pipe(
						Machine.waitFor(found.ref, snapshot => !SignInStates.matches(snapshot.state, 'Open.Waiting')),
						Effect.timeoutOption('50 seconds'),
						Effect.mapError(() => expired)
					)
					if (Option.isNone(decided)) return Collected.cases.Waiting.make({})
					return yield* decisions.withPermit(
						Effect.gen(function* () {
							const state = (yield* found.ref.snapshot).state
							const approved = SignInStates.get(state, 'Open.Approved')
							if (Option.isNone(approved) && !SignInStates.matches(state, 'Open.Denied')) return yield* expired
							yield* found.ref.send({_tag: 'Collected'})
							return yield* deliver(
								found,
								Option.map(approved, value => value.user)
							)
						})
					)
				}, rejected('Cannot complete the sign-in')),
				lookup: code =>
					changes.watch(
						Effect.flatMap(find(code), found =>
							Option.match(found, {
								onNone: () => Effect.succeedNone,
								onSome: signIn =>
									Effect.map(waiting(signIn), isWaiting => Option.liftPredicate(signIn.pending, () => isWaiting))
							})
						),
						found => Option.match(found, {onNone: () => Infinity, onSome: request => request.expiresAt})
					),
				start: Effect.fn('SignIns.start')(function* (delivery: Delivery, address: Option.Option<string>) {
					const code = codeFrom(yield* random.randomBytes(CODE_LENGTH))
					const current = yield* Ref.get(open)
					// Anyone can start a sign-in, so one address keeps at most 20 waiting and everyone 1000; one in about 10^10 draws repeats a live code, and its app starts again.
					if (
						HashMap.size(current) >= 1000 ||
						HashMap.size(HashMap.filter(current, found => Option.contains(address, found.pending.address ?? ''))) >=
							20 ||
						HashMap.has(current, code)
					) {
						return yield* AuthError.make({error: 'temporarily_unavailable', message: 'Start the sign-in again'})
					}
					const now = yield* Clock.currentTimeMillis
					const receiver = Base64Url.encode(yield* random.randomBytes(32))
					const owned = yield* Scope.fork(scope)
					const ref = yield* Scope.provide(run(), owned)
					yield* Ref.update(
						open,
						HashMap.set(code, {
							delivery,
							pending: PendingAuthorization.make({
								...Option.match(address, {onNone: () => ({}), onSome: value => ({address: value})}),
								...Match.valueTags(delivery, {
									Browser: () => ({clientName: 'Browser', kind: 'Browser' as const, resources: []}),
									Client: client => ({
										clientName: client.request.clientName,
										kind: 'App' as const,
										resources: client.request.resources
									})
								}),
								createdAt: now,
								// The machine's lifetime timer.
								expiresAt: now + 10 * 60_000,
								id: code
							}),
							receiver: yield* hash(receiver),
							ref
						})
					)
					yield* pipe(
						ref.join,
						Effect.ignore({log: 'Warn', message: 'A sign-in stopped before it ended'}),
						Effect.andThen(Ref.update(open, HashMap.remove(code))),
						Effect.andThen(changes.publish),
						Effect.ensuring(Scope.close(owned, Exit.void)),
						Effect.forkIn(scope)
					)
					yield* changes.publish
					return {code, receiver}
				}, rejected('Cannot start the sign-in')),
				status: (code, headers) =>
					pipe(
						changes.watch(
							Effect.gen(function* () {
								if (Option.isNone(yield* find(code))) return AuthorizationStatus.cases.Expired.make({})
								const found = yield* received(code, headers)
								const state = (yield* found.ref.snapshot).state
								if (SignInStates.matches(state, 'Open.Waiting')) {
									return AuthorizationStatus.cases.Waiting.make({request: found.pending})
								}
								if (SignInStates.matches(state, 'Open')) return AuthorizationStatus.cases.Decided.make({})
								return AuthorizationStatus.cases.Expired.make({})
							}),
							status => {
								if (status._tag === 'Waiting') return status.request.expiresAt
								return Infinity
							}
						),
						Stream.takeUntil(status => status._tag !== 'Waiting')
					)
			})
		})
	)
}
