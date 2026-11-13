import {
	Array,
	Clock,
	Context,
	Duration,
	Effect,
	Exit,
	HashMap,
	Layer,
	Match,
	Option,
	Schema,
	Scope,
	Semaphore,
	Stream,
	Struct,
	SubscriptionRef,
	pipe
} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {Digest, SecureRandom} from 'effect/crypto'
import {Cookies} from 'effect/http'
import type {Headers} from 'effect/http'

import {AUTH_URL, AuthError, asAuthError} from '@deslop/runtime/shared/auth'

import {People} from '#services/people/service.ts'
import {CODE_LENGTH, SIGN_IN_LIFETIME, codeFrom, typedCode} from '#services/sign-ins/lib/utils.ts'
import type {AnswerParams, Delivery} from '#services/sign-ins/schema.ts'
import {AuthorizationStatus, Collected, PendingAuthorization, SignInInput} from '#services/sign-ins/schema.ts'
import {
	addressGroup,
	browserLabel,
	browserToken,
	callbackUrl,
	clientLabel,
	deviceLabel,
	hashOf,
	randomTokenOf
} from '#services/tokens/lib/utils.ts'
import {CredentialOwner} from '#services/tokens/schema.ts'
import type {DeviceTokenParams, Origin, TokenResponse} from '#services/tokens/schema.ts'
import {Tokens} from '#services/tokens/service.ts'

export const REQUEST_COOKIE = '__Host-request-'

const expired = AuthError.make({message: 'This sign-in expired. Start it again in the app.'})
const notWaiting = AuthError.make({
	message: `No waiting sign-in has this code: it is mistyped, already answered or expired after ${Duration.toMinutes(SIGN_IN_LIFETIME)} minutes. Read the code again from the page or command that is still waiting; start a new sign-in only if none is.`
})

const deliver = Effect.fnUntraced(function* (input: {
	delivery: Delivery
	origin: Origin
	owner?: CredentialOwner
	previous: string
}) {
	const tokens = yield* Tokens
	const people = yield* People
	const approver = yield* Effect.option(
		Effect.flatMap(Effect.fromOption(Option.fromUndefinedOr(input.owner)), people.allowed)
	)
	return yield* Match.valueTags(input.delivery, {
		Browser: browser =>
			Option.match(approver, {
				onNone: () => Effect.succeed(Collected.cases.Redirect.make({url: '/'})),
				onSome: user =>
					Effect.map(tokens.startSession(user, input.origin, 'Code', input.previous), started =>
						Collected.cases.Session.make({...started, ...Struct.pick(browser, ['next'])})
					)
			}),
		Client: client =>
			Option.match(approver, {
				onNone: () =>
					Effect.succeed(
						Collected.cases.Redirect.make({url: callbackUrl(client.request, {error: 'access_denied'}, tokens.issuer)})
					),
				onSome: user =>
					Effect.map(tokens.issue(client.request, user), code =>
						Collected.cases.Redirect.make({url: callbackUrl(client.request, {code}, tokens.issuer)})
					)
			}),
		Device: device =>
			Option.match(approver, {
				onNone: () => Effect.succeed(Collected.cases.Denied.make({})),
				onSome: user =>
					Effect.map(tokens.device(device.request, user, input.origin), granted =>
						Collected.cases.Granted.make({tokens: granted})
					)
			})
	})
})

const SignInStates = Machine.state({
	states: {
		Delivered: {fields: {collected: Collected}, type: 'final'},
		Expired: {type: 'final'},
		Open: {
			fields: SignInInput.fields,
			states: {
				Approved: {fields: {owner: CredentialOwner}},
				Delivering: {fields: {owner: Schema.optionalKey(CredentialOwner), previous: Schema.String}},
				Denied: {},
				Failed: {fields: {message: Schema.String, owner: Schema.optionalKey(CredentialOwner)}},
				Waiting: {}
			}
		}
	}
})

// A sign-in waits for one answer; /auth/continue then delivers it once, and any step ends ten minutes after the start.
const SignIn = Machine.make({
	branches: {answered: {approved: {target: 'Open.Approved'}, denied: {target: 'Open.Denied'}}},
	effects: {deliver},
	events: Machine.events({
		Answered: {accept: Schema.Boolean, owner: CredentialOwner},
		Collect: {previous: Schema.String}
	}),
	input: SignInInput,
	root: SignInStates,
	timers: {lifetime: SIGN_IN_LIFETIME}
}).handle({
	initial: {data: transition => transition.input, target: 'Open'},
	states: {
		Delivered: {},
		Expired: {},
		Open: {
			initial: {target: 'Open.Waiting'},
			invoke: {onDone: {target: 'Expired'}, src: 'lifetime'},
			states: {
				Approved: {
					on: {
						Collect: {
							data: transition => ({owner: transition.state.owner, previous: transition.event.previous}),
							target: 'Open.Delivering'
						}
					}
				},
				Delivering: {
					invoke: {
						input: transition => ({
							...Struct.pick(transition.ancestors.Open, ['delivery', 'origin']),
							...Struct.pick(transition.state, ['owner', 'previous'])
						}),
						onDone: {data: transition => ({collected: transition.output}), target: 'Delivered'},
						onFailure: {
							data: transition => ({...Struct.pick(transition.state, ['owner']), message: transition.error.message}),
							target: 'Open.Failed'
						},
						src: 'deliver'
					}
				},
				Denied: {
					on: {Collect: {data: transition => ({previous: transition.event.previous}), target: 'Open.Delivering'}}
				},
				Failed: {
					on: {
						Collect: {
							data: transition => ({...Struct.pick(transition.state, ['owner']), previous: transition.event.previous}),
							target: 'Open.Delivering'
						}
					}
				},
				Waiting: {
					on: {
						Answered: {
							branches: 'answered',
							resolve: transition => {
								if (transition.event.accept) return transition.select.approved({data: {owner: transition.event.owner}})
								return transition.select.denied()
							}
						}
					}
				}
			}
		}
	}
})

function run(input: SignInInput) {
	return Machine.start(SignIn, input)
}

type Open = {pending: PendingAuthorization; receiver: string; ref: Effect.Success<ReturnType<typeof run>>}

export class SignIns extends Context.Service<
	SignIns,
	{
		// A browser sign-in is approved only from a signed-in browser, never with a token an agent holds.
		readonly answer: (
			params: AnswerParams,
			owner: CredentialOwner,
			via: 'Session' | 'Token'
		) => Effect.Effect<{clientName: string}, AuthError>
		readonly collect: (code: string, headers: Headers.Headers) => Effect.Effect<Collected, AuthError>
		readonly lookup: (code: string) => Stream.Stream<Option.Option<PendingAuthorization>>
		readonly poll: (params: DeviceTokenParams) => Effect.Effect<TokenResponse, AuthError>
		readonly start: (delivery: Delivery, origin: Origin) => Effect.Effect<{code: string; receiver: string}, AuthError>
		readonly status: (code: string, headers: Headers.Headers) => Stream.Stream<AuthorizationStatus, AuthError>
	}
>()('@deslop/auth/services/sign-ins/service/SignIns') {
	// Sign-ins live in memory: a restart ends the waiting ones, and their apps start again.
	static readonly layer = Layer.effect(
		SignIns,
		Effect.gen(function* () {
			const tokens = yield* Tokens
			const people = yield* People
			const random = yield* SecureRandom.SecureRandom
			const randomToken = randomTokenOf(random)
			const hash = hashOf(yield* Digest.Digest)
			const scope = yield* Effect.scope
			const open = yield* SubscriptionRef.make(HashMap.empty<string, Open>())
			const answering = yield* Semaphore.make(1)
			function find(code: string) {
				return Effect.map(SubscriptionRef.get(open), HashMap.get(typedCode(code)))
			}
			function watch(code: string) {
				return Stream.switchMap(SubscriptionRef.changes(open), current =>
					pipe(
						current,
						pipelineSubject7337 => HashMap.get(pipelineSubject7337, typedCode(code)),
						pipelineSubject7324 =>
							Option.match(pipelineSubject7324, {
								onNone: () =>
									Stream.succeed(
										Option.none<{signIn: Open; state: Effect.Success<Open['ref']['snapshot']>['state']}>()
									),
								onSome: signIn =>
									Stream.map(signIn.ref.changes, snapshot => Option.some({signIn, state: snapshot.state}))
							})
					)
				)
			}
			// Only the browser or command that started a sign-in, holding its cookie, receives the answer.
			const received = Effect.fnUntraced(function* (signIn: Open, headers: Headers.Headers) {
				const token = Cookies.parseHeader(headers['cookie'] ?? '')[`${REQUEST_COOKIE}${signIn.pending.id}`]
				if (token === undefined) return yield* AuthError.make({message: 'Open the sign-in link again'})
				if ((yield* hash(token)) !== signIn.receiver) {
					return yield* AuthError.make({message: 'The sign-in belongs to another browser'})
				}
				return signIn
			})
			const delivered = Effect.fnUntraced(function* (signIn: Open, previous: string) {
				yield* signIn.ref.send({_tag: 'Collect', previous})
				const done = yield* Effect.mapError(
					Machine.waitFor(
						signIn.ref,
						snapshot =>
							!SignInStates.matches(snapshot.state, 'Open') || SignInStates.matches(snapshot.state, 'Open.Failed')
					),
					() => expired
				)
				return yield* Option.match(SignInStates.get(done.state, 'Delivered'), {
					onNone: () =>
						Option.match(SignInStates.get(done.state, 'Open.Failed'), {
							onNone: () => Effect.fail(expired),
							onSome: failed => Effect.fail(AuthError.make({message: failed.message}))
						}),
					onSome: found => Effect.succeed(found.collected)
				})
			})

			return SignIns.of({
				answer: Effect.fn('SignIns.answer')(function* (
					params: AnswerParams,
					owner: CredentialOwner,
					via: 'Session' | 'Token'
				) {
					yield* people.allowed(owner)
					const signIn = yield* Effect.mapError(Effect.fromOption(yield* find(params.request)), () => notWaiting)
					if (via === 'Token' && signIn.pending.kind === 'Browser') {
						return yield* AuthError.make({
							message: `A browser sign-in is approved only from a signed-in browser: ask the user to approve it at ${AUTH_URL}`
						})
					}
					// Answers take turns until the machine leaves Waiting, so the one that finds it waiting is the one it takes.
					yield* Semaphore.withPermit(
						answering,
						Effect.gen(function* () {
							if (!SignInStates.matches((yield* signIn.ref.snapshot).state, 'Open.Waiting')) return yield* notWaiting
							yield* signIn.ref.send({_tag: 'Answered', accept: params.accept, owner})
							const answered = yield* Machine.waitFor(
								signIn.ref,
								snapshot => !SignInStates.matches(snapshot.state, 'Open.Waiting')
							)
							if (SignInStates.matches(answered.state, 'Expired')) return yield* expired
						})
					)
					return {clientName: signIn.pending.clientName}
				}, asAuthError('Cannot answer the sign-in')),
				collect: Effect.fn('SignIns.collect')(function* (code: string, headers: Headers.Headers) {
					const signIn = yield* received(
						yield* Effect.mapError(Effect.fromOption(yield* find(code)), () => expired),
						headers
					)
					if (SignInStates.matches((yield* signIn.ref.snapshot).state, 'Open.Waiting')) {
						return yield* AuthError.make({message: 'This sign-in is still waiting for approval'})
					}
					return yield* delivered(signIn, browserToken(headers))
				}, asAuthError('Cannot complete the sign-in')),
				lookup: code =>
					Stream.map(watch(code), found =>
						Option.flatMap(found, current =>
							Option.liftPredicate(current.signIn.pending, () => SignInStates.matches(current.state, 'Open.Waiting'))
						)
					),
				// RFC 8628 §3.5: the command asks again every few seconds until the code is answered or expires.
				poll: Effect.fn('SignIns.poll')(function* (params: DeviceTokenParams) {
					const receiver = yield* hash(params.device_code)
					const signIn = yield* Effect.mapError(
						Effect.fromOption(
							Array.findFirst(HashMap.toValues(yield* SubscriptionRef.get(open)), entry => entry.receiver === receiver)
						),
						() => AuthError.make({error: 'expired_token', message: 'The device code expired; sign in again'})
					)
					const snapshot = yield* signIn.ref.snapshot
					if (
						!Option.exists(
							SignInStates.get(snapshot.state, 'Open'),
							found => found.delivery._tag === 'Device' && found.delivery.request.clientId === params.client_id
						)
					) {
						return yield* AuthError.make({error: 'invalid_grant', message: 'The device code belongs to another client'})
					}
					if (SignInStates.matches(snapshot.state, 'Open.Waiting')) {
						return yield* AuthError.make({error: 'authorization_pending', message: 'Waiting for approval'})
					}
					const answer = yield* delivered(signIn, '')
					if (answer._tag !== 'Granted') {
						return yield* AuthError.make({error: 'access_denied', message: 'The sign-in was denied'})
					}
					return answer.tokens
				}, asAuthError('Cannot complete the sign-in')),
				start: Effect.fn('SignIns.start')(function* (delivery: Delivery, origin: Origin) {
					const code = codeFrom(yield* random.randomBytes(CODE_LENGTH))
					const now = yield* Clock.currentTimeMillis
					const receiver = yield* randomToken(32)
					const owned = yield* Scope.fork(scope)
					const ref = yield* pipe(
						run({delivery, origin}),
						Effect.provideService(Tokens, tokens),
						Effect.provideService(People, people),
						Scope.provide(owned)
					)
					const signIn = {
						pending: PendingAuthorization.make({
							...Option.match(Option.fromUndefinedOr(origin.address), {
								onNone: () => ({}),
								onSome: address => ({address})
							}),
							...Match.valueTags(delivery, {
								Browser: () => ({
									clientName: browserLabel(origin),
									device: deviceLabel(origin),
									kind: 'Browser' as const
								}),
								Client: client => ({
									clientName: clientLabel(client.request.clientName),
									device: deviceLabel(origin),
									kind: 'App' as const
								}),
								Device: device => ({
									clientName: clientLabel(device.request.clientName),
									device: deviceLabel(origin),
									kind: 'App' as const
								})
							}),
							// The machine's lifetime timer.
							expiresAt: now + Duration.toMillis(SIGN_IN_LIFETIME),
							id: code
						}),
						receiver: yield* hash(receiver),
						ref
					}
					// Anyone can start a sign-in, so one address (an IPv6 /64) keeps at most 20 waiting and everyone 1000; checked and taken in one step.
					const admitted = yield* SubscriptionRef.modify(open, current => {
						// Sign-ins without a known address share one group.
						const group = addressGroup(origin.address ?? 'unknown')
						const fromGroup = HashMap.size(
							HashMap.filter(current, other => addressGroup(other.pending.address ?? 'unknown') === group)
						)
						if (HashMap.size(current) >= 1000 || fromGroup >= 20 || HashMap.has(current, code)) return [false, current]
						return [true, HashMap.set(current, code, signIn)]
					})
					if (!admitted) {
						yield* Scope.close(owned, Exit.void)
						return yield* AuthError.make({error: 'temporarily_unavailable', message: 'Start the sign-in again'})
					}
					yield* pipe(
						ref.join,
						Effect.ignore({log: 'Warn', message: 'A sign-in stopped before it ended'}),
						Effect.andThen(SubscriptionRef.update(open, HashMap.remove(code))),
						Effect.ensuring(Scope.close(owned, Exit.void)),
						Effect.forkIn(scope)
					)
					return {code, receiver}
				}, asAuthError('Cannot start the sign-in')),
				status: (code, headers) =>
					pipe(
						watch(code),
						Stream.mapEffect(found =>
							Option.match(found, {
								onNone: () => Effect.succeed(AuthorizationStatus.cases.Expired.make({})),
								onSome: current =>
									Effect.map(received(current.signIn, headers), signIn => {
										if (SignInStates.matches(current.state, 'Open.Waiting')) {
											return AuthorizationStatus.cases.Waiting.make({request: signIn.pending})
										}
										if (SignInStates.matches(current.state, 'Open')) return AuthorizationStatus.cases.Decided.make({})
										return AuthorizationStatus.cases.Expired.make({})
									})
							})
						),
						Stream.takeUntil(status => status._tag !== 'Waiting')
					)
			})
		})
	)
}
