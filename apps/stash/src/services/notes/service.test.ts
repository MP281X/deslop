import {NodeServices} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Boolean,
	Context,
	Deferred,
	Effect,
	FileSystem,
	Layer,
	Option,
	Path,
	Queue,
	Ref,
	Stream,
	String,
	Fiber,
	pipe
} from 'effect'

import {Reactivity} from 'effect/reactivity'
import {TestClock} from 'effect/testing'

import {UserId} from '@deslop/runtime/shared/auth'

import {Sources} from './lib/extraction.ts'
import {Organizer} from './lib/organization.ts'

import {Media} from '#services/media/service.ts'
import type {Organization} from '#services/notes/schema.ts'
import {NoteId, NotesError, TagName} from '#services/notes/schema.ts'
import {Notes} from '#services/notes/service.ts'

const SHORT = 'https://t.co/fixture'
const FINAL = 'https://example.com/final'
const FIRST = NoteId.make('6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c01')
const SECOND = NoteId.make('6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c02')
const THIRD = NoteId.make('6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c03')
const FOURTH = NoteId.make('6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c04')

const ORGANIZATION: Organization = {
	body: 'Recipe',
	definitions: [],
	screenText: '',
	summary: 'Lentil soup',
	tags: [TagName.make('cooking')],
	title: 'Soup',
	topics: 'cooking'
}

function notesLayerWith<R>(sources: Layer.Layer<Sources, never, R>) {
	return pipe(
		Layer.unwrap(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem
				return Notes.layer(yield* fs.makeTempDirectoryScoped())
			})
		),
		Layer.provide(Layer.merge(SqliteClient.layer({filename: ':memory:'}), Reactivity.layer)),
		Layer.provide(sources),
		Layer.provide(Layer.mock(Organizer, {organize: () => Effect.fail(NotesError.make({message: 'Offline'}))})),
		Layer.provide(Layer.mock(Media, {})),
		Layer.provide(NodeServices.layer)
	)
}

const notesLayer = notesLayerWith(Layer.mock(Sources, {resolve: Effect.succeed}))

// Each case gets its own database and folder, so no case sees another's notes.
it.layer(notesLayer)(test =>
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
			const watching = yield* Deferred.make<void>()
			const removed = yield* pipe(
				notes.events,
				Stream.tap(() => Deferred.succeed(watching, undefined)),
				Stream.filter(event => Array.contains(event.removed, FIRST)),
				Stream.runHead,
				Effect.forkChild
			)
			yield* Deferred.await(watching)
			yield* notes.remove(FIRST)
			assert.deepStrictEqual(Option.getOrThrow(yield* Fiber.join(removed)).removed, [FIRST])
			assert.strictEqual((yield* notes.list({cursor: Option.none(), limit: 10, query: 'über'})).total, 0)
		})
	)
)

it.layer(notesLayer)(test =>
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
					(yield* notes.list({cursor: Option.none(), limit: 10, query: 'cumin lentils !'})).items,
					note => note.id
				),
				[FIRST]
			)
		})
	)
)

it.layer(notesLayer)(test =>
	test.effect(
		'finds words inside unspaced Japanese, either kana spelling, and tells c++ from c',
		Effect.fnUntraced(function* () {
			const notes = yield* Notes
			const user = UserId.make('github:1')
			yield* notes.capture(user, {id: FIRST, text: '東京都の図書館 ガラス'})
			yield* notes.capture(user, {id: SECOND, text: 'Templates in C++'})
			yield* notes.capture(user, {id: THIRD, text: 'Pointers in C'})
			const found = Effect.fnUntraced(function* (query: string) {
				return Array.map((yield* notes.list({cursor: Option.none(), limit: 10, query})).items, note => note.id)
			})
			assert.deepStrictEqual(yield* found('図書館'), [FIRST])
			assert.deepStrictEqual(yield* found(String.normalize('NFD')('ガラス')), [FIRST])
			assert.deepStrictEqual(yield* found('c++'), [SECOND])
			assert.deepStrictEqual(yield* found('c'), [THIRD, SECOND])
		})
	)
)

it.layer(notesLayer)(test =>
	test.effect(
		'never brings a deleted note back from a resend of its capture',
		Effect.fnUntraced(function* () {
			const notes = yield* Notes
			const user = UserId.make('github:1')
			yield* notes.capture(user, {id: FIRST, text: 'A note to delete'})
			yield* notes.remove(FIRST)
			const resent = yield* Effect.flip(notes.capture(user, {id: FIRST, text: 'A note to delete'}))
			const uploaded = yield* Effect.flip(
				notes.captureFile(user, {body: Stream.make(new Uint8Array([1])), id: FIRST, type: 'image/jpeg'})
			)
			assert.deepStrictEqual([resent.reason, uploaded.reason], ['Removed', 'Removed'])
			assert.strictEqual((yield* notes.list({cursor: Option.none(), limit: 10, query: ''})).total, 0)
		})
	)
)

it.layer(notesLayer)(test =>
	test.effect(
		'never brings a note back from a resend of a capture that joined a deleted note',
		Effect.fnUntraced(function* () {
			const notes = yield* Notes
			const user = UserId.make('github:1')
			yield* notes.capture(user, {id: FIRST, text: 'https://example.com/gear first'})
			yield* notes.capture(user, {id: SECOND, text: 'https://example.com/gear?utm_source=review second'})
			assert.strictEqual((yield* notes.list({cursor: Option.none(), limit: 10, query: ''})).total, 1)
			yield* notes.remove(FIRST)
			const resent = yield* Effect.flip(
				notes.capture(user, {id: SECOND, text: 'https://example.com/gear?utm_source=review second'})
			)
			assert.strictEqual(resent.reason, 'Removed')
			assert.strictEqual((yield* notes.list({cursor: Option.none(), limit: 10, query: ''})).total, 0)
		})
	)
)

// Holds the short link's resolution until the case releases it.
class Gate extends Context.Service<Gate, Deferred.Deferred<void>>()('@deslop/stash/services/notes/service.test/Gate') {
	static readonly layer = Layer.effect(this, Deferred.make<void>())
}

const joiningLayer = Layer.provideMerge(
	notesLayerWith(
		Layer.unwrap(
			Effect.map(Gate, gate =>
				Layer.mock(Sources, {
					resolve: url =>
						Boolean.match(url === SHORT, {
							onFalse: () => Effect.succeed(url),
							onTrue: () => Effect.as(Deferred.await(gate), FINAL)
						})
				})
			)
		)
	),
	Gate.layer
)

it.layer(joiningLayer)(test =>
	test.effect(
		'follows a capture that joined a note through the note that later joins another',
		Effect.fnUntraced(function* () {
			const notes = yield* Notes
			const user = UserId.make('github:1')
			yield* notes.capture(user, {id: FIRST, text: FINAL})
			yield* notes.capture(user, {id: SECOND, text: SHORT})
			yield* notes.capture(user, {id: THIRD, text: SHORT})
			yield* notes.capture(user, {id: FOURTH, text: SHORT})
			const watching = yield* Deferred.make<void>()
			const joined = yield* pipe(
				notes.events,
				Stream.tap(() => Deferred.succeed(watching, undefined)),
				Stream.filter(event => Array.contains(event.removed, SECOND)),
				Stream.runHead,
				Effect.forkChild
			)
			yield* Deferred.await(watching)
			yield* Deferred.succeed(yield* Gate, undefined)
			yield* Fiber.join(joined)
			assert.strictEqual((yield* notes.capture(user, {id: THIRD, text: SHORT})).id, FIRST)
			yield* notes.remove(FIRST)
			assert.strictEqual((yield* Effect.flip(notes.capture(user, {id: FOURTH, text: SHORT}))).reason, 'Removed')
			assert.strictEqual((yield* notes.list({cursor: Option.none(), limit: 10, query: ''})).total, 0)
		})
	)
)

// A server on the notes database in the folder, as a restart would start it again.
function notesIn(directory: string, organize: Organizer['Service']['organize']) {
	return pipe(
		Layer.unwrap(
			Effect.map(Path.Path, path =>
				Layer.provide(
					Notes.layer(directory),
					Layer.merge(SqliteClient.layer({filename: path.join(directory, 'notes.db')}), Reactivity.layer)
				)
			)
		),
		Layer.provide(Layer.mock(Sources, {resolve: Effect.succeed})),
		Layer.provide(Layer.mock(Organizer, {organize})),
		Layer.provide(Layer.mock(Media, {}))
	)
}

// Waits until the list holds the notes and none is organizing, read again after each commit.
function settled(notes: Notes['Service'], count: number) {
	return pipe(
		notes.events,
		Stream.mapEffect(() => notes.list({cursor: Option.none(), limit: count, query: ''})),
		Stream.filter(page => page.total === count && Array.every(page.items, item => item.status !== 'organizing')),
		Stream.runHead
	)
}

it.layer(NodeServices.layer)(test =>
	test.effect(
		'organizes a note a restart stopped midway, for the person who saved it',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const user = UserId.make('github:1')
			const started = yield* Deferred.make<void>()
			// The first server saves the note and stops while its organizer is still working.
			yield* Effect.scoped(
				Effect.gen(function* () {
					const context = yield* Layer.build(
						notesIn(directory, () => Effect.andThen(Deferred.succeed(started, undefined), Effect.never))
					)
					yield* Context.get(context, Notes).capture(user, {id: FIRST, text: 'Lentils with cumin'})
					yield* Deferred.await(started)
				})
			)
			// The next server on the same data claims the note at start.
			const requesters = yield* Ref.make(Array.empty<UserId>())
			const note = yield* Effect.scoped(
				Effect.gen(function* () {
					const context = yield* Layer.build(
						notesIn(directory, userId => pipe(requesters, Ref.update(Array.append(userId)), Effect.as(ORGANIZATION)))
					)
					const notes = Context.get(context, Notes)
					yield* settled(notes, 1)
					return yield* notes.get(FIRST)
				})
			)
			assert.deepStrictEqual([note.status, note.title, yield* Ref.get(requesters)], ['ready', 'Soup', [user]])
		})
	)
)

it.layer(NodeServices.layer)(test =>
	test.effect(
		'starts a running note once however often scans and signals look for organizing notes',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const user = UserId.make('github:1')
			const started = yield* Queue.unbounded<NoteId>()
			const open = yield* Deferred.make<void>()
			const calls = yield* Effect.scoped(
				Effect.gen(function* () {
					const context = yield* Layer.build(
						notesIn(directory, (_userId, input) =>
							pipe(Queue.offer(started, input.note.id), Effect.andThen(Deferred.await(open)), Effect.as(ORGANIZATION))
						)
					)
					const notes = Context.get(context, Notes)
					yield* notes.capture(user, {id: FIRST, text: 'Lentils with cumin'})
					const first = yield* Queue.take(started)
					// The scans each minute and the next capture's claim all find the first note organizing while free workers wait.
					yield* TestClock.adjust('3 minutes')
					yield* notes.capture(user, {id: FIRST, text: 'Lentils with cumin'})
					yield* notes.capture(user, {id: SECOND, text: 'Cumin history'})
					const second = yield* Queue.take(started)
					yield* Deferred.succeed(open, undefined)
					yield* settled(notes, 2)
					return [first, second, ...(yield* Queue.clear(started))]
				})
			)
			assert.deepStrictEqual(calls, [FIRST, SECOND])
		})
	)
)
