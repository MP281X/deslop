import {assert, it} from '@effect/vitest'

import {Array, Deferred, Effect, Function, Queue, Ref} from 'effect'

import {TestClock} from 'effect/testing'

import {registerPushTokens} from '#mobile/push-token.ts'
import {AuthError} from '#shared/auth.ts'

type Token = {data: string}

it.effect(
	'registers a rotation that arrives before the first read answers, never the older read',
	Effect.fnUntraced(function* () {
		const listeners = yield* Queue.unbounded<(token: Token) => void>()
		const registered = yield* Queue.unbounded<string>()
		const firstRead = yield* Deferred.make<Token>()
		const firstReadAnswered = yield* Deferred.make<void>()
		yield* Effect.forkChild(
			registerPushTokens(
				listener => {
					Queue.offerUnsafe(listeners, listener)
					return {remove: Function.constVoid}
				},
				Effect.tap(Deferred.await(firstRead), () => Deferred.succeed(firstReadAnswered, undefined)),
				token => Queue.offer(registered, token)
			)
		)
		const listener = yield* Queue.take(listeners)
		listener({data: 'rotated'})
		assert.strictEqual(yield* Queue.take(registered), 'rotated')
		yield* Deferred.succeed(firstRead, {data: 'stale'})
		// The older read settles before the next rotation, so a registration of it would come first.
		yield* Deferred.await(firstReadAnswered)
		yield* Effect.forEach(Array.range(1, 10), () => Effect.yieldNow, {concurrency: 1, discard: true})
		listener({data: 'next'})
		assert.strictEqual(yield* Queue.take(registered), 'next')
	})
)

it.effect(
	'keeps listening after the first read fails and retries a registration the connection dropped',
	Effect.fnUntraced(function* () {
		const listeners = yield* Queue.unbounded<(token: Token) => void>()
		const attempts = yield* Queue.unbounded<string>()
		const registered = yield* Queue.unbounded<string>()
		const dropped = yield* Ref.make(false)
		yield* Effect.forkChild(
			registerPushTokens<Token, AuthError, never, AuthError, never>(
				listener => {
					Queue.offerUnsafe(listeners, listener)
					return {remove: Function.constVoid}
				},
				Effect.fail(AuthError.make({message: 'No token yet'})),
				Effect.fnUntraced(function* (token: string) {
					yield* Queue.offer(attempts, token)
					if (!(yield* Ref.getAndSet(dropped, true))) {
						return yield* AuthError.make({error: 'temporarily_unavailable', message: 'Dropped'})
					}
					yield* Queue.offer(registered, token)
				})
			)
		)
		;(yield* Queue.take(listeners))({data: 'rotated'})
		assert.strictEqual(yield* Queue.take(attempts), 'rotated')
		yield* TestClock.adjust('2 seconds')
		assert.strictEqual(yield* Queue.take(registered), 'rotated')
	})
)
