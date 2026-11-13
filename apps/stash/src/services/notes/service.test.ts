import {NodeServices} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Boolean,
	Context,
	Effect,
	Fiber,
	FileSystem,
	Function,
	Latch,
	Layer,
	MutableList,
	Number,
	Option,
	PlatformError,
	Predicate,
	Queue,
	Record,
	Ref,
	Schema,
	Stream,
	String,
	Struct,
	Tracer,
	pipe
} from 'effect'

import {Reactivity} from 'effect/reactivity'
import {SqlClient, SqlSchema} from 'effect/sql'
import {TestClock} from 'effect/testing'

import {Sources} from './lib/extraction.ts'
import {Organizer} from './lib/organization.ts'

import {MediaError} from '#services/media/schema.ts'
import {Media} from '#services/media/service.ts'
import type {TagEntry} from '#services/notes/schema.ts'
import {Extraction, Note, NoteId, NoteItem, NotesError, NotesEvent} from '#services/notes/schema.ts'
import {Notes} from '#services/notes/service.ts'

const USER = 'github:1'

const IDS = [
	NoteId.make('6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c01'),
	NoteId.make('6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c02'),
	NoteId.make('6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c03')
] as const

const recipe = Sources.of({
	extract: link =>
		Effect.succeed(
			Extraction.make({
				author: Option.some('Cookbook'),
				image: Option.some('https://example.com/soup.jpg'),
				text: 'Lentils with cumin and tomato.',
				title: 'Lentil soup',
				url: link
			})
		),
	image: () => Effect.succeed({bytes: new Uint8Array([255, 216, 255]), type: 'image/jpeg' as const}),
	resolve: Effect.succeed
})

const noVideo = Media.of({
	fileFrames: () => Effect.succeed([]),
	fileTranscript: () => Effect.succeedNone,
	frames: () => Effect.succeed([]),
	read: () => Effect.fail(MediaError.make({message: 'yt-dlp cannot read the video'}))
})

const memory = Layer.merge(SqliteClient.layer({filename: ':memory:'}), Reactivity.layer)

type Database = Layer.Success<typeof memory>

type StoredNote = typeof StoredNote.Type
const StoredNote = Schema.Struct({...Note.fields, tags: Schema.fromJsonString(Schema.Array(Schema.String))})

// A stored note as the wire carries it, with its tags.
type Stored = typeof Note.json.Encoded & Pick<StoredNote, 'tags'>

// Every stored note as its JSON form, with its tags, read again after each commit.
function storedNotes(database: Context.Context<Database>) {
	const sql = Context.get(database, SqlClient.SqlClient)
	const read = SqlSchema.findAll({
		Request: Schema.Void,
		Result: StoredNote,
		execute: () => sql`
			SELECT notes.*, (
				SELECT json_group_array(tag) FROM (SELECT tag FROM note_tags WHERE noteId = notes.id ORDER BY position)
			) AS tags
			FROM notes
			ORDER BY createdAt DESC, id DESC
		`
	})
	return pipe(
		sql.reactive(['notes'], read()),
		Stream.mapEffect(rows =>
			Effect.forEach(
				rows,
				row =>
					Effect.map(
						Schema.encodeEffect(Note.json)(Note.make(Struct.omit(row, ['tags']))),
						json => ({...json, tags: row.tags}) satisfies Stored
					),
				{concurrency: 'unbounded'}
			)
		),
		Stream.provideContext(database)
	)
}

// A restart builds the service again over the same database.
const open = Effect.fnUntraced(function* (options: {
	database?: Context.Context<Database>
	directory: string
	media?: typeof Media.Service
	organizer: typeof Organizer.Service
	sources: typeof Sources.Service
}) {
	const database = options.database ?? (yield* Layer.build(memory))
	const context = yield* Layer.build(
		pipe(
			Notes.layer(options.directory),
			Layer.provide(Layer.succeedContext(database)),
			Layer.provide(Layer.succeed(Sources, options.sources)),
			Layer.provide(Layer.succeed(Media, options.media ?? noVideo)),
			Layer.provide(Layer.succeed(Organizer, options.organizer))
		)
	)
	return {...Context.get(context, Notes), stored: storedNotes(database)}
})

const settled = Effect.fnUntraced(function* (
	notes: {readonly stored: ReturnType<typeof storedNotes>},
	done: (state: Stored[]) => boolean
) {
	return yield* pipe(notes.stored, Stream.filter(done), Stream.runHead, Effect.map(Option.getOrThrow))
})

function isReady(state: Stored[]) {
	return Array.some(state, note => note.status === 'ready')
}

const noKey = Organizer.of({
	organize: () => Effect.fail(NotesError.make({message: 'Not tagged: the server has no AI key.'}))
})

function counting(calls: Ref.Ref<number>) {
	return Organizer.of({
		organize: Effect.fnUntraced(function* (_userId, input) {
			return yield* pipe(
				calls,
				Ref.update(count => count + 1),
				Effect.as({
					body: '',
					definitions: [{definition: 'Recipes and cooking techniques.', tag: 'cooking'}],
					screenText: '',
					summary: `About ${input.note.content}`,
					tags: ['cooking', 'soup'],
					title: 'Soup',
					topics: 'lentils; cumin'
				})
			)
		})
	})
}

function recordingTracer(onSpan?: (span: Tracer.NativeSpan) => void) {
	const collected = MutableList.make<Tracer.NativeSpan>()
	const tracer = Tracer.make({
		span(options) {
			const span = new Tracer.NativeSpan(options)
			MutableList.append(collected, span)
			onSpan?.(span)
			return span
		}
	})
	return {spans: () => MutableList.toArray(collected), tracer}
}

it.layer(NodeServices.layer)('Notes', test => {
	test.effect(
		'pushes matching full-text search results through organization and removal without changing the query',
		Effect.fnUntraced(function* () {
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: Organizer.of({
					organize: () =>
						Effect.succeed({
							body: 'A secret ingredient.',
							definitions: [],
							screenText: '',
							summary: '',
							tags: [],
							title: 'Soup',
							topics: ''
						})
				}),
				sources: recipe
			})
			const updates = yield* Queue.unbounded<readonly string[]>()
			yield* pipe(
				notes.search('secret'),
				Stream.runForEach(ids => Queue.offer(updates, ids)),
				Effect.forkChild
			)
			assert.deepStrictEqual(yield* Queue.take(updates), [])
			yield* notes.capture(USER, {id: IDS[0], text: 'https://example.com/soup'})
			assert.deepStrictEqual(yield* Queue.take(updates), [IDS[0]])
			yield* notes.remove(IDS[0])
			assert.deepStrictEqual(yield* Queue.take(updates), [])
		})
	)

	test.effect(
		'finds notes that contain every word and carry every #tag, a page at a time',
		Effect.fnUntraced(function* () {
			const pages: Record<string, {author: string; tags: string[]; text: string}> = {
				'https://example.com/soup': {
					author: 'Lisa Kitchen',
					tags: ['cooking', 'quick-meals'],
					text: 'Lentils with cumin'
				},
				'https://example.com/spice': {author: 'Spice Atlas', tags: ['history'], text: 'Cumin history'}
			}
			function pageOf(link: string) {
				return Option.getOrThrow(Record.get(pages, link))
			}
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: Organizer.of({
					organize: (_userId, input) =>
						Effect.succeed({
							body: '',
							definitions: [],
							screenText: '',
							summary: 'A quick dinner',
							tags: pageOf(Option.getOrThrow(input.note.url)).tags,
							title: input.note.title,
							topics: ''
						})
				}),
				sources: Sources.of({
					...recipe,
					extract: link =>
						Effect.map(recipe.extract(link), page => ({
							...page,
							author: Option.some(pageOf(link).author),
							image: Option.none(),
							text: pageOf(link).text
						}))
				})
			})
			yield* notes.capture(USER, {id: IDS[0], text: 'https://example.com/soup'})
			yield* TestClock.adjust('1 second')
			yield* notes.capture(USER, {id: IDS[1], text: 'https://example.com/spice'})
			yield* settled(notes, current => Array.every(current, note => note.status === 'ready'))
			const found = Effect.fnUntraced(function* (query: string) {
				return Array.map((yield* notes.list({cursor: Option.none(), limit: 10, query})).items, note => note.id)
			})
			assert.deepStrictEqual(yield* found(''), [IDS[1], IDS[0]])
			assert.deepStrictEqual(yield* found('CUMIN dinner'), [IDS[1], IDS[0]])
			assert.deepStrictEqual(yield* found('cumin #history'), [IDS[1]])
			assert.deepStrictEqual(yield* found('#cook'), [])
			assert.deepStrictEqual(yield* found('lentils quick-meals'), [IDS[0]])
			assert.deepStrictEqual(yield* found('atlas'), [IDS[1]])
			const first = yield* notes.list({cursor: Option.none(), limit: 1, query: 'cumin'})
			assert.deepStrictEqual([Array.map(first.items, note => note.id), first.total], [[IDS[1]], 2])
			const second = yield* notes.list({cursor: first.next, limit: 1, query: 'cumin'})
			assert.deepStrictEqual([Array.map(second.items, note => note.id), second.total], [[IDS[0]], 2])
			assert.isTrue(Option.isNone(second.next))
		})
	)

	test.effect(
		'saves the original first, tags it once, and keeps the result across a restart',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const database = yield* Layer.build(memory)
			const calls = yield* Ref.make(0)
			yield* Effect.scoped(
				Effect.gen(function* () {
					const notes = yield* open({database, directory, organizer: counting(calls), sources: recipe})
					assert.containsSubset(
						yield* Schema.encodeEffect(NoteItem.json)(
							yield* notes.capture(USER, {id: IDS[0], text: ' https://example.com/soup?utm_source=x '})
						),
						{status: 'organizing', title: 'https://example.com/soup', url: 'https://example.com/soup'}
					)
					assert.containsSubset((yield* settled(notes, isReady))[0], {
						author: 'Cookbook',
						content: 'Lentils with cumin and tomato.',
						image: 'image/jpeg',
						summary: 'About Lentils with cumin and tomato.',
						tags: ['cooking', 'soup'],
						title: 'Soup',
						topics: 'lentils; cumin'
					})
					assert.deepStrictEqual(yield* notes.image(IDS[0]), {
						bytes: new Uint8Array([255, 216, 255]),
						type: 'image/jpeg'
					})
					yield* notes.capture(USER, {id: IDS[1], text: 'https://example.com/soup#method'})
					yield* notes.capture(USER, {id: IDS[0], text: 'https://example.com/soup?utm_source=x'})
					yield* notes.capture(USER, {id: IDS[1], text: 'Make it on Sunday https://example.com/soup'})
					yield* notes.capture(USER, {id: IDS[2], text: 'make it on sunday tonight https://example.com/soup'})
					const merged = yield* settled(notes, current =>
						Array.some(current, note => String.endsWith('tonight')(note.text))
					)
					assert.deepStrictEqual(
						Array.map(merged, note => note.text),
						['https://example.com/soup?utm_source=x\nMake it on Sunday\ntonight']
					)
				})
			)
			assert.containsSubset(
				(yield* settled(
					yield* open({database, directory, organizer: counting(calls), sources: recipe}),
					() => true
				))[0],
				{id: IDS[0], status: 'ready', title: 'Soup'}
			)
			assert.strictEqual(yield* Ref.get(calls), 1)
		})
	)

	test.effect(
		'resumes a note a restart interrupted with the AI keys of the person who saved it',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const reached = yield* Queue.unbounded<string>()
			const database = yield* Layer.build(memory)
			yield* Effect.scoped(
				Effect.gen(function* () {
					const notes = yield* open({
						database,
						directory,
						organizer: Organizer.of({
							organize: Effect.fnUntraced(function* (userId) {
								return yield* pipe(reached, Queue.offer(userId), Effect.andThen(Effect.never))
							})
						}),
						sources: recipe
					})
					yield* notes.capture(USER, {id: IDS[0], text: 'https://example.com/soup'})
					assert.strictEqual(yield* Queue.take(reached), USER)
				})
			)
			const calls = yield* Ref.make(0)
			const resumed = yield* open({
				database,
				directory,
				organizer: Organizer.of({
					organize: Effect.fnUntraced(function* (userId, input) {
						return yield* pipe(reached, Queue.offer(userId), Effect.andThen(counting(calls).organize(userId, input)))
					})
				}),
				sources: recipe
			})
			assert.strictEqual(yield* Queue.take(reached), USER)
			assert.containsSubset((yield* settled(resumed, isReady))[0], {id: IDS[0], status: 'ready'})
		})
	)

	test.effect(
		'keeps the note untagged and says why when the link or the AI fails, or no key is set',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const unreachable = Sources.of({
				...recipe,
				extract: () => Effect.fail(NotesError.make({message: 'The link could not be loaded.'})),
				image: () => Effect.die('No preview without a page')
			})
			const cases = [
				{
					issue: 'AI tagging failed; the note is saved as it is.',
					organizer: Organizer.of({
						organize: () => Effect.fail(NotesError.make({message: 'AI tagging failed; the note is saved as it is.'}))
					}),
					sources: unreachable,
					text: 'Remember this https://example.com/a'
				},
				{
					issue: 'The link could not be loaded.',
					organizer: Organizer.of({organize: () => Effect.die('AI must not run without content')}),
					sources: unreachable,
					text: 'https://example.com/a'
				},
				{
					issue: 'Not tagged: the server has no AI key.',
					organizer: noKey,
					sources: recipe,
					text: 'https://example.com/a'
				}
			]
			for (const entry of cases) {
				const notes = yield* open({...entry, directory: yield* fs.makeTempDirectoryScoped()})
				yield* notes.capture(USER, {id: IDS[0], text: entry.text})
				assert.containsSubset(
					(yield* settled(notes, current => Array.some(current, note => note.status === 'failed')))[0],
					{issue: entry.issue, tags: [], text: entry.text}
				)
			}
		})
	)

	test.effect(
		'keeps the first definition of each tag, takes a variant as the tag in use, and remembers both',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const seen = yield* Ref.make(Array.empty<TagEntry[]>())
			const answers = [
				{
					definitions: [
						{definition: 'Recipes and kitchen techniques.', tag: 'Cooking'},
						{definition: 'A later duplicate must not replace the first definition.', tag: 'cooking'}
					],
					tags: ['cooking']
				},
				{
					definitions: [
						{definition: 'Anything with a stove.', tag: 'cooking'},
						{definition: 'Soups and stews.', tag: 'soup'}
					],
					tags: ['cookings', 'soup']
				}
			]
			const organizer = Organizer.of({
				organize: Effect.fnUntraced(function* (_userId, input) {
					return yield* pipe(
						seen,
						Ref.getAndUpdate(all => [...all, input.tags]),
						Effect.map(earlier => ({
							body: '',
							screenText: '',
							summary: '',
							title: 'Soup',
							topics: '',
							...Array.getUnsafe(answers, Number.min(earlier.length, 1))
						}))
					)
				})
			})
			yield* Effect.scoped(
				Effect.gen(function* () {
					const notes = yield* open({directory, organizer, sources: recipe})
					yield* notes.capture(USER, {id: IDS[0], text: 'https://example.com/soup'})
					yield* settled(notes, isReady)
					yield* notes.capture(USER, {id: IDS[1], text: 'https://example.com/stew'})
					assert.deepStrictEqual(
						Array.map(
							yield* settled(notes, current => Array.every(current, note => note.status === 'ready')),
							note => note.tags
						),
						[['cooking', 'soup'], ['cooking']]
					)
				})
			)
			assert.deepStrictEqual(
				Array.get(yield* Ref.get(seen), 1),
				Option.some([{count: 1, definition: Option.some('Recipes and kitchen techniques.'), name: 'cooking'}])
			)
		})
	)

	test.effect(
		'keeps what a video says and shows the AI its labeled preview and stills',
		Effect.fnUntraced(function* () {
			const seen = yield* Ref.make<
				Option.Option<{images: Uint8Array[]; labels: string[]; transcript: Option.Option<string>}>
			>(Option.none())
			const calls = yield* Ref.make(0)
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				media: Media.of({
					...noVideo,
					frames: () => Effect.succeed([{bytes: new Uint8Array([1]), seconds: 0}]),
					read: () =>
						Effect.succeed({info: '# Lentils', transcript: Effect.succeedSome('[00:01] Soak the lentils overnight.\n')})
				}),
				organizer: Organizer.of({
					organize: Effect.fnUntraced(function* (userId, input) {
						return yield* pipe(
							seen,
							Ref.set(
								Option.some({
									images: Array.map(input.images, image => image.bytes),
									labels: Array.map(input.images, image => image.label),
									transcript: input.note.transcript
								})
							),
							Effect.andThen(counting(calls).organize(userId, input))
						)
					})
				}),
				sources: Sources.of({
					...recipe,
					extract: link => Effect.map(recipe.extract(link), extraction => ({...extraction, text: ''}))
				})
			})
			yield* notes.capture(USER, {id: IDS[0], text: 'https://www.tiktok.com/@cook/video/1'})
			assert.containsSubset((yield* settled(notes, isReady))[0], {
				content: '# Lentils',
				transcript: '[00:01] Soak the lentils overnight.\n'
			})
			assert.deepStrictEqual(
				yield* Ref.get(seen),
				Option.some({
					images: [new Uint8Array([255, 216, 255]), new Uint8Array([1])],
					labels: ['Preview image', 'Video still at [00:00]'],
					transcript: Option.some('[00:01] Soak the lentils overnight.\n')
				})
			)
		})
	)

	test.effect(
		'looks up X captions on the post and publishes them before its direct clip finishes sampling',
		Effect.fnUntraced(function* () {
			const sampled = yield* Latch.make()
			const lookups = yield* Ref.make<string[]>([])
			const calls = yield* Ref.make(0)
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				media: Media.of({
					...noVideo,
					frames: Effect.fnUntraced(function* (link) {
						return yield* pipe(
							lookups,
							Ref.update(links => Array.append(links, link)),
							Effect.andThen(Effect.as(sampled.await, []))
						)
					}),
					read: Effect.fnUntraced(function* (_userId, link, fallback) {
						return yield* pipe(
							lookups,
							Ref.update(links => Array.append(links, `${link} | ${fallback ?? ''}`)),
							Effect.as({
								info: 'Video metadata',
								transcript: Effect.succeedSome('[00:01] Read the captions from the post.\n')
							})
						)
					})
				}),
				organizer: counting(calls),
				sources: Sources.of({
					...recipe,
					extract: link =>
						Effect.map(recipe.extract(link), page => ({...page, video: 'https://video.twimg.com/clip.mp4'}))
				})
			})
			yield* notes.capture(USER, {id: IDS[0], text: 'https://x.com/cook/status/1'})
			assert.containsSubset(
				(yield* settled(notes, state => Array.some(state, note => note.transcript !== undefined)))[0],
				{
					content: 'Lentils with cumin and tomato.',
					status: 'organizing',
					transcript: '[00:01] Read the captions from the post.\n'
				}
			)
			yield* sampled.open
			yield* settled(notes, isReady)
			assert.deepStrictEqual(yield* Ref.get(lookups), [
				'https://x.com/cook/status/1 | https://video.twimg.com/clip.mp4',
				'https://video.twimg.com/clip.mp4'
			])
		})
	)

	test.effect(
		'gives the background pipeline its own trace, linked to the capture that started it',
		Effect.fnUntraced(function* () {
			const recording = recordingTracer()
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: counting(yield* Ref.make(0)),
				sources: recipe
			})
			yield* Effect.withTracer(notes.capture(USER, {id: IDS[0], text: 'https://example.com/soup'}), recording.tracer)
			yield* settled(notes, isReady)
			const request = Option.getOrThrow(Array.findFirst(recording.spans(), span => span.name === 'Notes.capture'))
			const pipeline = Option.getOrThrow(Array.findFirst(recording.spans(), span => span.name === 'Notes.organize'))
			assert.isTrue(Option.isNone(pipeline.parent))
			assert.notStrictEqual(pipeline.traceId, request.traceId)
			assert.strictEqual(pipeline.attributes.get('note.id'), IDS[0])
			assert.isTrue(Array.some(pipeline.links, link => link.span.spanId === request.spanId))
		})
	)

	test.effect(
		'shows a note waiting for the tagging permit inside its own span',
		Effect.fnUntraced(function* () {
			const tagged = MutableList.make<Tracer.NativeSpan>()
			const tagSpans = Latch.makeUnsafe(false)
			const recording = recordingTracer(span => {
				if (span.name !== 'Notes.tag') return
				MutableList.append(tagged, span)
				if (tagged.length === 2) tagSpans.openUnsafe()
			})
			const firstOrganizer = yield* Latch.make()
			const release = yield* Latch.make()
			const answer = counting(yield* Ref.make(0))
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: Organizer.of({
					organize: (userId, input) =>
						Boolean.match(input.note.id === IDS[0], {
							onFalse: () => answer.organize(userId, input),
							onTrue: () =>
								Effect.andThen(firstOrganizer.open, Effect.andThen(release.await, answer.organize(userId, input)))
						})
				}),
				sources: recipe
			})
			yield* Effect.withTracer(
				Effect.gen(function* () {
					yield* notes.capture(USER, {id: IDS[0], text: 'https://example.com/soup'})
					yield* notes.capture(USER, {id: IDS[1], text: 'https://example.com/stew'})
				}),
				recording.tracer
			)
			yield* firstOrganizer.await
			yield* tagSpans.await
			const tagList = MutableList.toArray(tagged)
			assert.strictEqual(tagList.length, 2)
			yield* TestClock.adjust('1 second')
			yield* release.open
			yield* settled(notes, current => Array.every(current, note => note.status === 'ready'))
			yield* pipe(
				5,
				Array.makeBy(() => Effect.yieldNow),
				Effect.forEach(Function.identity, {concurrency: 1, discard: true})
			)
			const [first, second] = tagList
			assert.isDefined(first)
			assert.isDefined(second)
			assert.strictEqual(first.status._tag, 'Ended')
			assert.strictEqual(second.status._tag, 'Ended')
			if (first.status._tag !== 'Ended' || second.status._tag !== 'Ended') return
			assert.isTrue(first.startTime <= second.startTime)
			assert.isTrue(second.startTime < first.status.endTime)
		})
	)

	test.effect(
		'runs the video transcript and stills at the same time',
		Effect.fnUntraced(function* () {
			const recording = recordingTracer()
			const readStarted = yield* Latch.make()
			const framesStarted = yield* Latch.make()
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				media: Media.of({
					...noVideo,
					frames: Effect.fn('Media.frames')(function* () {
						yield* framesStarted.open
						yield* Effect.sleep('10 seconds')
						return []
					}),
					read: Effect.fn('Media.read')(function* () {
						yield* readStarted.open
						yield* Effect.sleep('10 seconds')
						return {info: 'Video metadata', transcript: Effect.succeedSome('[00:01] Soak the lentils.\n')}
					})
				}),
				organizer: counting(yield* Ref.make(0)),
				sources: recipe
			})
			yield* Effect.withTracer(
				notes.capture(USER, {id: IDS[0], text: 'https://www.youtube.com/watch?v=USeyDcWyVCc'}),
				recording.tracer
			)
			yield* readStarted.await
			yield* framesStarted.await
			yield* TestClock.adjust('10 seconds')
			yield* settled(notes, isReady)
			const read = Option.getOrThrow(Array.findFirst(recording.spans(), span => span.name === 'Media.read'))
			const frames = Option.getOrThrow(Array.findFirst(recording.spans(), span => span.name === 'Media.frames'))
			assert.strictEqual(read.status._tag, 'Ended')
			assert.strictEqual(frames.status._tag, 'Ended')
			if (read.status._tag !== 'Ended' || frames.status._tag !== 'Ended') return
			assert.isTrue(frames.startTime < read.status.endTime)
			assert.isTrue(read.startTime < frames.status.endTime)
		})
	)

	test.effect(
		'reads a video through yt-dlp when its page refuses the reader',
		Effect.fnUntraced(function* () {
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				media: Media.of({
					...noVideo,
					read: () => Effect.succeed({info: '# Lentils', transcript: Effect.succeedSome('[00:01] Soak them.\n')})
				}),
				organizer: counting(yield* Ref.make(0)),
				sources: Sources.of({
					...recipe,
					extract: () => Effect.fail(NotesError.make({message: 'The link answered with status 400.'}))
				})
			})
			yield* notes.capture(USER, {id: IDS[0], text: 'https://www.tiktok.com/@cook/video/1'})
			assert.containsSubset((yield* settled(notes, isReady))[0], {
				content: '# Lentils',
				issue: undefined,
				transcript: '[00:01] Soak them.\n'
			})
		})
	)

	test.effect(
		'shows the AI every slide of a photo post after its preview',
		Effect.fnUntraced(function* () {
			const seen = yield* Ref.make(Array.empty<Uint8Array>())
			const tagger = counting(yield* Ref.make(0))
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: Organizer.of({
					organize: Effect.fnUntraced(function* (userId, input) {
						return yield* pipe(
							seen,
							Ref.set(Array.map(input.images, image => image.bytes)),
							Effect.andThen(tagger.organize(userId, input))
						)
					})
				}),
				sources: Sources.of({
					...recipe,
					extract: link =>
						Effect.map(recipe.extract(link), extraction => ({
							...extraction,
							image: Option.some('https://example.com/1.jpg'),
							slides: ['https://example.com/2.jpg']
						})),
					image: link =>
						Effect.succeed({
							bytes: new Uint8Array([
								Boolean.match(String.endsWith('2.jpg')(link), {onFalse: () => 1, onTrue: () => 2})
							]),
							type: 'image/jpeg' as const
						})
				})
			})
			yield* notes.capture(USER, {id: IDS[0], text: 'https://example.com/slides'})
			yield* settled(notes, isReady)
			assert.deepStrictEqual(yield* Ref.get(seen), [new Uint8Array([1]), new Uint8Array([2])])
		})
	)

	test.effect(
		'resolves a short link before saving, so another share of the post joins the saved note',
		Effect.fnUntraced(function* () {
			const calls = yield* Ref.make(0)
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: counting(calls),
				sources: Sources.of({...recipe, resolve: () => Effect.succeed('https://www.tiktok.com/@cook/video/1')})
			})
			yield* notes.capture(USER, {id: IDS[0], text: 'https://vm.tiktok.com/AAA/'})
			yield* settled(notes, isReady)
			assert.containsSubset(
				yield* Schema.encodeEffect(NoteItem.json)(
					yield* notes.capture(USER, {id: IDS[1], text: 'Make it tonight https://vm.tiktok.com/BBB/'})
				),
				{id: IDS[0], url: 'https://www.tiktok.com/@cook/video/1'}
			)
			assert.deepStrictEqual(
				Array.map(yield* settled(notes, () => true), note => note.text),
				['https://vm.tiktok.com/AAA/\nMake it tonight']
			)
			assert.strictEqual(yield* Ref.get(calls), 1)
		})
	)

	test.effect(
		'tags a note again when a shutdown interrupted its tagging',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const database = yield* Layer.build(memory)
			const tagging = yield* Latch.make()
			yield* Effect.scoped(
				Effect.gen(function* () {
					const notes = yield* open({
						database,
						directory,
						organizer: Organizer.of({organize: () => Effect.andThen(tagging.open, Effect.never)}),
						sources: recipe
					})
					yield* notes.capture(USER, {id: IDS[0], text: 'https://example.com/soup'})
					yield* tagging.await
				})
			)
			const calls = yield* Ref.make(0)
			const down = Sources.of({
				...recipe,
				extract: () => Effect.fail(NotesError.make({message: 'The link could not be loaded.'}))
			})
			assert.containsSubset(
				(yield* settled(yield* open({database, directory, organizer: counting(calls), sources: down}), isReady))[0],
				{author: 'Cookbook', content: 'Lentils with cumin and tomato.', id: IDS[0], issue: undefined, title: 'Soup'}
			)
			assert.strictEqual(yield* Ref.get(calls), 1)
		})
	)

	test.effect(
		'sends watchers the list once, then only the changes, without the long texts',
		Effect.fnUntraced(function* () {
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: counting(yield* Ref.make(0)),
				sources: recipe
			})
			yield* notes.capture(USER, {id: IDS[0], text: 'https://example.com/soup'})
			yield* settled(notes, isReady)
			const queue = yield* Queue.unbounded<Stream.Success<typeof notes.events>>()
			const events = yield* pipe(
				notes.events,
				Stream.takeUntil(event => Array.isReadonlyArrayNonEmpty(event.removed)),
				Stream.runForEach(event => Queue.offer(queue, event)),
				Effect.forkScoped
			)
			const first = yield* Queue.take(queue)
			yield* notes.capture(USER, {id: IDS[1], text: 'https://example.com/stew'})
			yield* settled(notes, current => Array.every(current, note => note.status === 'ready'))
			yield* notes.remove(IDS[0])
			yield* Fiber.join(events)
			const received = yield* Effect.forEach(
				[first, ...(yield* Queue.takeAll(queue))],
				event => Schema.encodeEffect(NotesEvent)(event),
				{concurrency: 'unbounded'}
			)
			// Each commit of the second note's organizing sends that note alone; the removal sends only its id.
			assert.deepStrictEqual(
				Array.dedupeAdjacent(
					Array.map(received, event => ({
						removed: event.removed,
						reset: event.reset,
						upserted: Array.map(event.upserted, item => item.id)
					}))
				),
				[
					{removed: [], reset: true, upserted: [IDS[0]]},
					{removed: [], reset: false, upserted: [IDS[1]]},
					{removed: [IDS[0]], reset: false, upserted: []}
				]
			)
			assert.isFalse(
				Array.some(received, event => Array.some(event.upserted, item => Predicate.hasProperty(item, 'content')))
			)
		})
	)

	test.effect(
		'reads and tags a note again when asked to regenerate it',
		Effect.fnUntraced(function* () {
			const calls = yield* Ref.make(0)
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: counting(calls),
				sources: recipe
			})
			yield* notes.capture(USER, {id: IDS[0], text: 'https://example.com/soup'})
			yield* settled(notes, isReady)
			yield* notes.regenerate(USER, IDS[0])
			yield* settled(notes, isReady)
			assert.strictEqual(yield* Ref.get(calls), 2)
			assert.instanceOf(yield* Effect.flip(notes.regenerate(USER, IDS[1])), NotesError)
		})
	)

	test.effect(
		'starts a regenerated note over while its first read still runs',
		Effect.fnUntraced(function* () {
			const calls = yield* Ref.make(0)
			const release = yield* Latch.make()
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: counting(calls),
				sources: Sources.of({...recipe, extract: link => Effect.andThen(release.await, recipe.extract(link))})
			})
			yield* notes.capture(USER, {id: IDS[0], text: 'https://example.com/soup'})
			yield* notes.regenerate(USER, IDS[0])
			yield* release.open
			assert.containsSubset((yield* settled(notes, isReady))[0], {id: IDS[0], title: 'Soup'})
			assert.strictEqual(yield* Ref.get(calls), 1)
		})
	)

	test.effect(
		'stops downloading the preview of a note deleted while its image downloads',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const downloading = yield* Latch.make()
			const cancelled = yield* Latch.make()
			const notes = yield* open({
				directory,
				organizer: noKey,
				sources: Sources.of({
					...recipe,
					image: () =>
						Effect.andThen(
							downloading.open,
							Effect.onInterrupt(Effect.never, () => cancelled.open)
						)
				})
			})
			yield* notes.capture(USER, {id: IDS[0], text: 'https://example.com/soup'})
			yield* downloading.await
			yield* notes.remove(IDS[0])
			yield* cancelled.await
			yield* settled(notes, Array.isReadonlyArrayEmpty)
		})
	)

	test.effect(
		'keeps words shared while the link loads, and removes a note with its preview',
		Effect.fnUntraced(function* () {
			const release = yield* Latch.make()
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: noKey,
				sources: Sources.of({...recipe, extract: link => Effect.andThen(release.await, recipe.extract(link))})
			})
			yield* notes.capture(USER, {id: IDS[0], text: 'https://example.com/slow'})
			yield* notes.capture(USER, {id: IDS[1], text: 'Read later https://example.com/slow'})
			yield* release.open
			assert.containsSubset(
				(yield* settled(notes, current => Array.some(current, note => note.status === 'failed')))[0],
				{image: 'image/jpeg', text: 'https://example.com/slow\nRead later'}
			)
			yield* notes.remove(IDS[0])
			assert.deepStrictEqual(yield* settled(notes, () => true), [])
			assert.instanceOf(yield* Effect.flip(notes.image(IDS[0])), NotesError)
		})
	)

	test.effect(
		'keeps an uploaded photo as its own preview, once per id',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			const calls = yield* Ref.make(0)
			const notes = yield* open({directory, organizer: counting(calls), sources: recipe})
			const photo = new Uint8Array([255, 216, 255, 224])
			assert.containsSubset(
				yield* Schema.encodeEffect(NoteItem.json)(
					yield* notes.captureFile(USER, {
						body: Stream.make(Uint8Array.of(255, 216), Uint8Array.of(255, 224)),
						id: IDS[0],
						type: 'image/jpeg'
					})
				),
				{file: 'image/jpeg', image: 'image/jpeg', status: 'organizing'}
			)
			yield* settled(notes, isReady)
			yield* notes.captureFile(USER, {body: Stream.die('A resend must not be read'), id: IDS[0], type: 'image/jpeg'})
			assert.deepStrictEqual(yield* notes.image(IDS[0]), {bytes: photo, type: 'image/jpeg'})
			assert.deepStrictEqual(yield* fs.readDirectory(`${directory}/images`), [IDS[0]])
			assert.deepStrictEqual(yield* fs.readDirectory(`${directory}/files`), [])
			assert.strictEqual(yield* Ref.get(calls), 1)
		})
	)

	test.effect(
		"takes a video upload's first still as its preview and its speech as the transcript",
		Effect.fnUntraced(function* () {
			const still = new Uint8Array([255, 216, 255, 1])
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				media: Media.of({
					...noVideo,
					fileFrames: () =>
						Effect.succeed([
							{bytes: still, seconds: 0},
							{bytes: new Uint8Array([255, 216, 255, 2]), seconds: 1}
						]),
					fileTranscript: () => Effect.succeedSome('[00:00] Hello')
				}),
				organizer: counting(yield* Ref.make(0)),
				sources: recipe
			})
			yield* notes.captureFile(USER, {body: Stream.make(Uint8Array.of(0, 0, 0)), id: IDS[0], type: 'video/mp4'})
			assert.containsSubset((yield* settled(notes, isReady))[0], {
				file: 'video/mp4',
				image: 'image/jpeg',
				transcript: '[00:00] Hello'
			})
			assert.deepStrictEqual(yield* notes.image(IDS[0]), {bytes: still, type: 'image/jpeg'})
		})
	)

	test.effect(
		'cleans up a finished upload when moving it into place fails',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			const notes = yield* Effect.provideService(
				open({directory, organizer: noKey, sources: recipe}),
				FileSystem.FileSystem,
				{
					...fs,
					rename: (from, to) => {
						if (String.endsWith('.partial')(from)) {
							return Effect.fail(
								PlatformError.systemError({
									_tag: 'PermissionDenied',
									method: 'rename',
									module: 'FileSystem',
									pathOrDescriptor: from
								})
							)
						}
						return fs.rename(from, to)
					}
				}
			)
			assert.instanceOf(
				yield* Effect.flip(
					notes.captureFile(USER, {body: Stream.make(Uint8Array.of(1)), id: IDS[0], type: 'image/jpeg'})
				),
				NotesError
			)
			assert.isEmpty(yield* fs.readDirectory(`${directory}/images`))
			assert.isEmpty(yield* settled(notes, () => true))
		})
	)
	test.effect(
		'leaves no note and no file behind when an upload breaks off',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			const notes = yield* open({directory, organizer: counting(yield* Ref.make(0)), sources: recipe})
			const failure = yield* Effect.flip(
				notes.captureFile(USER, {
					body: Stream.concat(Stream.make(Uint8Array.of(1)), Stream.fail('connection reset')),
					id: IDS[0],
					type: 'image/jpeg'
				})
			)
			assert.instanceOf(failure, NotesError)
			assert.deepStrictEqual(yield* fs.readDirectory(`${directory}/images`), [])
			assert.deepStrictEqual(yield* settled(notes, () => true), [])
		})
	)
})
