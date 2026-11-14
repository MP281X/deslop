import {
	Array,
	Boolean,
	Context,
	Duration,
	Effect,
	HashMap,
	Layer,
	Match,
	Option,
	Schema,
	Semaphore,
	Stream,
	Struct,
	pipe
} from 'effect'

import {Digest, SecureRandom} from 'effect/crypto'
import {Cookies} from 'effect/http'
import type {Headers} from 'effect/http'

import {AUTH_URL, AuthError, asAuthError} from '@deslop/runtime/shared/auth'

import {People} from '#services/people/service.ts'
import {makeRecords} from '#services/records/service.ts'
import type {TransientRecord} from '#services/records/service.ts'
import {CODE_LENGTH, SIGN_IN_LIFETIME, codeFrom, typedCode} from '#services/sign-ins/lib/utils.ts'
import type {AnswerParams, AnswerVia, Delivery, SignInCode} from '#services/sign-ins/schema.ts'
import {AuthorizationStatus, Collected, PendingAuthorization} from '#services/sign-ins/schema.ts'
import {
	addressGroup,
	browserLabel,
	browserToken,
	callbackUrl,
	clientIconOf,
	clientLabel,
	deviceLabel,
	hashOf,
	randomTokenOf
} from '#services/tokens/lib/utils.ts'
import type {CredentialOwner, DeviceTokenParams, Origin, TokenResponse} from '#services/tokens/schema.ts'
import {Tokens} from '#services/tokens/service.ts'

export const REQUEST_COOKIE = '__Host-request-'

const expired = AuthError.make({message: 'This sign-in expired. Start it again in the app.'})
const notWaiting = AuthError.make({
	message: `No waiting sign-in has this code: it is mistyped, already answered or expired after ${Duration.toMinutes(SIGN_IN_LIFETIME)} minutes. Read the code again from the page or command that is still waiting; start a new sign-in only if none is.`
})

type SignIn = {
	// None is waiting; Some(None) is denied; Some(Some(owner)) is approved.
	answer: Option.Option<Option.Option<CredentialOwner>>
	delivery: Delivery
	id: SignInCode
	origin: Origin
	receiver: string
}

function pendingOf(entry: TransientRecord<SignIn>) {
	const signIn = entry.value
	return PendingAuthorization.make({
		address: signIn.origin.address,
		clientName: Match.valueTags(signIn.delivery, {
			Browser: () => browserLabel(signIn.origin),
			Client: client => clientLabel(client.request.clientName),
			Device: device => clientLabel(device.request.clientName)
		}),
		device: deviceLabel(signIn.origin),
		expiresAt: entry.expiresAt,
		icon: Match.valueTags(signIn.delivery, {
			Browser: () => Option.none<string>(),
			Client: client => clientIconOf(client.request.clientId),
			Device: device => clientIconOf(device.request.clientId)
		}),
		id: signIn.id,
		kind: Boolean.match(signIn.delivery._tag === 'Browser', {onFalse: () => 'App', onTrue: () => 'Browser'})
	})
}

function codeOf(code: SignInCode) {
	return Schema.decodeOption(PendingAuthorization.fields.id)(typedCode(code))
}

export class SignIns extends Context.Service<
	SignIns,
	{
		readonly answer: (
			params: AnswerParams,
			owner: CredentialOwner,
			via: AnswerVia
		) => Effect.Effect<{clientName: string}, AuthError>
		readonly collect: (code: SignInCode, headers: Headers.Headers) => Effect.Effect<Collected, AuthError>
		readonly lookup: (code: SignInCode) => Stream.Stream<Option.Option<PendingAuthorization>>
		readonly poll: (params: DeviceTokenParams) => Effect.Effect<TokenResponse, AuthError>
		readonly start: (
			delivery: Delivery,
			origin: Origin
		) => Effect.Effect<{code: SignInCode; receiver: string}, AuthError>
		readonly status: (code: SignInCode, headers: Headers.Headers) => Stream.Stream<AuthorizationStatus, AuthError>
	}
>()('@deslop/auth/services/sign-ins/service/SignIns') {
	static readonly layer = Layer.effect(
		SignIns,
		Effect.gen(function* () {
			const tokens = yield* Tokens
			const people = yield* People
			const random = yield* SecureRandom.SecureRandom
			const randomToken = randomTokenOf(random)
			const hash = hashOf(yield* Digest.Digest)
			const records = yield* makeRecords<SignInCode, SignIn>(SIGN_IN_LIFETIME)
			// Answers, admission and delivery take turns. A failed delivery leaves its answer available for a retry.
			const changing = yield* Semaphore.make(1)
			function find(code: SignInCode) {
				return Option.match(codeOf(code), {
					onNone: () => Effect.succeed(Option.none<TransientRecord<SignIn>>()),
					onSome: records.get
				})
			}
			function watch(code: SignInCode) {
				return pipe(
					records.changes,
					Stream.map(entries => Option.flatMap(codeOf(code), id => HashMap.get(entries, id))),
					Stream.changes
				)
			}
			const received = Effect.fnUntraced(function* (entry: TransientRecord<SignIn>, headers: Headers.Headers) {
				const token = Cookies.parseHeader(headers['cookie'] ?? '')[`${REQUEST_COOKIE}${entry.value.id}`]
				if (token === undefined) return yield* AuthError.make({message: 'Open the sign-in link again'})
				if ((yield* hash(token)) !== entry.value.receiver) {
					return yield* AuthError.make({message: 'The sign-in belongs to another browser'})
				}
				return entry
			})
			const deliver = Effect.fnUntraced(function* (entry: TransientRecord<SignIn>, previous: Option.Option<string>) {
				const signIn = entry.value
				if (Option.isNone(signIn.answer)) {
					return yield* AuthError.make({message: 'This sign-in is still waiting for approval'})
				}
				const approver = yield* Effect.option(
					pipe(yield* Effect.fromOption(signIn.answer), Effect.fromOption, Effect.flatMap(people.allowed))
				)
				const collected = yield* Match.valueTags(signIn.delivery, {
					Browser: browser =>
						Option.match(approver, {
							onNone: () => Effect.succeed(Collected.cases.Redirect.make({url: '/'})),
							onSome: user =>
								Effect.map(tokens.startSession(user, signIn.origin, 'Code', previous), started =>
									Collected.cases.Session.make({...started, ...Struct.pick(browser, ['next'])})
								)
						}),
					Client: client =>
						Option.match(approver, {
							onNone: () =>
								Effect.succeed(
									Collected.cases.Redirect.make({
										url: callbackUrl(client.request, {error: 'access_denied'}, tokens.issuer)
									})
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
								Effect.map(tokens.device(device.request, user, signIn.origin), granted =>
									Collected.cases.Granted.make({tokens: granted})
								)
						})
				})
				yield* records.consume(signIn.id, Option.none())
				return collected
			})
			return SignIns.of({
				answer: Effect.fn('SignIns.answer')(
					function* (params: AnswerParams, owner: CredentialOwner, via: AnswerVia) {
						yield* people.allowed(owner)
						const entry = yield* pipe(
							find(params.request),
							Effect.flatMap(Effect.fromOption),
							Effect.mapError(() => notWaiting)
						)
						if (Option.isSome(entry.value.answer)) return yield* notWaiting
						if (via === 'Token' && entry.value.delivery._tag === 'Browser') {
							return yield* AuthError.make({
								message: `A browser sign-in is approved only from a signed-in browser: ask the user to approve it at ${AUTH_URL}`
							})
						}
						yield* records.update(entry.value.id, signIn => ({
							...signIn,
							answer: Option.some(Option.liftPredicate(owner, () => params.accept))
						}))
						return {clientName: pendingOf(entry).clientName}
					},
					Semaphore.withPermit(changing),
					asAuthError('Cannot answer the sign-in')
				),
				collect: Effect.fn('SignIns.collect')(
					function* (code: SignInCode, headers: Headers.Headers) {
						return yield* deliver(
							yield* received(
								yield* pipe(
									find(code),
									Effect.flatMap(Effect.fromOption),
									Effect.mapError(() => expired)
								),
								headers
							),
							browserToken(headers)
						)
					},
					Effect.uninterruptible,
					Semaphore.withPermit(changing),
					asAuthError('Cannot complete the sign-in')
				),
				lookup: code =>
					pipe(
						watch(code),
						Stream.map(found =>
							pipe(
								found,
								Option.filter(entry => Option.isNone(entry.value.answer)),
								Option.map(pendingOf)
							)
						),
						Stream.withSpan('SignIns.lookup', {attributes: {'rpc.stream': true}})
					),
				poll: Effect.fn('SignIns.poll')(
					function* (params: DeviceTokenParams) {
						const receiver = yield* hash(params.device_code)
						const entry = yield* pipe(
							yield* records.values,
							Array.findFirst(record => record.value.receiver === receiver),
							Effect.fromOption,
							Effect.mapError(() =>
								AuthError.make({error: 'expired_token', message: 'The device code expired; sign in again'})
							)
						)
						if (entry.value.delivery._tag !== 'Device' || entry.value.delivery.request.clientId !== params.client_id) {
							return yield* AuthError.make({
								error: 'invalid_grant',
								message: 'The device code belongs to another client'
							})
						}
						if (Option.isNone(entry.value.answer)) {
							return yield* AuthError.make({error: 'authorization_pending', message: 'Waiting for approval'})
						}
						const answer = yield* deliver(entry, Option.none())
						if (answer._tag !== 'Granted') {
							return yield* AuthError.make({error: 'access_denied', message: 'The sign-in was denied'})
						}
						return answer.tokens
					},
					Effect.uninterruptible,
					Semaphore.withPermit(changing),
					asAuthError('Cannot complete the sign-in')
				),
				start: Effect.fn('SignIns.start')(
					function* (delivery: Delivery, origin: Origin) {
						const code = codeFrom(yield* random.randomBytes(CODE_LENGTH))
						const receiver = yield* randomToken(32)
						const group = addressGroup(Option.getOrElse(origin.address, () => 'unknown'))
						const current = yield* records.values
						const fromGroup = Array.filter(
							current,
							entry => addressGroup(Option.getOrElse(entry.value.origin.address, () => 'unknown')) === group
						)
						if (current.length >= 1000 || fromGroup.length >= 20 || Option.isSome(yield* records.get(code))) {
							return yield* AuthError.make({error: 'temporarily_unavailable', message: 'Start the sign-in again'})
						}
						yield* records.create(code, {
							answer: Option.none(),
							delivery,
							id: code,
							origin,
							receiver: yield* hash(receiver)
						})
						return {code, receiver}
					},
					Semaphore.withPermit(changing),
					asAuthError('Cannot start the sign-in')
				),
				status: (code, headers) =>
					pipe(
						watch(code),
						Stream.mapEffect(found =>
							Option.match(found, {
								onNone: () => Effect.succeed<AuthorizationStatus>(AuthorizationStatus.cases.Expired.make({})),
								onSome: entry =>
									Effect.map(received(entry, headers), signIn =>
										Boolean.match(Option.isNone(signIn.value.answer), {
											onFalse: () => AuthorizationStatus.cases.Decided.make({}),
											onTrue: () => AuthorizationStatus.cases.Waiting.make({request: pendingOf(signIn)})
										})
									)
							})
						),
						Stream.takeUntil(status => status._tag !== 'Waiting'),
						Stream.withSpan('SignIns.status', {attributes: {'rpc.stream': true}})
					)
			})
		})
	)
}
