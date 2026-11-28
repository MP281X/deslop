import {assert, it} from '@effect/vitest'

import {Array, DateTime, Effect, Fiber, Option, Ref} from 'effect'

import {NoteId} from './contract.ts'
import {Runs} from './runs.ts'

const OLDER = {createdAt: DateTime.makeUnsafe(1000), id: NoteId.make('6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c01')}
const NEWER = {createdAt: DateTime.makeUnsafe(2000), id: NoteId.make('6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c02')}

// Starts every queued note and answers with the order the notes started in.
const startAll = Effect.fnUntraced(function* (runs: Runs['Service']) {
	const started = yield* Ref.make(Array.empty<NoteId>())
	function organize(id: NoteId) {
		return Ref.update(started, Array.append(id))
	}
	for (const fiber of Array.getSomes([
		yield* runs.start(organize),
		yield* runs.start(organize),
		yield* runs.start(organize)
	])) {
		yield* Fiber.await(fiber)
	}
	return yield* Ref.get(started)
})

it.layer(Runs.layer)(test => {
	test.effect(
		'starts each claimed note once, the newest first',
		Effect.fnUntraced(function* () {
			const runs = yield* Runs
			yield* runs.claim(Effect.succeed([OLDER, NEWER]))
			yield* runs.claim(Effect.succeed([OLDER, NEWER]))
			assert.deepStrictEqual(yield* startAll(runs), [NEWER.id, OLDER.id])
		})
	)
	test.effect(
		'leaves a note whose outcome was not recorded until a request asks again',
		Effect.fnUntraced(function* () {
			const runs = yield* Runs
			yield* runs.unrecord(OLDER.id)
			yield* runs.claim(Effect.succeed([OLDER]))
			assert.deepStrictEqual(yield* startAll(runs), [])
			yield* runs.requested(OLDER.id, Option.none())
			yield* runs.claim(Effect.succeed([OLDER]))
			assert.deepStrictEqual(yield* startAll(runs), [OLDER.id])
		})
	)
})
