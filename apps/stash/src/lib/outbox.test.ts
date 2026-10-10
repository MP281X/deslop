import {assert, it} from '@effect/vitest'

import {Array, Effect, Ref} from 'effect'

import {Outbox, Pending, deliver} from '#lib/outbox.ts'
import type {Capture} from '#services/notes/schema.ts'
import {NotesError} from '#services/notes/schema.ts'

const captures = [
	Pending.make({createdAt: 3, id: '6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c03', text: 'third'}),
	Pending.make({createdAt: 1, id: '6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c01', text: 'first'}),
	Pending.make({createdAt: 2, id: '6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c02', text: 'second'})
]

it.effect('sends the oldest capture first and keeps only the ones the server did not confirm', () =>
	Effect.gen(function* () {
		const stored = yield* Ref.make(captures)
		const sent = yield* Ref.make(Array.empty<string>())
		const delivered = yield* Effect.provideService(
			deliver((capture: Capture) =>
				Effect.andThen(
					Ref.update(sent, Array.append(capture.text)),
					capture.text === 'second' ? Effect.fail(NotesError.make({message: 'Offline'})) : Effect.void
				)
			),
			Outbox,
			Outbox.of({
				add: pending => Ref.update(stored, Array.append(pending)),
				list: Ref.get(stored),
				remove: id =>
					Ref.update(
						stored,
						Array.filter(pending => pending.id !== id)
					)
			})
		)
		assert.deepStrictEqual(delivered, {kept: 1, sent: 2})
		assert.deepStrictEqual(yield* Ref.get(sent), ['first', 'second', 'third'])
		assert.deepStrictEqual(
			Array.map(yield* Ref.get(stored), pending => pending.text),
			['second']
		)
	})
)
