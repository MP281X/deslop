import {assert, it} from '@effect/vitest'

import {
	Array,
	Cause,
	Clock,
	ConfigProvider,
	Effect,
	Exit,
	Fiber,
	Function,
	Option,
	Queue,
	Schedule,
	Schema,
	Stream,
	pipe
} from 'effect'

import {AsyncResult, Atom, AtomRegistry} from 'effect/reactivity'
import {TestClock} from 'effect/testing'

import {keepValueThroughOutages} from '#client/live-stream.ts'
import {adminIds} from '#server/auth.ts'
import {AuthError, GitHubId, UserId, isAdmin, isDenied, needsSignIn, asAuthError} from '#shared/auth.ts'

function namesOf(error: AuthError) {
	return Array.map(Cause.prettyErrors(Cause.fail(error)), rendered => rendered.name)
}

it('names an authorization outage apart from a refusal', () => {
	const outage = AuthError.make({error: 'temporarily_unavailable', message: 'Retry later'})
	assert.deepStrictEqual(namesOf(AuthError.make({message: 'Sign in first'})), ['AuthError'])
	assert.deepStrictEqual(namesOf(outage), ['AuthUnavailable'])
	assert.strictEqual(outage._tag, 'AuthError')
	assert.isTrue(Schema.is(AuthError)(outage))
})

function adminsWith(env: Record<string, string>) {
	return Effect.provideService(adminIds, ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(env))
}

const readFixture = Effect.gen(function* () {
	const clock = yield* Clock.Clock
	const incoming = yield* Queue.unbounded<Effect.Effect<string, AuthError | string>>()
	const emptyAtom = Atom.make(false)
	const valueAtom = Atom.make(get => {
		if (get(emptyAtom)) return keepValueThroughOutages(get, Stream.empty)
		return Stream.provideService(
			keepValueThroughOutages(get, Stream.mapEffect(Stream.fromQueue(incoming), Function.identity), stream =>
				Stream.retry(stream, $ =>
					Schedule.while(
						$(Schedule.spaced('1 second')),
						metadata => Schema.is(AuthError)(metadata.input) && metadata.input.error === 'invalid_grant'
					)
				)
			),
			Clock.Clock,
			clock
		)
	})
	const registry = yield* AtomRegistry.AtomRegistry
	yield* Atom.mount(valueAtom)
	return {
		changed: () => Effect.forkChild(pipe(AtomRegistry.toStream(registry, valueAtom), Stream.drop(1), Stream.runHead)),
		emptyAtom,
		incoming,
		registry,
		valueAtom
	}
})

it.layer(AtomRegistry.layer)(test => {
	test.effect('keeps an initial refusal through an empty retry without any previous data', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const env = yield* readFixture
				const refused = yield* env.changed()
				yield* Queue.offer(env.incoming, Effect.fail(AuthError.make({error: 'access_denied', message: 'Denied'})))
				yield* Fiber.join(refused)
				env.registry.set(env.emptyAtom, true)
				assert.isTrue(Option.isNone(AsyncResult.value(env.registry.get(env.valueAtom))))
				assert.isTrue(Option.exists(AsyncResult.error(env.registry.get(env.valueAtom)), isDenied))
			})
		)
	)

	test.effect.each([
		{
			cause: Cause.fail<AuthError | string>(AuthError.make({error: 'access_denied', message: 'Denied'})),
			name: 'a terminal refusal'
		},
		{
			cause: Cause.fail<AuthError | string>(AuthError.make({error: 'invalid_grant', message: 'Renew'})),
			name: 'a refused bearer swallowed by renewal'
		},
		{
			cause: Cause.fromReasons<AuthError | string>([
				Cause.makeFailReason('Offline'),
				Cause.makeFailReason(AuthError.make({error: 'access_denied', message: 'Denied'}))
			]),
			name: 'a denial after an ordinary error in a combined cause'
		}
	])('invalidates data before recovery after $name, until a real authorized emission', scenario =>
		Effect.scoped(
			Effect.gen(function* () {
				const env = yield* readFixture
				const first = yield* env.changed()
				yield* Queue.offer(env.incoming, Effect.succeed('private'))
				yield* Fiber.join(first)
				assert.deepStrictEqual(AsyncResult.value(env.registry.get(env.valueAtom)), Option.some('private'))
				const refusal = yield* env.changed()
				yield* Queue.offer(env.incoming, Effect.failCause(scenario.cause))
				yield* Fiber.join(refusal)
				assert.isTrue(Option.isNone(AsyncResult.value(env.registry.get(env.valueAtom))))
				assert.isTrue(Option.exists(AsyncResult.error(env.registry.get(env.valueAtom)), isDenied))
				yield* TestClock.adjust('1 second')
				env.registry.set(env.emptyAtom, true)
				assert.isTrue(Option.isNone(AsyncResult.value(env.registry.get(env.valueAtom))))
				assert.isTrue(Option.exists(AsyncResult.error(env.registry.get(env.valueAtom)), isDenied))
				env.registry.set(env.emptyAtom, false)
				const failed = yield* env.changed()
				yield* Queue.offer(env.incoming, Effect.fail('Later outage'))
				yield* Fiber.join(failed)
				assert.isTrue(Option.isNone(AsyncResult.value(env.registry.get(env.valueAtom))))
				assert.isTrue(Option.exists(AsyncResult.error(env.registry.get(env.valueAtom)), isDenied))
				env.registry.refresh(env.valueAtom)
				const fresh = yield* env.changed()
				yield* Queue.offer(env.incoming, Effect.succeed('private'))
				yield* Fiber.join(fresh)
				assert.deepStrictEqual(AsyncResult.value(env.registry.get(env.valueAtom)), Option.some('private'))
				const outage = yield* env.changed()
				yield* Queue.offer(env.incoming, Effect.fail('Ordinary outage'))
				yield* Fiber.join(outage)
				assert.deepStrictEqual(AsyncResult.value(env.registry.get(env.valueAtom)), Option.some('private'))
			})
		)
	)

	test.effect('retains authorized data during a temporary authorization outage', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const env = yield* readFixture
				const first = yield* env.changed()
				yield* Queue.offer(env.incoming, Effect.succeed('private'))
				yield* Fiber.join(first)
				const outage = yield* env.changed()
				yield* Queue.offer(
					env.incoming,
					Effect.fail(AuthError.make({error: 'temporarily_unavailable', message: 'Retry later'}))
				)
				yield* Fiber.join(outage)
				assert.deepStrictEqual(AsyncResult.value(env.registry.get(env.valueAtom)), Option.some('private'))
				assert.isFalse(Option.exists(AsyncResult.error(env.registry.get(env.valueAtom)), isDenied))
			})
		)
	)

	test.effect('shows no failure for one dropped read that its retry heals, only for a second in a row', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const clock = yield* Clock.Clock
				const incoming = yield* Queue.unbounded<Effect.Effect<string, string>>()
				const valueAtom = Atom.make(get =>
					Stream.provideService(
						keepValueThroughOutages(get, Stream.mapEffect(Stream.fromQueue(incoming), Function.identity), stream =>
							Stream.retry(stream, Schedule.spaced('1 second'))
						),
						Clock.Clock,
						clock
					)
				)
				const registry = yield* AtomRegistry.AtomRegistry
				yield* Atom.mount(valueAtom)
				const loaded = yield* Effect.forkChild(
					pipe(AtomRegistry.toStream(registry, valueAtom), Stream.filter(AsyncResult.isSuccess), Stream.runHead)
				)
				yield* Queue.offer(incoming, Effect.fail('Dropped before the first value'))
				yield* TestClock.adjust('1 second')
				assert.isFalse(AsyncResult.isFailure(registry.get(valueAtom)))
				yield* Queue.offer(incoming, Effect.succeed('private'))
				yield* Fiber.join(loaded)
				yield* Queue.offer(incoming, Effect.fail('Dropped on resume'))
				yield* TestClock.adjust('1 second')
				assert.isTrue(AsyncResult.isSuccess(registry.get(valueAtom)))
				const outage = yield* Effect.forkChild(
					pipe(AtomRegistry.toStream(registry, valueAtom), Stream.filter(AsyncResult.isFailure), Stream.runHead)
				)
				yield* Queue.offer(incoming, Effect.fail('Still down'))
				yield* Fiber.join(outage)
				assert.deepStrictEqual(AsyncResult.value(registry.get(valueAtom)), Option.some('private'))
			})
		)
	)
})

it('redirects missing credentials, not authorization outages or denied access', () => {
	assert.isTrue(needsSignIn(AuthError.make({message: 'Sign in first'})))
	assert.isFalse(needsSignIn(AuthError.make({error: 'temporarily_unavailable', message: 'Retry later'})))
	assert.isFalse(needsSignIn(AuthError.make({error: 'access_denied', message: 'Admins only'})))
	assert.isFalse(needsSignIn({_tag: 'NetworkError', message: 'Connection lost'}))
})

it.effect(
	'names the local developer as admin unless GITHUB_ADMINS says otherwise',
	Effect.fnUntraced(function* () {
		assert.deepStrictEqual(yield* adminsWith({}), [GitHubId.make(0)])
		assert.deepStrictEqual(yield* adminsWith({GITHUB_ADMINS: '7,9'}), [GitHubId.make(7), GitHubId.make(9)])
		assert.isTrue(Exit.isFailure(yield* Effect.exit(adminsWith({AUTH_URL: 'https://auth.example'}))))
	})
)

it('reads a user’s admin standing from their bare GitHub id', () => {
	assert.isTrue(isAdmin([GitHubId.make(7), GitHubId.make(9)], UserId.make('github:9')))
	assert.isFalse(isAdmin([GitHubId.make(7), GitHubId.make(9)], UserId.make('github:0')))
})

it.effect(
	'keeps an auth failure as it is and wraps anything else',
	Effect.fnUntraced(function* () {
		const signIn = AuthError.make({message: 'Sign in first'})
		assert.strictEqual(yield* Effect.flip(asAuthError('The app could not be read.')(Effect.fail(signIn))), signIn)
		const cause = {_tag: 'StorageError', message: 'The store is unreadable.'}
		const error = yield* Effect.flip(asAuthError('The app could not be read.')(Effect.fail(cause)))
		assert.instanceOf(error, AuthError)
		assert.strictEqual(error.cause, cause)
	})
)
