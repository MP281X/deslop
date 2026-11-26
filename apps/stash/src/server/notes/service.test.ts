import {NodeServices} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Boolean,
	Context,
	DateTime,
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

import {NoteId, NotesError, TagName} from '#contracts'

import {Sources} from './lib/extraction.ts'
import {Organizer} from './lib/organization.ts'

import {MediaError} from '#server/media/schema.ts'
import {Media} from '#server/media/service.ts'
import type {Organization} from '#server/notes/schema.ts'
import {Notes} from '#server/notes/service.ts'

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
class Gate extends Context.Service<Gate, Deferred.Deferred<void>>()('@deslop/stash/server/notes/service.test/Gate') {
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
function notesIn(directory: string, organize: Organizer['Service']['organize'], media: Partial<Media['Service']> = {}) {
	return pipe(
		Layer.unwrap(
			Effect.map(Path.Path, path =>
				Layer.provide(
					Notes.layer(directory),
					// A busy database answers at once, so no case waits on SQLite's own timeout.
					Layer.merge(
						SqliteClient.layer({busyTimeout: '0 millis', filename: path.join(directory, 'notes.db')}),
						Reactivity.layer
					)
				)
			)
		),
		Layer.provide(Layer.mock(Sources, {resolve: Effect.succeed})),
		Layer.provide(Layer.mock(Organizer, {organize})),
		Layer.provide(Layer.mock(Media, media))
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

// A second connection on the notes database in the folder, as another process would open it.
const otherConnection = Effect.fnUntraced(function* (directory: string) {
	const path = yield* Path.Path
	const context = yield* Layer.build(
		Layer.provide(SqliteClient.layer({filename: path.join(directory, 'notes.db')}), Reactivity.layer)
	)
	return Context.get(context, SqliteClient.SqliteClient)
})

// The other connection holds the write lock until it rolls back.
const lockDatabase = Effect.fnUntraced(function* (directory: string) {
	const other = yield* otherConnection(directory)
	yield* other`BEGIN IMMEDIATE`
	return other`ROLLBACK`
})

// Runs a note whose organizer answers while the database is locked, then releases the lock; the note is read until it settles.
const organizedBehindLock = Effect.fnUntraced(function* (answer: Effect.Effect<Organization, NotesError>) {
	const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
	const requests = yield* Ref.make(0)
	const asked = yield* Deferred.make<void>()
	const answered = yield* Deferred.make<void>()
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const context = yield* Layer.build(
				notesIn(directory, () =>
					pipe(
						Ref.update(requests, count => count + 1),
						Effect.andThen(Deferred.succeed(asked, undefined)),
						Effect.andThen(Deferred.await(answered)),
						Effect.andThen(answer)
					)
				)
			)
			const notes = Context.get(context, Notes)
			yield* notes.capture(UserId.make('github:1'), {id: FIRST, text: 'Lentils with cumin'})
			yield* Deferred.await(asked)
			const release = yield* lockDatabase(directory)
			yield* Deferred.succeed(answered, undefined)
			// The minute scans find the note while the answer cannot be stored.
			yield* TestClock.adjust('3 minutes')
			const waiting = yield* notes.get(FIRST)
			yield* release
			const final = yield* pipe(
				TestClock.adjust('30 seconds'),
				Effect.andThen(notes.get(FIRST)),
				Effect.repeat({times: 100, until: note => note.status !== 'organizing'})
			)
			return {final, requests: yield* Ref.get(requests), waiting}
		})
	)
})

it.layer(NodeServices.layer)(test =>
	test.effect(
		'stores the organization once the database is free again, without asking the provider twice',
		Effect.fnUntraced(function* () {
			const run = yield* organizedBehindLock(Effect.succeed(ORGANIZATION))
			assert.deepStrictEqual(
				[run.waiting.status, run.final.status, run.final.title, run.requests],
				['organizing', 'ready', 'Soup', 1]
			)
		})
	)
)

it.layer(NodeServices.layer)(test =>
	test.effect(
		'stores a provider failure once the database is free again, without asking the provider twice',
		Effect.fnUntraced(function* () {
			const run = yield* organizedBehindLock(Effect.fail(NotesError.make({message: 'Provider down'})))
			assert.deepStrictEqual(
				[run.waiting.status, run.final.status, run.final.issue, run.requests],
				['organizing', 'failed', Option.some('Provider down'), 1]
			)
		})
	)
)

// An uploaded video whose tools all fail with the error, so nothing in it can be read.
const unreadableVideo = Effect.fnUntraced(function* (error: MediaError) {
	const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const context = yield* Layer.build(
				notesIn(directory, () => Effect.succeed(ORGANIZATION), {
					budget: Effect.succeed({deadline: DateTime.makeUnsafe(0), directory}),
					fileFrames: () => Effect.fail(error),
					fileTranscript: () => Effect.fail(error)
				})
			)
			const notes = Context.get(context, Notes)
			yield* notes.captureFile(UserId.make('github:1'), {
				body: Stream.make(new Uint8Array([1])),
				id: FIRST,
				type: 'video/mp4'
			})
			yield* settled(notes, 1)
			return yield* notes.get(FIRST)
		})
	)
})

it.layer(NodeServices.layer)(test =>
	test.effect(
		'leaves the budget a video spent on its note, and says a malformed file has nothing to read in it',
		Effect.fnUntraced(function* () {
			const spent = yield* unreadableVideo(
				MediaError.make({message: 'ffprobe exceeded its time limit', reason: 'Budget'})
			)
			const malformed = yield* unreadableVideo(MediaError.make({message: 'ffprobe cannot inspect the media'}))
			assert.deepStrictEqual(
				[spent.status, spent.issue, malformed.status, malformed.issue],
				[
					'failed',
					Option.some('ffprobe exceeded its time limit'),
					'failed',
					Option.some('Nothing to read in this file.')
				]
			)
		})
	)
)

// Waits for the note to leave organizing, while the clock runs on so a write waiting to be tried again gets its turn.
function settledAfterTicks(notes: Notes['Service']) {
	return pipe(
		TestClock.adjust('30 seconds'),
		Effect.andThen(notes.get(FIRST)),
		Effect.repeat({times: 100, until: note => note.status !== 'organizing'})
	)
}

it.layer(NodeServices.layer)(test =>
	test.effect(
		'keeps the note and the answer it waits to store when its deletion fails on a busy database',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const requests = yield* Ref.make(0)
			const asked = yield* Deferred.make<void>()
			const answered = yield* Deferred.make<void>()
			const user = UserId.make('github:1')
			return yield* Effect.scoped(
				Effect.gen(function* () {
					const context = yield* Layer.build(
						notesIn(directory, () =>
							pipe(
								Ref.update(requests, count => count + 1),
								Effect.andThen(Deferred.succeed(asked, undefined)),
								Effect.andThen(Deferred.await(answered)),
								Effect.as(ORGANIZATION)
							)
						)
					)
					const notes = Context.get(context, Notes)
					yield* notes.capture(user, {id: FIRST, text: 'Lentils with cumin'})
					yield* Deferred.await(asked)
					const release = yield* lockDatabase(directory)
					yield* Deferred.succeed(answered, undefined)
					// The answer cannot be stored yet and waits to be tried again.
					yield* TestClock.adjust('1 second')
					const failure = yield* Effect.flip(notes.remove(FIRST))
					yield* release
					const final = yield* settledAfterTicks(notes)
					// The minute scans since would have asked the provider again had the run been lost.
					assert.deepStrictEqual(
						[failure._tag, final.status, final.title, yield* Ref.get(requests)],
						['NotesError', 'ready', 'Soup', 1]
					)
				})
			)
		})
	)
)

it.layer(NodeServices.layer)(test =>
	test.effect(
		'keeps the run and the answer it waits to store when a Regenerate fails on a busy database',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const requests = yield* Ref.make(0)
			const asked = yield* Deferred.make<void>()
			const answered = yield* Deferred.make<void>()
			const user = UserId.make('github:1')
			return yield* Effect.scoped(
				Effect.gen(function* () {
					const context = yield* Layer.build(
						notesIn(directory, () =>
							pipe(
								Ref.update(requests, count => count + 1),
								Effect.andThen(Deferred.succeed(asked, undefined)),
								Effect.andThen(Deferred.await(answered)),
								Effect.as(ORGANIZATION)
							)
						)
					)
					const notes = Context.get(context, Notes)
					yield* notes.capture(user, {id: FIRST, text: 'Lentils with cumin'})
					yield* Deferred.await(asked)
					const release = yield* lockDatabase(directory)
					yield* Deferred.succeed(answered, undefined)
					// The answer cannot be stored yet and waits to be tried again.
					yield* TestClock.adjust('1 second')
					const failure = yield* Effect.flip(notes.regenerate(user, FIRST))
					yield* release
					const final = yield* settledAfterTicks(notes)
					// The minute scans since would have asked the provider again had the run been lost.
					assert.deepStrictEqual(
						[failure._tag, final.status, final.title, yield* Ref.get(requests)],
						['NotesError', 'ready', 'Soup', 1]
					)
				})
			)
		})
	)
)

it.layer(NodeServices.layer)(test =>
	test.effect(
		'starts one new run on Regenerate and keeps nothing of the answer the old run waited for',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const requests = yield* Ref.make(0)
			const asked = yield* Deferred.make<void>()
			const user = UserId.make('github:1')
			return yield* Effect.scoped(
				Effect.gen(function* () {
					const context = yield* Layer.build(
						notesIn(directory, () =>
							pipe(
								requests,
								Ref.updateAndGet(count => count + 1),
								Effect.flatMap(count =>
									Boolean.match(count === 1, {
										onFalse: () => Effect.succeed({...ORGANIZATION, title: 'Again'}),
										// The first run waits for an answer that never comes.
										onTrue: () => Effect.andThen(Deferred.succeed(asked, undefined), Effect.never)
									})
								)
							)
						)
					)
					const notes = Context.get(context, Notes)
					yield* notes.capture(user, {id: FIRST, text: 'Lentils with cumin'})
					yield* Deferred.await(asked)
					yield* notes.regenerate(user, FIRST)
					const final = yield* settledAfterTicks(notes)
					assert.deepStrictEqual([final.status, final.title, yield* Ref.get(requests)], ['ready', 'Again', 2])
				})
			)
		})
	)
)

it.layer(NodeServices.layer)(test =>
	test.effect(
		'keeps the first answer of a note whose Regenerate could not commit, asking the provider once',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const requests = yield* Ref.make(0)
			const asked = yield* Deferred.make<void>()
			const answered = yield* Deferred.make<void>()
			const user = UserId.make('github:1')
			return yield* Effect.scoped(
				Effect.gen(function* () {
					const context = yield* Layer.build(
						notesIn(directory, () =>
							pipe(
								requests,
								Ref.updateAndGet(count => count + 1),
								Effect.flatMap(count =>
									Boolean.match(count === 1, {
										onFalse: () => Effect.succeed({...ORGANIZATION, title: 'Again'}),
										onTrue: () =>
											pipe(
												Deferred.succeed(asked, undefined),
												Effect.andThen(Deferred.await(answered)),
												Effect.as(ORGANIZATION)
											)
									})
								)
							)
						)
					)
					const notes = Context.get(context, Notes)
					yield* notes.capture(user, {id: FIRST, text: 'Lentils with cumin'})
					yield* Deferred.await(asked)
					const other = yield* otherConnection(directory)
					// The restart's write succeeds and its commit fails: the row it adds has no parent, which SQLite checks only then.
					yield* other.unsafe('CREATE TABLE parent (id INTEGER PRIMARY KEY)')
					yield* other.unsafe('CREATE TABLE child (id INTEGER REFERENCES parent (id) DEFERRABLE INITIALLY DEFERRED)')
					yield* other.unsafe(
						`CREATE TRIGGER orphan AFTER UPDATE ON notes WHEN new.id = '${FIRST}' BEGIN INSERT INTO child VALUES (1); END`
					)
					const failure = yield* Effect.flip(notes.regenerate(user, FIRST))
					yield* other.unsafe('DROP TRIGGER orphan')
					// The minute scans since would have asked the provider again had the restart stopped the run.
					yield* TestClock.adjust('3 minutes')
					yield* Deferred.succeed(answered, undefined)
					const final = yield* settledAfterTicks(notes)
					assert.deepStrictEqual(
						[failure._tag, final.status, final.title, yield* Ref.get(requests)],
						['NotesError', 'ready', 'Soup', 1]
					)
				})
			)
		})
	)
)

it.layer(NodeServices.layer)(test =>
	test.effect(
		'drops the answer the old run brings after a committed Regenerate and keeps the new run’s',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const requests = yield* Ref.make(0)
			const asked = yield* Deferred.make<void>()
			const answered = yield* Deferred.make<void>()
			const user = UserId.make('github:1')
			const other = UserId.make('github:2')
			return yield* Effect.scoped(
				Effect.gen(function* () {
					const context = yield* Layer.build(
						notesIn(directory, () =>
							pipe(
								requests,
								Ref.updateAndGet(count => count + 1),
								Effect.flatMap(count =>
									Boolean.match(count === 1, {
										onFalse: () => Effect.succeed({...ORGANIZATION, title: 'Again'}),
										// The first request answers only after the restart committed, and the stop waits for it.
										onTrue: () =>
											pipe(
												Deferred.succeed(asked, undefined),
												Effect.andThen(Deferred.await(answered)),
												Effect.uninterruptible,
												Effect.as(ORGANIZATION)
											)
									})
								)
							)
						)
					)
					const notes = Context.get(context, Notes)
					yield* notes.capture(user, {id: FIRST, text: 'Lentils with cumin'})
					yield* Deferred.await(asked)
					const watching = yield* Deferred.make<void>()
					const restarted = yield* pipe(
						notes.events,
						Stream.tap(() => Deferred.succeed(watching, undefined)),
						Stream.mapEffect(() => notes.get(FIRST)),
						Stream.filter(note => note.requester === other),
						Stream.runHead,
						Effect.forkChild
					)
					yield* Deferred.await(watching)
					const regenerating = yield* Effect.forkChild(notes.regenerate(other, FIRST))
					yield* Fiber.join(restarted)
					yield* Deferred.succeed(answered, undefined)
					yield* Fiber.join(regenerating)
					const final = yield* settledAfterTicks(notes)
					assert.deepStrictEqual([final.status, final.title, yield* Ref.get(requests)], ['ready', 'Again', 2])
				})
			)
		})
	)
)

it.layer(NodeServices.layer)(test =>
	test.effect(
		'asks the provider once for a note it cannot record, until the person asks again',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const asked = yield* Ref.make(Array.empty<NoteId>())
			const user = UserId.make('github:1')
			const timesAsked = Effect.map(
				Ref.get(asked),
				Array.countBy(id => id === FIRST)
			)
			return yield* Effect.scoped(
				Effect.gen(function* () {
					const context = yield* Layer.build(
						notesIn(directory, (_userId, input) =>
							pipe(asked, Ref.update(Array.append(input.note.id)), Effect.as(ORGANIZATION))
						)
					)
					const notes = Context.get(context, Notes)
					const other = yield* otherConnection(directory)
					// Every update of the first note fails for good, as a full disk would.
					yield* other.unsafe(
						`CREATE TRIGGER reject_first BEFORE UPDATE ON notes WHEN old.id = '${FIRST}' BEGIN SELECT RAISE(ABORT, 'rejected'); END`
					)
					yield* notes.capture(user, {id: FIRST, text: 'Lentils with cumin'})
					yield* TestClock.adjust('1 second')
					// The scans each minute and the next capture's claim find the first note still organizing.
					yield* TestClock.adjust('3 minutes')
					yield* notes.capture(user, {id: SECOND, text: 'Cumin history'})
					yield* TestClock.adjust('3 minutes')
					assert.deepStrictEqual([(yield* notes.get(FIRST)).status, yield* timesAsked], ['organizing', 1])
					yield* other.unsafe('DROP TRIGGER reject_first')
					yield* notes.regenerate(user, FIRST)
					assert.deepStrictEqual([(yield* settledAfterTicks(notes)).status, yield* timesAsked], ['ready', 2])
				})
			)
		})
	)
)

it.layer(NodeServices.layer)(test =>
	test.effect(
		'keeps the message of a limit a video reached while the database is busy',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const asked = yield* Deferred.make<void>()
			const gate = yield* Deferred.make<void>()
			const error = MediaError.make({message: 'ffprobe exceeded its time limit', reason: 'Budget'})
			const reading = Effect.andThen(Deferred.succeed(asked, undefined), Deferred.await(gate))
			return yield* Effect.scoped(
				Effect.gen(function* () {
					const context = yield* Layer.build(
						notesIn(directory, () => Effect.succeed(ORGANIZATION), {
							budget: Effect.succeed({deadline: DateTime.makeUnsafe(0), directory}),
							fileFrames: () => Effect.andThen(reading, Effect.fail(error)),
							fileTranscript: () => Effect.andThen(reading, Effect.fail(error))
						})
					)
					const notes = Context.get(context, Notes)
					yield* notes.captureFile(UserId.make('github:1'), {
						body: Stream.make(new Uint8Array([1])),
						id: FIRST,
						type: 'video/mp4'
					})
					yield* Deferred.await(asked)
					const release = yield* lockDatabase(directory)
					yield* Deferred.succeed(gate, undefined)
					yield* TestClock.adjust('1 second')
					yield* release
					const final = yield* settledAfterTicks(notes)
					assert.deepStrictEqual(
						[final.status, final.issue],
						['failed', Option.some('ffprobe exceeded its time limit')]
					)
				})
			)
		})
	)
)
