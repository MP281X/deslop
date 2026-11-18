import {assert, it} from '@effect/vitest'

import {Effect, Fiber, Ref} from 'effect'

import {TestClock} from 'effect/testing'

import {AuthError, DEVELOPER, recheckUser, signedInSecret, upgradeOnlyHeaders} from '#shared/auth.ts'
import type {User} from '#shared/auth.ts'

const HAND_OFF = 'https://auth.example.test/signed-in/stash'

it.effect(
	'reads the session secret Auth hands back, and Auth’s reason when the sign-in failed',
	Effect.fnUntraced(function* () {
		assert.strictEqual(yield* signedInSecret(`${HAND_OFF}?${new URLSearchParams({session: 'secret'})}`), 'secret')
		const refused = yield* Effect.flip(
			signedInSecret(`${HAND_OFF}?${new URLSearchParams({error: 'The sign-in expired; sign in again'})}`)
		)
		assert.deepStrictEqual([refused._tag, refused.message], ['AuthError', 'The sign-in expired; sign in again'])
		assert.strictEqual((yield* Effect.flip(signedInSecret(`${HAND_OFF}?session=`)))._tag, 'SchemaError')
	})
)

it('keeps identity headers and the session cookie from the upgrade request and drops them from frames', () => {
	assert.deepStrictEqual(
		upgradeOnlyHeaders([
			['cookie', 'session'],
			['x-deslop-client', '100.64.0.1'],
			['x-deslop-frame', ''],
			['X-Deslop-Client', '100.64.0.2'],
			['x-deslop-user', 'github:1'],
			['Cookie', 'frame-session'],
			['x-probe-caller', 'member']
		]),
		[
			['cookie', 'session'],
			['x-deslop-client', '100.64.0.1'],
			['x-probe-caller', 'member']
		]
	)
	assert.deepStrictEqual(upgradeOnlyHeaders([['x-deslop-user', 'github:1']]), [])
	assert.deepStrictEqual(
		upgradeOnlyHeaders([
			['x-deslop-frame', ''],
			['cookie', 'frame-session']
		]),
		[]
	)
})

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
