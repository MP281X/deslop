import {assert, it} from '@effect/vitest'

import {Array, Deferred, Effect, Fiber, Function, Ref, pipe} from 'effect'

import {TestClock} from 'effect/testing'

import {makeReconciler} from './reconciler.ts'

it.effect(
	'requests made while a pass runs share exactly one more pass',
	Effect.fnUntraced(function* () {
		const passes = yield* Ref.make(0)
		const running = yield* Deferred.make<void>()
		const gate = yield* Deferred.make<void>()
		const reconciler = yield* makeReconciler(
			Effect.gen(function* () {
				const pass = yield* Ref.updateAndGet(passes, count => count + 1)
				if (pass === 1) {
					yield* Deferred.succeed(running, undefined)
					yield* Deferred.await(gate)
				}
				return pass
			}),
			Function.constTrue
		)
		const first = yield* Effect.forkChild(reconciler.request, {startImmediately: true})
		yield* Deferred.await(running)
		const later = yield* Effect.forEach(
			Array.range(1, 5),
			() => Effect.forkChild(reconciler.request, {startImmediately: true}),
			{concurrency: 1}
		)
		yield* Deferred.succeed(gate, undefined)
		assert.strictEqual(yield* Fiber.join(first), 1)
		assert.deepStrictEqual(yield* Fiber.joinAll(later), [2, 2, 2, 2, 2])
		assert.strictEqual(yield* Ref.get(passes), 2)
	}, Effect.scoped)
)

it.effect(
	'an unfinished pass runs again on its own, and a finished one does not',
	Effect.fnUntraced(function* () {
		const passes = yield* Ref.make(0)
		const reconciler = yield* makeReconciler(
			Ref.updateAndGet(passes, count => count + 1),
			pass => pass > 1
		)
		assert.strictEqual(yield* reconciler.request, 1)
		yield* TestClock.adjust('5 seconds')
		assert.strictEqual(yield* Ref.get(passes), 2)
		yield* TestClock.adjust('10 minutes')
		assert.strictEqual(yield* Ref.get(passes), 2)
	}, Effect.scoped)
)

it.effect(
	'a failing pass answers its requests with the failure and is retried after a longer pause each time',
	Effect.fnUntraced(function* () {
		const passes = yield* Ref.make(0)
		const reconciler = yield* makeReconciler(
			pipe(
				passes,
				Ref.updateAndGet(count => count + 1),
				Effect.filterOrFail(pass => pass >= 3, Function.constant('Caddy is down'))
			),
			Function.constTrue
		)
		assert.strictEqual(yield* Effect.flip(reconciler.request), 'Caddy is down')
		yield* TestClock.adjust('5 seconds')
		assert.strictEqual(yield* Ref.get(passes), 2)
		yield* TestClock.adjust('5 seconds')
		assert.strictEqual(yield* Ref.get(passes), 2)
		yield* TestClock.adjust('5 seconds')
		assert.strictEqual(yield* Ref.get(passes), 3)
		yield* TestClock.adjust('10 minutes')
		assert.strictEqual(yield* Ref.get(passes), 3)
	}, Effect.scoped)
)
