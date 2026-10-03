import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	ConfigProvider,
	Context,
	Deferred,
	Effect,
	Fiber,
	FileSystem,
	Layer,
	Option,
	Ref,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {Sources} from '#services/notes/internal/extraction.ts'
import {Organizer} from '#services/notes/internal/organization.ts'
import {NotesError, NotesState} from '#services/notes/schema.ts'
import {Notes} from '#services/notes/service.ts'

const extracted = Sources.of({extract: () => Effect.succeed('A recipe with lentils, tomatoes and cumin.')})
const organized = {
	summary: 'Cook lentils with tomatoes and cumin.',
	tags: ['cooking', 'lentils'],
	title: 'Lentil recipe'
}
const unavailable = Sources.of({extract: () => NotesError.make({message: 'Source unavailable'})})

const open = Effect.fnUntraced(function* (
	directory: string,
	sources: typeof Sources.Service,
	organizer: typeof Organizer.Service
) {
	const context = yield* Layer.build(
		pipe(
			Notes.layer,
			Layer.provide(Layer.succeed(Sources, sources)),
			Layer.provide(Layer.succeed(Organizer, organizer)),
			Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({HOME: directory, NOTES_DATA_DIR: directory})))
		)
	)
	return Context.get(context, Notes)
})
const snapshot = Effect.fnUntraced(function* (notes: typeof Notes.Service) {
	return pipe(yield* Stream.runHead(notes.changes), Option.getOrThrow)
})
const stored = Effect.fnUntraced(function* (directory: string) {
	const fs = yield* FileSystem.FileSystem
	return yield* pipe(
		fs.readFileString(`${directory}/notes.json`),
		Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(NotesState)))
	)
})

it.layer(NodeServices.layer)('Notes', test => {
	test.effect(
		'persists originals before dependencies; failures and edits survive restart without extra model calls',
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem
				const directory = yield* fs.makeTempDirectoryScoped()
				const calls = yield* Ref.make(0)
				const observed = yield* Ref.make(Option.none<NotesState>())
				const failed = Organizer.of({
					enabled: true,
					organize: Effect.fnUntraced(function* () {
						yield* Ref.update(calls, count => count + 1)
						const disk = yield* pipe(
							fs.readFileString(`${directory}/notes.json`),
							Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(NotesState))),
							Effect.orDie
						)
						yield* Ref.set(observed, Option.some(disk))
						return yield* NotesError.make({message: 'Expired key'})
					})
				})
				const id = yield* Effect.scoped(
					Effect.gen(function* () {
						const notes = yield* open(directory, unavailable, failed)
						const link = yield* notes.capture({text: 'https://example.com/unavailable'})
						assert.strictEqual(link.status, 'saved')
						assert.deepStrictEqual(link.tags, [])
						assert.strictEqual(yield* Ref.get(calls), 0)
						const note = yield* notes.capture({text: 'My lentil recipe https://example.com/recipe'})
						const beforeModel = pipe(yield* Ref.get(observed), Option.getOrThrow)
						assert.strictEqual(beforeModel.notes[0]?.raw, 'My lentil recipe https://example.com/recipe')
						assert.strictEqual(beforeModel.aiReserved, 0.005)
						assert.strictEqual(note.status, 'saved')
						assert.isTrue(String.isNonEmpty(note.issue))
						yield* notes.edit({id: note.id, tags: ['recipe'], title: 'My recipe'})
						yield* notes.capture({text: ' My lentil recipe https://example.com/recipe '})
						assert.strictEqual(yield* Ref.get(calls), 1)
						return note.id
					})
				)
				yield* Effect.scoped(
					Effect.gen(function* () {
						const notes = yield* open(directory, extracted, failed)
						const state = yield* snapshot(notes)
						assert.containsSubset(state.notes, [
							{id, raw: 'My lentil recipe https://example.com/recipe', tags: ['recipe'], title: 'My recipe'}
						])
						assert.strictEqual(state.aiReserved, 0.005)
						yield* notes.remove({id})
						assert.isFalse(Array.some((yield* snapshot(notes)).notes, note => note.id === id))
						assert.strictEqual(yield* Ref.get(calls), 1)
					})
				)
			})
	)

	test.effect('reports failed recovery writes and restores editability after storage is repaired', () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			const sources = Sources.of({
				extract: Effect.fnUntraced(function* () {
					yield* pipe(
						fs.makeDirectory(`${directory}/notes.json.tmp`),
						Effect.mapError(cause => NotesError.make({cause, message: 'Test source setup failed'}))
					)
					return 'Visible source text'
				})
			})
			const notes = yield* open(
				directory,
				sources,
				Organizer.of({enabled: true, organize: () => Effect.die('AI must not run after a failed content write')})
			)
			const failure = yield* Effect.flip(notes.capture({text: 'https://example.com/storage'}))
			assert.strictEqual(failure._tag, 'NotesError')
			const original = yield* stored(directory)
			assert.containsSubset(original.notes, [{raw: 'https://example.com/storage'}])
			assert.strictEqual(original.aiReserved, 0)
			yield* fs.remove(`${directory}/notes.json.tmp`, {recursive: true})
			const recovered = yield* notes.capture({text: 'https://example.com/storage'})
			assert.strictEqual(recovered.status, 'saved')
			yield* notes.edit({id: recovered.id, tags: ['recovered'], title: 'Recovered note'})
			assert.containsSubset((yield* stored(directory)).notes, [
				{id: recovered.id, status: 'saved', title: 'Recovered note'}
			])
		})
	)

	test.effect('canonical duplicates share one organization; distinct article query remains distinct', () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			const entered = yield* Deferred.make<string>()
			const release = yield* Deferred.make<boolean>()
			const calls = yield* Ref.make(0)
			const organizer = Organizer.of({
				enabled: true,
				organize: Effect.fnUntraced(function* (content) {
					yield* Ref.update(calls, count => count + 1)
					yield* Deferred.succeed(entered, content)
					yield* Deferred.await(release)
					return organized
				})
			})
			const notes = yield* open(directory, extracted, organizer)
			const first = yield* Effect.forkScoped(
				notes.capture({text: 'https://twitter.com/person/status/123?utm_source=a'})
			)
			yield* Deferred.await(entered)
			const second = yield* Effect.forkScoped(notes.capture({text: 'https://x.com/person/status/123?utm_source=b'}))
			yield* Deferred.succeed(release, true)
			const original = yield* Fiber.join(first)
			const duplicate = yield* Fiber.join(second)
			assert.strictEqual(original.id, duplicate.id)
			assert.strictEqual(yield* Ref.get(calls), 1)
			const one = yield* notes.capture({text: 'https://example.com/article?id=1&utm_source=x'})
			const again = yield* notes.capture({text: 'https://example.com/article?utm_source=y&id=1'})
			const other = yield* notes.capture({text: 'https://example.com/article?id=2'})
			assert.strictEqual(one.id, again.id)
			assert.notStrictEqual(one.id, other.id)
			assert.strictEqual(yield* Ref.get(calls), 3)
			const text = yield* notes.capture({text: '  A plain text recipe  '})
			const sameText = yield* notes.capture({text: 'A plain text recipe'})
			assert.strictEqual(text.id, sameText.id)
			assert.strictEqual(yield* Ref.get(calls), 4)
			const extra = yield* notes.capture({text: 'Add smoked paprika https://x.com/person/status/123'})
			assert.strictEqual(extra.id, original.id)
			assert.include(extra.content, 'Add smoked paprika')
			assert.include(extra.raw, 'https://twitter.com/person/status/123?utm_source=a')
			assert.include(extra.raw, 'Add smoked paprika https://x.com/person/status/123')
			const moreLinks = yield* notes.capture({text: 'https://x.com/person/status/123 https://example.com/second'})
			assert.include(moreLinks.raw, 'https://example.com/second')
			const repeated = yield* notes.capture({text: 'https://x.com/person/status/123 https://example.com/second'})
			assert.strictEqual(repeated.raw, moreLinks.raw)
			assert.strictEqual(yield* Ref.get(calls), 4)
		})
	)

	test.effect('charges failed requests once, enforces the persistent budget and caps input content', () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			const calls = yield* Ref.make(0)
			const lengths = yield* Ref.make(Array.empty<number>())
			const organizer = Organizer.of({
				enabled: true,
				organize: Effect.fnUntraced(function* (content) {
					yield* Ref.update(calls, count => count + 1)
					yield* Ref.update(lengths, Array.append(String.length(content)))
					return yield* NotesError.make({message: 'Model unavailable'})
				})
			})
			yield* Effect.scoped(
				Effect.gen(function* () {
					const notes = yield* open(directory, extracted, organizer)
					yield* notes.capture({text: String.repeat(15000)('a')})
					yield* Effect.forEach(Array.range(1, 50), index => notes.capture({text: `Recipe ${index}`}), {discard: true})
					const state = yield* snapshot(notes)
					assert.strictEqual(state.notes.length, 51)
					assert.isTrue(Array.every(yield* Ref.get(lengths), length => length <= 10000))
					assert.strictEqual(state.aiReserved, 0.25)
					assert.strictEqual(yield* Ref.get(calls), 50)
					assert.isTrue(Array.every(state.notes, note => note.status === 'saved' && note.raw !== ''))
				})
			)
			yield* Effect.scoped(
				Effect.gen(function* () {
					const notes = yield* open(directory, extracted, organizer)
					const note = yield* notes.capture({text: 'One more recipe after restart'})
					assert.strictEqual(note.status, 'saved')
					assert.strictEqual((yield* stored(directory)).aiReserved, 0.25)
					assert.strictEqual(yield* Ref.get(calls), 50)
				})
			)
		})
	)

	test.effect('rejects edits while organizing and never resurrects a note deleted during extraction or AI', () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			const extractionEntered = yield* Deferred.make<string>()
			const extractionRelease = yield* Deferred.make<boolean>()
			const aiEntered = yield* Deferred.make<string>()
			const aiRelease = yield* Deferred.make<boolean>()
			const calls = yield* Ref.make(0)
			const sources = Sources.of({
				extract: Effect.fnUntraced(function* (url) {
					yield* Deferred.succeed(extractionEntered, url)
					yield* Deferred.await(extractionRelease)
					return 'Lentil recipe'
				})
			})
			const organizer = Organizer.of({
				enabled: true,
				organize: Effect.fnUntraced(function* (content) {
					yield* Ref.update(calls, count => count + 1)
					yield* Deferred.succeed(aiEntered, content)
					yield* Deferred.await(aiRelease)
					return organized
				})
			})
			const notes = yield* open(directory, sources, organizer)
			const capture = yield* Effect.forkScoped(notes.capture({text: 'https://example.com/deleted'}))
			yield* Deferred.await(extractionEntered)
			const pending = pipe(Array.head((yield* snapshot(notes)).notes), Option.getOrThrow)
			assert.strictEqual(pending.status, 'organizing')
			assert.containsSubset((yield* stored(directory)).notes, [
				{id: pending.id, raw: 'https://example.com/deleted', status: 'organizing'}
			])
			const error = yield* Effect.flip(notes.edit({id: pending.id, tags: [], title: 'Changed'}))
			assert.strictEqual(error._tag, 'NotesError')
			yield* notes.remove({id: pending.id})
			yield* Deferred.succeed(extractionRelease, true)
			yield* Fiber.join(capture)
			assert.deepStrictEqual((yield* snapshot(notes)).notes, [])
			assert.strictEqual(yield* Ref.get(calls), 0)
			const next = yield* Effect.forkScoped(notes.capture({text: 'Plain text recipe'}))
			yield* Deferred.await(aiEntered)
			const duringAi = pipe(Array.head((yield* snapshot(notes)).notes), Option.getOrThrow)
			yield* notes.remove({id: duringAi.id})
			yield* Deferred.succeed(aiRelease, true)
			yield* Fiber.join(next)
			assert.deepStrictEqual((yield* stored(directory)).notes, [])
			assert.strictEqual(yield* Ref.get(calls), 1)
		})
	)

	test.effect('a disconnected caller does not interrupt accepted organization', () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			const entered = yield* Deferred.make<string>()
			const release = yield* Deferred.make<boolean>()
			const organizer = Organizer.of({
				enabled: true,
				organize: Effect.fnUntraced(function* (content) {
					yield* Deferred.succeed(entered, content)
					yield* Deferred.await(release)
					return organized
				})
			})
			const notes = yield* open(directory, extracted, organizer)
			const caller = yield* Effect.forkScoped(notes.capture({text: 'My lentil recipe'}))
			yield* Deferred.await(entered)
			yield* Fiber.interrupt(caller)
			const ready = yield* Effect.forkScoped(
				pipe(
					notes.changes,
					Stream.filter(state => Array.some(state.notes, note => note.status === 'ready')),
					Stream.runHead
				)
			)
			yield* Deferred.succeed(release, true)
			const state = pipe(yield* Fiber.join(ready), Option.getOrThrow)
			assert.containsSubset(state.notes, [{raw: 'My lentil recipe', status: 'ready', tags: ['cooking', 'lentils']}])
			assert.deepStrictEqual((yield* stored(directory)).notes, state.notes)
		})
	)

	test.effect('startup recovers interrupted organization and refuses to overwrite corrupt storage', () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			const entered = yield* Deferred.make<string>()
			const blocked = Organizer.of({
				enabled: true,
				organize: Effect.fnUntraced(function* (content) {
					yield* Deferred.succeed(entered, content)
					return yield* Effect.never
				})
			})
			yield* Effect.scoped(
				Effect.gen(function* () {
					const notes = yield* open(directory, extracted, blocked)
					yield* Effect.forkScoped(notes.capture({text: 'Interrupted recipe'}))
					yield* Deferred.await(entered)
				})
			)
			assert.strictEqual((yield* stored(directory)).notes[0]?.status, 'organizing')
			yield* Effect.scoped(
				Effect.gen(function* () {
					const notes = yield* open(directory, extracted, blocked)
					const state = yield* snapshot(notes)
					assert.containsSubset(state.notes, [{raw: 'Interrupted recipe', status: 'saved'}])
					assert.isTrue(String.isNonEmpty(state.notes[0]?.issue ?? ''))
					assert.strictEqual(state.aiReserved, 0.005)
				})
			)
			yield* fs.writeFileString(`${directory}/notes.json`, '{broken')
			const error = yield* Effect.flip(Effect.scoped(open(directory, extracted, blocked)))
			assert.strictEqual(error._tag, 'NotesError')
			assert.strictEqual(yield* fs.readFileString(`${directory}/notes.json`), '{broken')
		})
	)

	test.effect('unsafe source URLs stay link-only without model calls; missing AI still saves pasted text', () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			const calls = yield* Ref.make(0)
			const organizer = Organizer.of({
				enabled: true,
				organize: () =>
					pipe(
						Ref.update(calls, count => count + 1),
						Effect.as(organized)
					)
			})
			const sources = Context.get(yield* Layer.build(Sources.layer), Sources)
			const notes = yield* open(directory, sources, organizer)
			for (const text of [
				'https://127.0.0.1/',
				'https://[::1]/',
				'https://100.100.100.100/',
				'https://metadata.google.internal/',
				'https://host.example.ts.net/',
				'https://user:password@example.com/',
				' https://user:password@x.com/person/status/20',
				'https://www.tiktok.com:8443/@person/video/123',
				'https://example.com:8443/',
				'http://example.com/'
			]) {
				const note = yield* notes.capture({text})
				assert.strictEqual(note.status, 'saved')
				assert.deepStrictEqual(note.tags, [])
				assert.strictEqual(note.raw, String.trim(text))
			}
			assert.strictEqual(yield* Ref.get(calls), 0)
			const other = yield* fs.makeTempDirectoryScoped()
			const missing = yield* open(
				other,
				unavailable,
				Organizer.of({enabled: false, organize: () => Effect.die('Must not call AI')})
			)
			const note = yield* missing.capture({text: 'My recipe https://example.com/unavailable'})
			assert.strictEqual(note.content, 'My recipe')
			assert.strictEqual(note.status, 'saved')
			assert.strictEqual((yield* snapshot(missing)).aiReserved, 0)
		})
	)
})
