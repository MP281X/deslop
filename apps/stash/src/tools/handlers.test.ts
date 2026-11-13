import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {Array, Context, Effect, FileSystem, Layer, Option, Schema, Stream, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'

import {CurrentUser} from '@deslop/runtime/shared/auth'

import {Media} from '#services/media/service.ts'
// oxlint-disable-next-line no-restricted-imports -- The tools run over real notes, with stand-ins for the page reader and the AI that Notes keeps private.
import {Sources} from '#services/notes/lib/extraction.ts'
// oxlint-disable-next-line no-restricted-imports -- As above: the AI organizer is Notes' own internal.
import {Organizer} from '#services/notes/lib/organization.ts'
import {NoteId} from '#services/notes/schema.ts'
import {Notes} from '#services/notes/service.ts'
import {ToolContracts} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

const USER = {id: 'github:1', name: 'tester'}

const organizer = Organizer.of({
	organize: () =>
		Effect.succeed({
			body: 'Remember the milk.',
			definitions: [],
			screenText: '',
			summary: 'A reminder.',
			tags: ['errand'],
			title: 'Milk',
			topics: 'errands'
		})
})

const sources = Sources.of({
	extract: () => Effect.die('A text note reads no link'),
	image: () => Effect.die('A text note keeps no image'),
	resolve: Effect.succeed
})

const media = Media.of({
	fileFrames: () => Effect.succeed([]),
	fileTranscript: () => Effect.succeedNone,
	frames: () => Effect.succeed([]),
	read: () => Effect.die('A text note reads no video')
})

it.layer(Layer.merge(NodeCrypto.layer, NodeServices.layer))('Stash tools', test => {
	test.effect(
		'removes a saved note through the MCP tool',
		Effect.fnUntraced(function* () {
			yield* Effect.scoped(
				Effect.gen(function* () {
					const context = yield* Layer.build(
						pipe(
							Notes.layer(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()),
							Layer.provide(Layer.merge(SqliteClient.layer({filename: ':memory:'}), Reactivity.layer)),
							Layer.provide(Layer.succeed(Sources, sources)),
							Layer.provide(Layer.succeed(Media, media)),
							Layer.provide(Layer.succeed(Organizer, organizer))
						)
					)
					const notes = Context.get(context, Notes)
					const toolkit = yield* pipe(ToolContracts, Effect.provide(ToolHandlers), Effect.provideService(Notes, notes))
					const saved = yield* pipe(
						toolkit.handle('save_note', {text: 'Remember the milk'}, '1'),
						Effect.flatMap(Stream.runCollect),
						Effect.map(results => Option.getOrThrow(Array.last(results))),
						Effect.provideService(CurrentUser, USER)
					)
					assert.isFalse(saved.isFailure)
					const note = yield* Schema.decodeUnknownEffect(Schema.Struct({id: NoteId}))(saved.encodedResult)
					const all = {cursor: Option.none(), limit: 10, query: ''}
					assert.strictEqual((yield* notes.list(all)).total, 1)
					yield* pipe(
						toolkit.handle('remove_note', {id: note.id}, '2'),
						Effect.flatMap(Stream.runDrain),
						Effect.provideService(CurrentUser, USER)
					)
					assert.strictEqual((yield* notes.list(all)).total, 0)
				})
			)
		})
	)
})
