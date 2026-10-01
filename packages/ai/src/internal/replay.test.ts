import {assert, it} from '@effect/vitest'

import {Deferred, Effect, Fiber, Stream, pipe} from 'effect'

import {Prompt, Response} from 'effect/ai'

import type {Ai} from '#service'

import {makeReplay} from './replay.ts'

const user = Prompt.makeMessage('user', {content: [Prompt.makePart('text', {text: 'Hello'})]})

function text(delta: string): Ai.Event {
	return Response.makePart('text-delta', {delta, id: 'answer'})
}

it.effect(
	'replays compact history and streams later events to existing subscribers',
	Effect.fnUntraced(function* () {
		const replay = yield* makeReplay([user])
		const ready = yield* Deferred.make<boolean>()
		const first = yield* pipe(
			replay.events,
			Stream.tap(() => Deferred.succeed(ready, true)),
			Stream.take(3),
			Stream.runCollect,
			Effect.forkChild
		)

		yield* Deferred.await(ready)
		yield* replay.publish(text('one'))
		yield* replay.publish(text(''))
		yield* replay.publish(text(' two'))
		yield* replay.publish(user)
		yield* replay.publish(text(' three'))

		const firstEvents = yield* Fiber.join(first)
		assert.lengthOf(firstEvents, 3)
		assert.containsSubset(firstEvents[1], {delta: 'one', type: 'text-delta'})
		assert.containsSubset(firstEvents[2], {delta: ' two', type: 'text-delta'})

		const resumed = yield* pipe(replay.events, Stream.take(4), Stream.runCollect)
		assert.lengthOf(resumed, 4)
		assert.containsSubset(resumed[1], {delta: 'one two', type: 'text-delta'})
		assert.strictEqual(resumed[2], user)
		assert.containsSubset(resumed[3], {delta: ' three', type: 'text-delta'})
	})
)
