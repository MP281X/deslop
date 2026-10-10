import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	ConfigProvider,
	Context,
	Effect,
	FileSystem,
	Latch,
	Layer,
	Option,
	Order,
	Ref,
	Result,
	Stream,
	String,
	pipe
} from 'effect'

import {TestClock} from 'effect/testing'

import {Sources} from '#services/notes/internal/extraction.ts'
import {Organizer} from '#services/notes/internal/organization.ts'
import type {NotesState} from '#services/notes/schema.ts'
import {Extraction, NotesError} from '#services/notes/schema.ts'
import {Notes} from '#services/notes/service.ts'

const recipe = Sources.of({
	extract: link =>
		Effect.succeed(
			Extraction.make({
				author: 'Cookbook',
				image: Option.some('https://example.com/soup.jpg'),
				text: 'Lentils with cumin and tomato.',
				title: 'Lentil soup',
				url: link
			})
		),
	frames: () => Effect.succeed([]),
	image: () => Effect.succeed({bytes: new Uint8Array([255, 216, 255]), type: 'image/jpeg' as const}),
	transcript: () => Effect.succeedNone
})

const open = Effect.fnUntraced(function* (options: {
	budget?: string
	directory: string
	organizer: typeof Organizer.Service
	sources: typeof Sources.Service
}) {
	const context = yield* Layer.build(
		pipe(
			Notes.layer,
			Layer.provide(Layer.succeed(Sources, options.sources)),
			Layer.provide(Layer.succeed(Organizer, options.organizer)),
			Layer.provide(
				ConfigProvider.layer(
					ConfigProvider.fromUnknown({
						HOME: options.directory,
						STASH_AI_BUDGET_USD: options.budget ?? '1',
						STASH_DATA_DIR: options.directory
					})
				)
			)
		)
	)
	return Context.get(context, Notes)
})

// The first published state that satisfies the condition.
const settled = Effect.fnUntraced(function* (notes: typeof Notes.Service, done: (state: NotesState) => boolean) {
	return yield* pipe(
		notes.changes,
		Stream.filter(done),
		Stream.runHead,
		Effect.map(Option.getOrThrow),
		Effect.timeout('5 seconds')
	)
})

function counting(calls: Ref.Ref<number>) {
	return Organizer.of({
		enabled: true,
		organize: input =>
			Effect.as(
				Ref.update(calls, count => count + 1),
				{
					cost: 0.0004,
					organization: Result.succeed({
						summary: `About ${input.note.content}`,
						tags: ['Cooking', 'cooking', 'soup'],
						title: 'Soup',
						topics: 'lentils; cumin'
					})
				}
			)
	})
}

const ids = [
	'6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c01',
	'6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c02',
	'6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c03'
] as const

it.layer(NodeServices.layer)('Notes', test => {
	test.effect('saves the original first, tags it once, and keeps the result across a restart', () =>
		Effect.gen(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const calls = yield* Ref.make(0)
			yield* Effect.scoped(
				Effect.gen(function* () {
					const notes = yield* open({directory, organizer: counting(calls), sources: recipe})
					assert.containsSubset(yield* notes.capture({id: ids[0], text: ' https://example.com/soup?utm_source=x '}), {
						status: 'organizing',
						title: 'https://example.com/soup',
						url: 'https://example.com/soup'
					})
					const state = yield* settled(notes, current => Array.some(current.notes, note => note.status === 'ready'))
					assert.containsSubset(state.notes[0], {
						author: 'Cookbook',
						content: 'Lentils with cumin and tomato.',
						image: 'image/jpeg',
						summary: 'About Lentils with cumin and tomato.',
						tags: ['cooking', 'soup'],
						title: 'Soup',
						topics: 'lentils; cumin'
					})
					assert.deepStrictEqual(yield* notes.image(ids[0]), {
						bytes: new Uint8Array([255, 216, 255]),
						type: 'image/jpeg'
					})
					assert.strictEqual(state.aiSpend.usd, 0.0004)
					// The same post shared again, or the same capture retried, adds no note and no AI call.
					yield* notes.capture({id: ids[1], text: 'https://example.com/soup#method'})
					yield* notes.capture({id: ids[0], text: 'https://example.com/soup?utm_source=x'})
					yield* notes.capture({id: ids[1], text: 'Make it on Sunday https://example.com/soup'})
					yield* notes.capture({id: ids[2], text: 'make it on sunday tonight https://example.com/soup'})
					const merged = yield* settled(notes, current =>
						Array.some(current.notes, note => String.endsWith('tonight')(note.text))
					)
					assert.deepStrictEqual(
						Array.map(merged.notes, note => note.text),
						['https://example.com/soup?utm_source=x\nMake it on Sunday\ntonight']
					)
				})
			)
			assert.containsSubset(
				(yield* settled(yield* open({directory, organizer: counting(calls), sources: recipe}), () => true)).notes[0],
				{id: ids[0], status: 'ready', title: 'Soup'}
			)
			assert.strictEqual(yield* Ref.get(calls), 1)
		})
	)

	test.effect('keeps the note untagged and says why when the link, the key or the budget fails', () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const unreachable = Sources.of({
				extract: () => Effect.fail(NotesError.make({message: 'The link could not be loaded.'})),
				frames: () => Effect.succeed([]),
				image: () => Effect.die('No preview without a page'),
				transcript: recipe.transcript
			})
			const cases = [
				{
					issue: 'AI tagging failed; the note is saved as it is.',
					organizer: Organizer.of({
						enabled: true,
						organize: () => Effect.fail(NotesError.make({message: 'AI tagging failed; the note is saved as it is.'}))
					}),
					sources: unreachable,
					spent: 0,
					text: 'Remember this https://example.com/a'
				},
				{
					issue: 'The AI answer was unreadable.',
					organizer: Organizer.of({
						enabled: true,
						organize: () =>
							Effect.succeed({
								cost: 0.2,
								organization: Result.fail(NotesError.make({message: 'The AI answer was unreadable.'}))
							})
					}),
					sources: recipe,
					spent: 0.2,
					text: 'https://example.com/a'
				},
				{
					issue: 'The link could not be loaded.',
					organizer: Organizer.of({enabled: true, organize: () => Effect.die('AI must not run without content')}),
					sources: unreachable,
					spent: 0,
					text: 'https://example.com/a'
				},
				{
					issue: 'Not tagged: the server has no OpenRouter key.',
					organizer: Organizer.of({enabled: false, organize: () => Effect.die('AI must not run without a key')}),
					sources: recipe,
					spent: 0,
					text: 'https://example.com/a'
				},
				{
					budget: '0',
					issue: "Not tagged: this month's AI budget is used up.",
					organizer: Organizer.of({enabled: true, organize: () => Effect.die('AI must not run over budget')}),
					sources: recipe,
					spent: 0,
					text: 'https://example.com/a'
				}
			]
			for (const entry of cases) {
				const notes = yield* open({...entry, directory: yield* fs.makeTempDirectoryScoped()})
				yield* notes.capture({id: ids[0], text: entry.text})
				const state = yield* settled(notes, current => Array.some(current.notes, note => note.status === 'saved'))
				assert.containsSubset(state.notes[0], {issue: entry.issue, tags: [], text: entry.text})
				assert.strictEqual(state.aiSpend.usd, entry.spent)
			}
		})
	)

	test.effect('lets only one capture spend the last of the monthly budget', () =>
		Effect.gen(function* () {
			const calls = yield* Ref.make(0)
			const notes = yield* open({
				budget: '0.0004',
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: Organizer.of({
					enabled: true,
					organize: input => Effect.andThen(Effect.yieldNow, counting(calls).organize(input))
				}),
				sources: recipe
			})
			yield* Effect.all(
				[
					notes.capture({id: ids[0], text: 'https://example.com/one'}),
					notes.capture({id: ids[1], text: 'https://example.com/two'})
				],
				{concurrency: 'unbounded'}
			)
			const state = yield* settled(
				notes,
				current => Array.every(current.notes, note => note.status !== 'organizing') && current.notes.length === 2
			)
			assert.strictEqual(yield* Ref.get(calls), 1)
			assert.strictEqual(state.aiSpend.usd, 0.0004)
			assert.deepStrictEqual(
				Array.sort(
					Array.map(state.notes, note => note.status),
					Order.String
				),
				['ready', 'saved']
			)
		})
	)

	test.effect('keeps what a video says and tags the note with it', () =>
		Effect.gen(function* () {
			const seen = yield* Ref.make<Option.Option<string>>(Option.none())
			const calls = yield* Ref.make(0)
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: Organizer.of({
					enabled: true,
					organize: input =>
						Effect.andThen(Ref.set(seen, Option.fromNullishOr(input.note.transcript)), counting(calls).organize(input))
				}),
				sources: Sources.of({...recipe, transcript: () => Effect.succeedSome('[00:01] Soak the lentils overnight.\n')})
			})
			yield* notes.capture({id: ids[0], text: 'https://www.tiktok.com/@cook/video/1'})
			assert.containsSubset(
				(yield* settled(notes, current => Array.some(current.notes, note => note.status === 'ready'))).notes[0],
				{transcript: '[00:01] Soak the lentils overnight.\n'}
			)
			assert.deepStrictEqual(yield* Ref.get(seen), Option.some('[00:01] Soak the lentils overnight.\n'))
		})
	)

	test.effect('shows the AI stills of a video', () =>
		Effect.gen(function* () {
			const seen = yield* Ref.make<string[]>([])
			const calls = yield* Ref.make(0)
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: Organizer.of({
					enabled: true,
					organize: input => Effect.andThen(Ref.set(seen, input.frames), counting(calls).organize(input))
				}),
				sources: Sources.of({...recipe, frames: () => Effect.succeed(['data:image/jpeg;base64,AAAA'])})
			})
			yield* notes.capture({id: ids[0], text: 'https://www.tiktok.com/@cook/video/1'})
			yield* settled(notes, current => Array.some(current.notes, note => note.status === 'ready'))
			assert.deepStrictEqual(yield* Ref.get(seen), ['data:image/jpeg;base64,AAAA'])
		})
	)

	test.effect('tags a bare video link whose only words are its transcript', () =>
		Effect.gen(function* () {
			const calls = yield* Ref.make(0)
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: counting(calls),
				sources: Sources.of({
					extract: link => Effect.map(recipe.extract(link), extraction => ({...extraction, text: ''})),
					frames: recipe.frames,
					image: recipe.image,
					transcript: () => Effect.succeedSome('[00:01] Soak the lentils overnight.\n')
				})
			})
			yield* notes.capture({id: ids[0], text: 'https://www.tiktok.com/@cook/video/1'})
			yield* settled(notes, current => Array.some(current.notes, note => note.status === 'ready'))
			assert.strictEqual(yield* Ref.get(calls), 1)
		})
	)

	test.effect('joins a new short link to the saved post it leads to, without another AI call', () =>
		Effect.gen(function* () {
			const calls = yield* Ref.make(0)
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: counting(calls),
				// TikTok makes a new short link for every share; both lead to the same video.
				sources: Sources.of({
					extract: () =>
						Effect.map(recipe.extract(''), extraction => ({
							...extraction,
							url: 'https://www.tiktok.com/@cook/video/1'
						})),
					frames: recipe.frames,
					image: recipe.image,
					transcript: recipe.transcript
				})
			})
			yield* notes.capture({id: ids[0], text: 'https://vm.tiktok.com/AAA/'})
			yield* settled(notes, current => Array.some(current.notes, note => note.status === 'ready'))
			yield* notes.capture({id: ids[1], text: 'Make it tonight https://vm.tiktok.com/BBB/'})
			const state = yield* settled(
				notes,
				current => current.notes.length === 1 && String.endsWith('tonight')(current.notes[0]?.text ?? '')
			)
			assert.containsSubset(state.notes[0], {
				id: ids[0],
				status: 'ready',
				text: 'https://vm.tiktok.com/AAA/\nMake it tonight',
				url: 'https://www.tiktok.com/@cook/video/1'
			})
			assert.strictEqual(yield* Ref.get(calls), 1)
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
						organizer: Organizer.of({enabled: true, organize: () => Effect.andThen(tagging.open, Effect.never)}),
						sources: recipe
					})
					yield* notes.capture({id: ids[0], text: 'https://example.com/soup'})
					yield* tagging.await
				})
			)
			const calls = yield* Ref.make(0)
			// The link is down after the restart, so the run goes on with what the first read fetched.
			const down = Sources.of({
				extract: () => Effect.fail(NotesError.make({message: 'The link could not be loaded.'})),
				frames: recipe.frames,
				image: recipe.image,
				transcript: recipe.transcript
			})
			const state = yield* settled(yield* open({directory, organizer: counting(calls), sources: down}), current =>
				Array.some(current.notes, note => note.status === 'ready')
			)
			assert.containsSubset(state.notes[0], {
				author: 'Cookbook',
				content: 'Lentils with cumin and tomato.',
				id: ids[0],
				issue: '',
				title: 'Soup'
			})
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
				organizer: Organizer.of({enabled: false, organize: () => Effect.die('unused')}),
				sources: Sources.of({
					extract: recipe.extract,
					frames: recipe.frames,
					image: link => Effect.andThen(Effect.andThen(downloading.open, release.await), recipe.image(link)),
					transcript: recipe.transcript
				})
			})
			yield* notes.capture({id: ids[0], text: 'https://example.com/soup'})
			yield* downloading.await
			yield* notes.remove({id: ids[0]})
			yield* release.open
			yield* settled(notes, current => Array.isReadonlyArrayEmpty(current.notes))
			// The run writes the file, if at all, right after the download; real time lets that file write finish.
			yield* TestClock.withLive(Effect.sleep('100 millis'))
			assert.isFalse(yield* fs.exists(`${directory}/images/${ids[0]}`))
		})
	)

	test.effect('keeps words shared while the link loads, and removes a note with its preview', () =>
		Effect.gen(function* () {
			const release = yield* Latch.make()
			const notes = yield* open({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				organizer: Organizer.of({enabled: false, organize: () => Effect.die('unused')}),
				sources: Sources.of({
					extract: () => Effect.andThen(release.await, recipe.extract('')),
					frames: recipe.frames,
					image: recipe.image,
					transcript: recipe.transcript
				})
			})
			yield* notes.capture({id: ids[0], text: 'https://example.com/slow'})
			// Words shared again while the link loads survive the read that finishes afterwards.
			yield* notes.capture({id: ids[1], text: 'Read later https://example.com/slow'})
			yield* release.open
			assert.containsSubset(
				(yield* settled(notes, current => Array.some(current.notes, note => note.status === 'saved'))).notes[0],
				{image: 'image/jpeg', text: 'https://example.com/slow\nRead later'}
			)
			yield* notes.remove({id: ids[0]})
			assert.deepStrictEqual((yield* settled(notes, () => true)).notes, [])
			assert.strictEqual((yield* Effect.flip(notes.image(ids[0]))).message, 'This note has no preview image.')
		})
	)
})
