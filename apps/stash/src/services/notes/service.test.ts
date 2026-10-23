import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Boolean,
	Context,
	Effect,
	Fiber,
	FileSystem,
	Latch,
	Layer,
	Number,
	Option,
	Predicate,
	Ref,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {TestClock} from 'effect/testing'

import {MediaError} from '#services/media/schema.ts'
import {Media} from '#services/media/service.ts'
import {Sources} from '#services/notes/lib/extraction.ts'
import {Organizer} from '#services/notes/lib/organization.ts'
import type {Note, TagEntry} from '#services/notes/schema.ts'
import {Extraction, NotesError, NotesEvent} from '#services/notes/schema.ts'
import {Notes} from '#services/notes/service.ts'

const IDS = [
	'6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c01',
	'6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c02',
	'6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c03'
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

const open = Effect.fnUntraced(function* (options: {
	directory: string
	media?: typeof Media.Service
	organizer: typeof Organizer.Service
	sources: typeof Sources.Service
}) {
	const context = yield* Layer.build(
		pipe(
			Notes.layer(options.directory),
			Layer.provide(Layer.succeed(Sources, options.sources)),
			Layer.provide(Layer.succeed(Media, options.media ?? noVideo)),
			Layer.provide(Layer.succeed(Organizer, options.organizer))
		)
	)
	return Context.get(context, Notes)
})

const settled = Effect.fnUntraced(function* (notes: typeof Notes.Service, done: (state: Note[]) => boolean) {
	return yield* pipe(
		notes.changes,
		Stream.filter(done),
		Stream.runHead,
		Effect.map(Option.getOrThrow),
		Effect.timeout('5 seconds')
	)
})

function isReady(state: Note[]) {
	return Array.some(state, note => note.status === 'ready')
}

const noKey = Organizer.of({
	organize: () => Effect.fail(NotesError.make({message: 'Not tagged: the server has no AI key.'}))
})

function counting(calls: Ref.Ref<number>) {
	return Organizer.of({
		organize: input =>
			Effect.as(
				Ref.update(calls, count => count + 1),
				{
					body: '',
					definitions: [{definition: 'Recipes and cooking techniques.', tag: 'cooking'}],
					screenText: '',
					summary: `About ${input.note.content}`,
					tags: ['cooking', 'soup'],
					title: 'Soup',
					topics: 'lentils; cumin'
				}
			)
	})
}

it.layer(NodeServices.layer)('Notes', test => {
	test.effect('saves the original first, tags it once, and keeps the result across a restart', () =>
		Effect.gen(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const calls = yield* Ref.make(0)
			yield* Effect.scoped(
				Effect.gen(function* () {
					const notes = yield* open({directory, organizer: counting(calls), sources: recipe})
					assert.containsSubset(yield* notes.capture({id: IDS[0], text: ' https://example.com/soup?utm_source=x '}), {
						status: 'organizing',
						title: 'https://example.com/soup',
						url: 'https://example.com/soup'
					})
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
					yield* notes.capture({id: IDS[1], text: 'https://example.com/soup#method'})
					yield* notes.capture({id: IDS[0], text: 'https://example.com/soup?utm_source=x'})
					yield* notes.capture({id: IDS[1], text: 'Make it on Sunday https://example.com/soup'})
					yield* notes.capture({id: IDS[2], text: 'make it on sunday tonight https://example.com/soup'})
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
				(yield* settled(yield* open({directory, organizer: counting(calls), sources: recipe}), () => true))[0],
				{id: IDS[0], status: 'ready', title: 'Soup'}
			)
			assert.strictEqual(yield* Ref.get(calls), 1)
		})
	)

	test.effect('keeps the note untagged and says why when the link or the AI fails, or no key is set', () =>
		Effect.gen(function* () {
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
					issue: 'The AI answer was unreadable.',
					organizer: Organizer.of({
						organize: () => Effect.fail(NotesError.make({message: 'The AI answer was unreadable.'}))
					}),
					sources: recipe,
					text: 'https://example.com/a'
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
				yield* notes.capture({id: IDS[0], text: entry.text})
				assert.containsSubset(
					(yield* settled(notes, current => Array.some(current, note => note.status === 'failed')))[0],
					{issue: entry.issue, tags: [], text: entry.text}
				)
			}
		})
	)

	test.effect('keeps the first definition of each tag, takes a variant as the tag in use, and remembers both', () =>
		Effect.gen(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const seen = yield* Ref.make(Array.empty<TagEntry[]>())
			const answers = [
				{definitions: [{definition: 'Recipes and kitchen techniques.', tag: 'Cooking'}], tags: ['cooking']},
				{
					definitions: [
						{definition: 'Anything with a stove.', tag: 'cooking'},
						{definition: 'Soups and stews.', tag: 'soup'}
					],
					tags: ['cookings', 'soup']
				}
			]
			const organizer = Organizer.of({
				organize: input =>
					Effect.map(
						Ref.getAndUpdate(seen, all => [...all, input.tags]),
						earlier => ({
							body: '',
							screenText: '',
							summary: '',
							title: 'Soup',
							topics: '',
							...Array.getUnsafe(answers, Number.min(earlier.length, 1))
						})
					)
			})
			yield* Effect.scoped(
				Effect.gen(function* () {
					const notes = yield* open({directory, organizer, sources: recipe})
					yield* notes.capture({id: IDS[0], text: 'https://example.com/soup'})
					yield* settled(notes, isReady)
					yield* notes.capture({id: IDS[1], text: 'https://example.com/stew'})
					assert.deepStrictEqual(
						Array.map(
							yield* settled(notes, current => Array.every(current, note => note.status === 'ready')),
							note => note.tags
						),
						[['cooking', 'soup'], ['cooking']]
					)
				})
			)
			assert.deepStrictEqual(yield* (yield* open({directory, organizer, sources: recipe})).tags, [
				{count: 2, definition: 'Recipes and kitchen techniques.', tag: 'cooking'},
				{count: 1, definition: 'Soups and stews.', tag: 'soup'}
			])
			assert.deepStrictEqual(
				Array.get(yield* Ref.get(seen), 1),
				Option.some([{count: 1, definition: 'Recipes and kitchen techniques.', tag: 'cooking'}])
			)
		})
	)

	test.effect('keeps what a video says and shows the AI its labeled preview and stills', () =>
		Effect.gen(function* () {
			const seen = yield* Ref.make<
				Option.Option<{images: Uint8Array[]; labels: string[]; transcript: Note['transcript']}>
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
					organize: input =>
						Effect.andThen(
							Ref.set(
								seen,
								Option.some({
									images: Array.map(input.images, image => image.bytes),
									labels: Array.map(input.images, image => image.label),
									transcript: input.note.transcript
								})
							),
							counting(calls).organize(input)
						)
				}),
				sources: Sources.of({
					...recipe,
					extract: link => Effect.map(recipe.extract(link), extraction => ({...extraction, text: ''}))
				})
			})
			yield* notes.capture({id: IDS[0], text: 'https://www.tiktok.com/@cook/video/1'})
			assert.containsSubset((yield* settled(notes, isReady))[0], {
				content: '# Lentils',
				transcript: '[00:01] Soak the lentils overnight.\n'
			})
			assert.deepStrictEqual(
				yield* Ref.get(seen),
				Option.some({
					images: [new Uint8Array([255, 216, 255]), new Uint8Array([1])],
					labels: ['Preview image', 'Video still at [00:00]'],
					transcript: '[00:01] Soak the lentils overnight.\n'
				})
			)
		})
	)

	test.effect('reads a video through yt-dlp when its page refuses the reader', () =>
		Effect.gen(function* () {
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
			yield* notes.capture({id: IDS[0], text: 'https://www.tiktok.com/@cook/video/1'})
			assert.containsSubset((yield* settled(notes, isReady))[0], {
				content: '# Lentils',
				issue: undefined,
				transcript: '[00:01] Soak them.\n'
			})
		})
	)

	test.effect('shows the AI every slide of a photo post after its preview', () =>
		Effect.gen(function* () {
			const seen = yield* Ref.make(Array.empty<Uint8Array>())
			const tagger = counting(yield* Ref.make(0))
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: Organizer.of({
					organize: input =>
						Effect.andThen(
							Ref.set(
								seen,
								Array.map(input.images, image => image.bytes)
							),
							tagger.organize(input)
						)
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
			yield* notes.capture({id: IDS[0], text: 'https://example.com/slides'})
			yield* settled(notes, isReady)
			assert.deepStrictEqual(yield* Ref.get(seen), [new Uint8Array([1]), new Uint8Array([2])])
		})
	)

	test.effect('resolves a short link before saving, so another share of the post joins the saved note', () =>
		Effect.gen(function* () {
			const calls = yield* Ref.make(0)
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: counting(calls),
				sources: Sources.of({...recipe, resolve: () => Effect.succeed('https://www.tiktok.com/@cook/video/1')})
			})
			yield* notes.capture({id: IDS[0], text: 'https://vm.tiktok.com/AAA/'})
			yield* settled(notes, isReady)
			assert.containsSubset(yield* notes.capture({id: IDS[1], text: 'Make it tonight https://vm.tiktok.com/BBB/'}), {
				id: IDS[0],
				text: 'https://vm.tiktok.com/AAA/\nMake it tonight',
				url: 'https://www.tiktok.com/@cook/video/1'
			})
			assert.strictEqual(yield* Ref.get(calls), 1)
		})
	)

	test.effect('joins a share to a note saved under an older form of its link', () =>
		Effect.gen(function* () {
			// The first save stands in for the release that stored youtu.be links as shared.
			const older = yield* Ref.make(Option.some('https://youtu.be/USeyDcWyVCc'))
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: counting(yield* Ref.make(0)),
				sources: Sources.of({
					...recipe,
					resolve: link =>
						Effect.map(
							Ref.getAndSet(older, Option.none()),
							Option.getOrElse(() => link)
						)
				})
			})
			yield* notes.capture({id: IDS[0], text: 'https://youtu.be/USeyDcWyVCc'})
			yield* settled(notes, isReady)
			assert.containsSubset(
				yield* notes.capture({id: IDS[1], text: 'https://www.youtube.com/watch?v=USeyDcWyVCc&t=42s'}),
				{id: IDS[0], url: 'https://youtu.be/USeyDcWyVCc'}
			)
		})
	)

	test.effect('tags a note again when a shutdown interrupted its tagging', () =>
		Effect.gen(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const tagging = yield* Latch.make()
			yield* Effect.scoped(
				Effect.gen(function* () {
					const notes = yield* open({
						directory,
						organizer: Organizer.of({organize: () => Effect.andThen(tagging.open, Effect.never)}),
						sources: recipe
					})
					yield* notes.capture({id: IDS[0], text: 'https://example.com/soup'})
					yield* tagging.await
				})
			)
			const calls = yield* Ref.make(0)
			const down = Sources.of({
				...recipe,
				extract: () => Effect.fail(NotesError.make({message: 'The link could not be loaded.'}))
			})
			assert.containsSubset(
				(yield* settled(yield* open({directory, organizer: counting(calls), sources: down}), isReady))[0],
				{author: 'Cookbook', content: 'Lentils with cumin and tomato.', id: IDS[0], issue: undefined, title: 'Soup'}
			)
			assert.strictEqual(yield* Ref.get(calls), 1)
		})
	)

	test.effect('sends watchers the list once, then only the changes, without the long texts', () =>
		Effect.gen(function* () {
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: counting(yield* Ref.make(0)),
				sources: recipe
			})
			yield* notes.capture({id: IDS[0], text: 'https://example.com/soup'})
			yield* settled(notes, isReady)
			const events = yield* pipe(notes.events, Stream.take(3), Stream.runCollect, Effect.forkScoped)
			yield* TestClock.adjust('1 second')
			yield* notes.capture({id: IDS[1], text: 'https://example.com/stew'})
			yield* settled(notes, current => Array.every(current, note => note.status === 'ready'))
			yield* TestClock.adjust('1 second')
			yield* notes.remove({id: IDS[0]})
			yield* TestClock.adjust('1 second')
			const received = yield* Effect.forEach(
				yield* Fiber.join(events),
				event => Schema.encodeEffect(NotesEvent)(event),
				{concurrency: 'unbounded'}
			)
			assert.deepStrictEqual(
				Array.map(received, event => ({
					removed: event.removed,
					reset: event.reset,
					upserted: Array.dedupe(Array.map(event.upserted, item => item.id))
				})),
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

	test.effect('reads and tags a note again when asked to regenerate it', () =>
		Effect.gen(function* () {
			const calls = yield* Ref.make(0)
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: counting(calls),
				sources: recipe
			})
			yield* notes.capture({id: IDS[0], text: 'https://example.com/soup'})
			yield* settled(notes, isReady)
			yield* notes.regenerate({id: IDS[0]})
			yield* settled(notes, isReady)
			assert.strictEqual(yield* Ref.get(calls), 2)
			assert.strictEqual((yield* Effect.flip(notes.regenerate({id: IDS[1]}))).message, 'This note no longer exists.')
		})
	)

	test.effect('starts a regenerated note over while its first read still runs', () =>
		Effect.gen(function* () {
			const calls = yield* Ref.make(0)
			const release = yield* Latch.make()
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: counting(calls),
				sources: Sources.of({...recipe, extract: link => Effect.andThen(release.await, recipe.extract(link))})
			})
			yield* notes.capture({id: IDS[0], text: 'https://example.com/soup'})
			yield* notes.regenerate({id: IDS[0]})
			yield* release.open
			assert.containsSubset((yield* settled(notes, isReady))[0], {id: IDS[0], title: 'Soup'})
			assert.strictEqual(yield* Ref.get(calls), 1)
		})
	)

	test.effect('keeps no preview for a note deleted while its image downloads', () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			const downloading = yield* Latch.make()
			const release = yield* Latch.make()
			const notes = yield* open({
				directory,
				organizer: noKey,
				sources: Sources.of({
					...recipe,
					image: link => Effect.andThen(Effect.andThen(downloading.open, release.await), recipe.image(link))
				})
			})
			yield* notes.capture({id: IDS[0], text: 'https://example.com/soup'})
			yield* downloading.await
			yield* notes.remove({id: IDS[0]})
			yield* release.open
			yield* settled(notes, Array.isReadonlyArrayEmpty)
			yield* TestClock.withLive(Effect.sleep('100 millis'))
			assert.isFalse(yield* fs.exists(`${directory}/images/${IDS[0]}`))
		})
	)

	test.effect('keeps words shared while the link loads, and removes a note with its preview', () =>
		Effect.gen(function* () {
			const release = yield* Latch.make()
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: noKey,
				sources: Sources.of({...recipe, extract: link => Effect.andThen(release.await, recipe.extract(link))})
			})
			yield* notes.capture({id: IDS[0], text: 'https://example.com/slow'})
			yield* notes.capture({id: IDS[1], text: 'Read later https://example.com/slow'})
			yield* release.open
			assert.containsSubset(
				(yield* settled(notes, current => Array.some(current, note => note.status === 'failed')))[0],
				{image: 'image/jpeg', text: 'https://example.com/slow\nRead later'}
			)
			yield* notes.remove({id: IDS[0]})
			assert.deepStrictEqual(yield* settled(notes, () => true), [])
			assert.strictEqual((yield* Effect.flip(notes.image(IDS[0]))).message, 'This note has no preview image.')
		})
	)

	test.effect('keeps an uploaded photo as its own preview, once per id', () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			const calls = yield* Ref.make(0)
			const notes = yield* open({directory, organizer: counting(calls), sources: recipe})
			const photo = new Uint8Array([255, 216, 255, 224])
			assert.containsSubset(
				yield* notes.captureFile({
					body: Stream.make(Uint8Array.of(255, 216), Uint8Array.of(255, 224)),
					id: IDS[0],
					type: 'image/jpeg'
				}),
				{file: 'image/jpeg', image: 'image/jpeg', status: 'organizing'}
			)
			yield* settled(notes, isReady)
			yield* notes.captureFile({body: Stream.die('A resend must not be read'), id: IDS[0], type: 'image/jpeg'})
			assert.deepStrictEqual(yield* notes.image(IDS[0]), {bytes: photo, type: 'image/jpeg'})
			assert.deepStrictEqual(yield* fs.readDirectory(`${directory}/images`), [IDS[0]])
			assert.deepStrictEqual(yield* fs.readDirectory(`${directory}/files`), [])
			assert.strictEqual(yield* Ref.get(calls), 1)
		})
	)

	test.effect("takes a video upload's first still as its preview and its speech as the transcript", () =>
		Effect.gen(function* () {
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
			yield* notes.captureFile({body: Stream.make(Uint8Array.of(0, 0, 0)), id: IDS[0], type: 'video/mp4'})
			assert.containsSubset((yield* settled(notes, isReady))[0], {
				file: 'video/mp4',
				image: 'image/jpeg',
				transcript: '[00:00] Hello'
			})
			assert.deepStrictEqual(yield* notes.image(IDS[0]), {bytes: still, type: 'image/jpeg'})
		})
	)

	test.effect('leaves no note and no file behind when an upload breaks off', () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			const notes = yield* open({directory, organizer: counting(yield* Ref.make(0)), sources: recipe})
			const failure = yield* Effect.flip(
				notes.captureFile({
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
