import {NodeServices} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {Array, Effect, FileSystem, Layer, Option, Stream, Fiber, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'

import {UserId} from '@deslop/runtime/shared/auth'

import {Sources} from './lib/extraction.ts'
import {Organizer} from './lib/organization.ts'

import {Media} from '#services/media/service.ts'
import {NoteId, NotesError} from '#services/notes/schema.ts'
import {Notes} from '#services/notes/service.ts'

const FIRST = NoteId.make('6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c01')
const SECOND = NoteId.make('6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c02')

const notesLayer = pipe(
	Layer.unwrap(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			return Notes.layer(yield* fs.makeTempDirectoryScoped())
		})
	),
	Layer.provide(Layer.merge(SqliteClient.layer({filename: ':memory:'}), Reactivity.layer)),
	Layer.provide(Layer.mock(Sources, {resolve: Effect.succeed})),
	Layer.provide(Layer.mock(Organizer, {organize: () => Effect.fail(NotesError.make({message: 'Offline'}))})),
	Layer.provide(Layer.mock(Media, {})),
	Layer.provide(NodeServices.layer)
)

it.layer(notesLayer)(test => {
	test.effect(
		'matches Unicode word prefixes and emits a removed id after deletion',
		Effect.fnUntraced(function* () {
			const notes = yield* Notes
			yield* notes.capture(UserId.make('github:1'), {id: FIRST, text: 'Über den Wolken'})
			for (const query of ['über', 'Über', 'ÜB']) {
				assert.deepStrictEqual(
					Array.map((yield* notes.list({cursor: Option.none(), limit: 10, query})).items, note => note.id),
					[FIRST]
				)
			}
			const initial = Option.getOrThrow(yield* Stream.runHead(notes.events))
			assert.deepStrictEqual([initial.reset, Array.map(initial.upserted, note => note.id)], [true, [FIRST]])
			const removed = yield* pipe(
				notes.events,
				Stream.filter(event => Array.contains(event.removed, FIRST)),
				Stream.runHead,
				Effect.forkChild
			)
			yield* Effect.yieldNow
			yield* notes.remove(FIRST)
			assert.deepStrictEqual(Option.getOrThrow(yield* Fiber.join(removed)).removed, [FIRST])
			assert.strictEqual((yield* notes.list({cursor: Option.none(), limit: 10, query: 'über'})).total, 0)
		})
	)
	test.effect(
		'searches every word and paginates matching notes newest first',
		Effect.fnUntraced(function* () {
			const notes = yield* Notes
			const user = UserId.make('github:1')
			yield* notes.capture(user, {id: FIRST, text: 'Lentils with cumin'})
			yield* notes.capture(user, {id: SECOND, text: 'Cumin history'})
			const first = yield* notes.list({cursor: Option.none(), limit: 1, query: 'CUMIN'})
			assert.deepStrictEqual([Array.map(first.items, note => note.id), first.total], [[SECOND], 2])
			assert.deepStrictEqual(
				Array.map((yield* notes.list({cursor: first.next, limit: 1, query: 'cumin'})).items, note => note.id),
				[FIRST]
			)
			assert.deepStrictEqual(
				Array.map(
					(yield* notes.list({cursor: Option.none(), limit: 10, query: 'cumin lentils'})).items,
					note => note.id
				),
				[FIRST]
			)
		})
	)
})
