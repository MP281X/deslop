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
import {AuthError, isAdmin, isDenied, needsSignIn, rejected} from '#shared/auth.ts'

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
	return pipe(adminIds, Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(env)))
}

const readFixture = Effect.gen(function* () {
	const clock = yield* Clock.Clock
	const incoming = yield* Queue.unbounded<Effect.Effect<string, AuthError | string>>()
	const empty = Atom.make(false)
	const atom = Atom.make(get => {
		if (get(empty)) return keepValueThroughOutages(get, Stream.empty)
		return pipe(
			keepValueThroughOutages(get, pipe(Stream.fromQueue(incoming), Stream.mapEffect(Function.identity)), stream =>
				Stream.retry(stream, $ =>
					pipe(
						$(Schedule.spaced('1 second')),
						Schedule.while(metadata => Schema.is(AuthError)(metadata.input) && metadata.input.error === 'invalid_grant')
					)
				)
			),
			Stream.provideService(Clock.Clock, clock)
		)
	})
	const registry = yield* AtomRegistry.AtomRegistry
	yield* Atom.mount(atom)
	return {
		atom,
		changed: () => Effect.forkChild(pipe(AtomRegistry.toStream(registry, atom), Stream.drop(1), Stream.runHead)),
		empty,
		incoming,
		registry
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
				env.registry.set(env.empty, true)
				assert.isTrue(Option.isNone(AsyncResult.value(env.registry.get(env.atom))))
				assert.isTrue(Option.exists(AsyncResult.error(env.registry.get(env.atom)), isDenied))
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
				assert.deepStrictEqual(AsyncResult.value(env.registry.get(env.atom)), Option.some('private'))
				const refusal = yield* env.changed()
				yield* Queue.offer(env.incoming, Effect.failCause(scenario.cause))
				yield* Fiber.join(refusal)
				assert.isTrue(Option.isNone(AsyncResult.value(env.registry.get(env.atom))))
				assert.isTrue(Option.exists(AsyncResult.error(env.registry.get(env.atom)), isDenied))
				yield* TestClock.adjust('1 second')
				env.registry.set(env.empty, true)
				assert.isTrue(Option.isNone(AsyncResult.value(env.registry.get(env.atom))))
				assert.isTrue(Option.exists(AsyncResult.error(env.registry.get(env.atom)), isDenied))
				env.registry.set(env.empty, false)
				const failed = yield* env.changed()
				yield* Queue.offer(env.incoming, Effect.fail('Later outage'))
				yield* Fiber.join(failed)
				assert.isTrue(Option.isNone(AsyncResult.value(env.registry.get(env.atom))))
				assert.isTrue(Option.exists(AsyncResult.error(env.registry.get(env.atom)), isDenied))
				env.registry.refresh(env.atom)
				const fresh = yield* env.changed()
				yield* Queue.offer(env.incoming, Effect.succeed('private'))
				yield* Fiber.join(fresh)
				assert.deepStrictEqual(AsyncResult.value(env.registry.get(env.atom)), Option.some('private'))
				const outage = yield* env.changed()
				yield* Queue.offer(env.incoming, Effect.fail('Ordinary outage'))
				yield* Fiber.join(outage)
				assert.deepStrictEqual(AsyncResult.value(env.registry.get(env.atom)), Option.some('private'))
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
				assert.deepStrictEqual(AsyncResult.value(env.registry.get(env.atom)), Option.some('private'))
				assert.isFalse(Option.exists(AsyncResult.error(env.registry.get(env.atom)), isDenied))
			})
		)
	)

	test.effect('shows no failure for one dropped read that its retry heals, only for a second in a row', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const clock = yield* Clock.Clock
				const incoming = yield* Queue.unbounded<Effect.Effect<string, string>>()
				const atom = Atom.make(get =>
					pipe(
						keepValueThroughOutages(
							get,
							pipe(Stream.fromQueue(incoming), Stream.mapEffect(Function.identity)),
							stream => Stream.retry(stream, Schedule.spaced('1 second'))
						),
						Stream.provideService(Clock.Clock, clock)
					)
				)
				const registry = yield* AtomRegistry.AtomRegistry
				yield* Atom.mount(atom)
				const loaded = yield* Effect.forkChild(
					pipe(AtomRegistry.toStream(registry, atom), Stream.filter(AsyncResult.isSuccess), Stream.runHead)
				)
				yield* Queue.offer(incoming, Effect.fail('Dropped before the first value'))
				yield* TestClock.adjust('1 second')
				assert.isFalse(AsyncResult.isFailure(registry.get(atom)))
				yield* Queue.offer(incoming, Effect.succeed('private'))
				yield* Fiber.join(loaded)
				yield* Queue.offer(incoming, Effect.fail('Dropped on resume'))
				yield* TestClock.adjust('1 second')
				assert.isTrue(AsyncResult.isSuccess(registry.get(atom)))
				const outage = yield* Effect.forkChild(
					pipe(AtomRegistry.toStream(registry, atom), Stream.filter(AsyncResult.isFailure), Stream.runHead)
				)
				yield* Queue.offer(incoming, Effect.fail('Still down'))
				yield* Fiber.join(outage)
				assert.deepStrictEqual(AsyncResult.value(registry.get(atom)), Option.some('private'))
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
		assert.deepStrictEqual(yield* adminsWith({}), ['0'])
		assert.deepStrictEqual(yield* adminsWith({GITHUB_ADMINS: '7,9'}), ['7', '9'])
		assert.isTrue(Exit.isFailure(yield* Effect.exit(adminsWith({AUTH_URL: 'https://auth.example'}))))
	})
)

it('reads a user’s admin standing from their bare GitHub id', () => {
	assert.isTrue(isAdmin(['7', '9'], 'github:9'))
	assert.isFalse(isAdmin(['7', '9'], 'github:0'))
})

it.effect(
	'keeps an auth failure as it is and wraps anything else',
	Effect.fnUntraced(function* () {
		const signIn = AuthError.make({message: 'Sign in first'})
		assert.strictEqual(yield* Effect.flip(pipe(Effect.fail(signIn), rejected('The app could not be read.'))), signIn)
		const cause = {_tag: 'StorageError', message: 'The store is unreadable.'}
		const error = yield* Effect.flip(pipe(Effect.fail(cause), rejected('The app could not be read.')))
		assert.instanceOf(error, AuthError)
		assert.strictEqual(error.cause, cause)
	})
)
