import {expect, it} from '@effect/vitest'

import {Deferred, Effect, Fiber, Stream, pipe} from 'effect'

import {Prompt, Response} from 'effect/unstable/ai'

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
		expect(firstEvents).toHaveLength(3)
		expect(firstEvents[1]).toMatchObject({delta: 'one', type: 'text-delta'})
		expect(firstEvents[2]).toMatchObject({delta: ' two', type: 'text-delta'})

		const resumed = yield* pipe(replay.events, Stream.take(4), Stream.runCollect)
		expect(resumed).toHaveLength(4)
		expect(resumed[1]).toMatchObject({delta: 'one two', type: 'text-delta'})
		expect(resumed[2]).toBe(user)
		expect(resumed[3]).toMatchObject({delta: ' three', type: 'text-delta'})
	})
)
