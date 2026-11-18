import {assert, it} from '@effect/vitest'

import {Effect, Fiber, Ref} from 'effect'

import {TestClock} from 'effect/testing'

import {recheckUser} from '#server/auth.ts'
import {AuthError, DEVELOPER} from '#shared/auth.ts'
import type {User} from '#shared/auth.ts'

const named: Effect.Effect<User, AuthError> = Effect.succeed(DEVELOPER)
const unavailable = Effect.fail(AuthError.make({error: 'temporarily_unavailable', message: 'Auth is down'}))
const refused = Effect.fail(AuthError.make({error: 'access_denied', message: 'Not allowed'}))

// A stream whose caller Auth answers as the test sets it.
function openStream(answer: Ref.Ref<Effect.Effect<User, AuthError>>) {
	return Effect.forkChild(recheckUser(Effect.flatten(Ref.get(answer)), DEVELOPER))
}

it.effect(
	'keeps a stream when Auth answers again within fifteen minutes of its last answer',
	Effect.fnUntraced(function* () {
		const answer = yield* Ref.make(named)
		const stream = yield* openStream(answer)
		yield* Ref.set(answer, unavailable)
		yield* TestClock.adjust('14 minutes')
		yield* Ref.set(answer, named)
		yield* TestClock.adjust('21 minutes')
		assert.isUndefined(stream.pollUnsafe())
		yield* Fiber.interrupt(stream)
	})
)

it.effect(
	'ends a stream with temporarily unavailable once Auth stays unreachable past fifteen minutes',
	Effect.fnUntraced(function* () {
		const answer = yield* Ref.make(named)
		const stream = yield* openStream(answer)
		yield* Ref.set(answer, unavailable)
		yield* TestClock.adjust('14 minutes')
		assert.isUndefined(stream.pollUnsafe())
		yield* TestClock.adjust('2 minutes')
		assert.strictEqual((yield* Effect.flip(Fiber.join(stream))).error, 'temporarily_unavailable')
	})
)

it.effect(
	'ends a stream at the next check when Auth refuses its caller',
	Effect.fnUntraced(function* () {
		const answer = yield* Ref.make(named)
		const stream = yield* openStream(answer)
		yield* Ref.set(answer, refused)
		yield* TestClock.adjust('5 minutes')
		assert.strictEqual((yield* Effect.flip(Fiber.join(stream))).error, 'access_denied')
	})
)
