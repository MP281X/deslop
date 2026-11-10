import {assert, it} from '@effect/vitest'

import {Clock, Effect, Fiber, Function, Layer, Queue, Ref, Schema, Stream, pipe} from 'effect'

import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {HttpClient} from 'effect/http'
import {AsyncResult, AtomRegistry} from 'effect/reactivity'
import {RpcClientError} from 'effect/rpc'
import {Socket} from 'effect/socket'
import {TestClock} from 'effect/testing'
// oxlint-disable-next-line no-restricted-imports -- Node has no native host; only Expo and React Native imports are stubbed, not session, machine, atom or HTTP behavior.
import {vi} from 'vite-plus/test'

import {ISSUER} from '#auth/lib/utils.ts'
import {AuthError} from '#auth/schema.ts'
import {make} from '#mobile/session.ts'

vi.mock('expo-auth-session', () => ({
	AuthRequest: class {
		clientId = 'fixture-client'
		codeVerifier = 'fixture-verifier'
		promptAsync() {
			// oxlint-disable-next-line eslint/no-restricted-properties -- expo-auth-session's promptAsync answers with a Promise.
			return Effect.runPromise(Effect.succeed({params: {code: 'approved', iss: ISSUER}, type: 'success'}))
		}
	},
	makeRedirectUri: () => 'fixture://auth/callback'
}))
vi.mock('expo-constants', () => ({
	default: {expoConfig: {extra: {scheme: 'fixture'}, slug: 'fixture', version: '0.1.0'}}
}))
vi.mock('expo-updates', () => ({}))
vi.mock('react-native', () => ({Alert: {alert: () => {}}, AppState: {addEventListener: () => ({remove: () => {}})}}))

class DataError extends Schema.TaggedError<DataError>()('DataError', {message: Schema.String}) {}

function session(cleared: Ref.Ref<boolean>) {
	return make('https://fixture.example', {
		clear: Ref.set(cleared, true),
		read: Effect.succeed('{"session":"fixture-session"}'),
		write: () => Effect.void
	})
}

it.layer(AtomRegistry.layer)(test => {
	for (const error of [
		AuthError.make({error: 'access_denied', message: 'Not allowed'}),
		DataError.make({message: 'The list could not be read'}),
		RpcClientError.RpcClientError.make({
			reason: RpcClientError.RpcClientDefect.make({cause: 'invalid data', message: 'Bad frame'})
		})
	]) {
		test.effect(
			`surfaces ${error._tag}: ${error.message} without retrying or signing out`,
			Effect.fnUntraced(function* () {
				const cleared = yield* Ref.make(false)
				const waiting = yield* Effect.forkChild(Stream.runCollect(session(cleared).reopening(Stream.fail(error))))
				yield* TestClock.adjust('2 seconds')
				assert.isDefined(waiting.pollUnsafe())
				assert.strictEqual(yield* Effect.flip(Fiber.join(waiting)), error)
				assert.isFalse(yield* Ref.get(cleared))
			})
		)
	}

	test.effect(
		'signs out once the server refuses the session',
		Effect.fnUntraced(function* () {
			const cleared = yield* Ref.make(false)
			const refusal = AuthError.make({message: 'Sign in first'})
			const waiting = yield* Effect.forkChild(Stream.runCollect(session(cleared).reopening(Stream.fail(refusal))))
			yield* TestClock.adjust('2 seconds')
			assert.strictEqual(yield* Effect.flip(Fiber.join(waiting)), refusal)
			assert.isTrue(yield* Ref.get(cleared))
		})
	)

	for (const error of [
		AuthError.make({error: 'temporarily_unavailable', message: 'Retry later'}),
		RpcClientError.RpcClientError.make({reason: Socket.SocketCloseError.make({code: 1006})})
	]) {
		test.effect(
			`reopens a live stream after ${error.message}`,
			Effect.fnUntraced(function* () {
				const cleared = yield* Ref.make(false)
				const attempts = yield* Ref.make(0)
				const waiting = yield* Effect.forkChild(
					Stream.runCollect(
						session(cleared).reopening(
							Stream.unwrap(
								Effect.map(
									Ref.getAndUpdate(attempts, count => count + 1),
									count => {
										if (count === 0) return Stream.fail(error)
										return Stream.make('recovered')
									}
								)
							)
						)
					)
				)
				yield* TestClock.adjust('2 seconds')
				assert.deepStrictEqual(yield* Fiber.join(waiting), ['recovered'])
				assert.strictEqual(yield* Ref.get(attempts), 2)
				assert.isFalse(yield* Ref.get(cleared))
			})
		)
	}

	test.effect(
		'leaves signing-in after the server stalls exchanging the code for ten seconds',
		Effect.fnUntraced(function* () {
			const current = make('https://fixture.example', {
				clear: Effect.void,
				read: Effect.succeed(''),
				write: () => Effect.void
			})
			const clock = yield* Clock.Clock
			const entered = yield* Queue.unbounded<string>()
			const registry = yield* Effect.acquireRelease(
				Effect.sync(() =>
					AtomRegistry.make({
						initialValues: [
							[
								current.runtime.layer,
								Layer.merge(
									Layer.succeed(
										HttpClient.HttpClient,
										HttpClient.make(request => Effect.andThen(Queue.offer(entered, request.url), Effect.never))
									),
									Layer.succeed(Clock.Clock, clock)
								),
								{skipInitialRun: true}
							]
						]
					})
				),
				value => Effect.sync(() => value.dispose())
			)
			const signedOut = AtomMachine.matches(current.machine, 'SignedOut')
			yield* pipe(AtomRegistry.toStreamResult(registry, signedOut), Stream.filter(Function.identity), Stream.runHead)
			registry.set(current.machine.send, {_tag: 'SignIn'})
			assert.strictEqual(yield* Queue.take(entered), 'https://fixture.example/auth/session')
			yield* TestClock.adjust('9999 millis')
			assert.isFalse(AsyncResult.getOrElse(registry.get(signedOut), () => false))
			yield* TestClock.adjust('1 millis')
			yield* pipe(AtomRegistry.toStreamResult(registry, signedOut), Stream.filter(Function.identity), Stream.runHead)
			assert.isTrue(AsyncResult.getOrElse(registry.get(signedOut), () => false))
		}, Effect.scoped)
	)
})
