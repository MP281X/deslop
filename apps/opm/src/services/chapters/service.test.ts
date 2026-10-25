import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Boolean, Context, Effect, FileSystem, Layer, Option, Ref, Stream, String, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import {TestClock} from 'effect/testing'

import {openStore} from '#services/chapters/lib/store.ts'
import {keyOf, resumeOf} from '#services/chapters/lib/utils.ts'
import {Chapter, Series} from '#services/chapters/schema.ts'
import {Chapters} from '#services/chapters/service.ts'

it.layer(NodeServices.layer)(test => {
	test.effect('keeps the previous release’s manga progress when loading the shared archive', () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			yield* fs.writeFileString(
				`${directory}/chapters`,
				'[{"notified":true,"number":1,"pages":["https://example.test/page.png"],"postedAt":0,"reading":{"at":42,"done":false,"page":0},"source":"","title":""}]'
			)
			const store = yield* openStore(directory)
			const loaded = yield* store.load
			const chapter = yield* Effect.fromOption(Array.head(loaded))
			assert.strictEqual(chapter.series, 'manga')
			assert.deepStrictEqual(chapter.reading, {at: 42, done: false, page: 0})
			yield* store.save(Array.copy(loaded))
			assert.deepStrictEqual(yield* (yield* openStore(directory)).load, loaded)
		})
	)

	test.effect('backfills the webcomic beside existing manga and scopes releases, revisions and reading by series', () =>
		Effect.gen(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const store = yield* openStore(directory)
			yield* store.save([
				Chapter.make({
					notified: true,
					number: 1,
					pages: ['https://example.test/manga.png'],
					postedAt: 0,
					series: 'manga',
					source: 'https://cubari.moe/read/gist/OPM/1/1/',
					title: ''
				})
			])
			const revised = yield* Ref.make(false)
			const client = HttpClient.make(request =>
				Effect.gen(function* () {
					if (String.includes('search.rss')(request.url)) {
						const entries = [
							{slug: 'manga', title: 'Chapter 2 [English]'},
							{slug: 'webcomic', title: '[Webcomic] Chapter 2 [English]'},
							{slug: 'broken', title: '[Webcomic] Chapter 3 [English]'},
							...Boolean.match(yield* Ref.get(revised), {
								onFalse: () => [],
								onTrue: () => [{slug: 'revision', title: '[Webcomic] [Revised] Chapter 1 [English]'}]
							})
						]
						return HttpClientResponse.fromWeb(
							request,
							new Response(
								`<feed>${Array.join(
									Array.map(
										entries,
										entry =>
											`<entry><title>${entry.title}</title><published>2026-04-06T00:00:00Z</published><content>&lt;a href="https://cubari.moe/read/imgchest/${entry.slug}/1/1/"&gt;Read&lt;/a&gt;</content></entry>`
									),
									''
								)}</feed>`
							)
						)
					}
					if (String.endsWith('/gist/series/JYHJU/')(request.url)) {
						return HttpClientResponse.fromWeb(
							request,
							Response.json({
								chapters: {
									'001': {
										groups: {english: ['https://example.test/webcomic.png']},
										release_date: {english: 123},
										title: 'Chapter 001'
									},
									'003': {groups: {english: [`https://services.f-ck.me/v1/image/${btoa('Invalid uploader')}`]}}
								}
							})
						)
					}
					return HttpClientResponse.fromWeb(
						request,
						Response.json({
							chapters: {
								'1': {
									groups: {
										english: Boolean.match(String.includes('/broken/')(request.url), {
											onFalse: () => [`https://example.test${new URL(request.url).pathname}page.png`],
											onTrue: () => []
										})
									}
								}
							}
						})
					)
				})
			)
			const chapters = Context.get(
				yield* Layer.build(
					pipe(Chapters.layer(directory), Layer.provide(Layer.succeed(HttpClient.HttpClient, client)))
				),
				Chapters
			)
			yield* pipe(
				chapters.changes,
				Stream.filter(event => Array.some(event.upserted, chapter => keyOf(chapter) === 'webcomic:2')),
				Stream.runHead
			)
			const first = (yield* Effect.fromOption(yield* Stream.runHead(chapters.changes))).upserted
			assert.deepStrictEqual(Array.map(first, keyOf), [
				'webcomic:158',
				'manga:2',
				'webcomic:2',
				'manga:1',
				'webcomic:1'
			])
			assert.deepStrictEqual(
				Option.map(Array.last(first), chapter => chapter.postedAt),
				Option.some(0)
			)
			yield* chapters.read({done: true, number: 1, opened: true, page: 0, series: 'manga'})
			yield* chapters.read({done: false, number: 1, opened: true, page: 0, series: 'webcomic'})
			yield* Ref.set(revised, true)
			yield* chapters.sync
			const saved = yield* store.load
			assert.deepStrictEqual(
				Array.map(
					Array.filter(saved, chapter => chapter.number === 1),
					chapter => [chapter.series, chapter.reading?.done, chapter.pages]
				),
				[
					['manga', true, ['https://example.test/manga.png']],
					['webcomic', false, ['https://example.test/read/api/imgchest/series/revision/page.png']]
				]
			)
			assert.isTrue(Array.every(saved, chapter => chapter.notified))
		})
	)

	test.effect('persists shared reading and concurrent device changes without treating list marks as visits', () =>
		Effect.gen(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const first = 'ExpoPushToken[device00000001]'
			const second = 'ExpoPushToken[device00000002]'
			yield* Effect.scoped(
				Effect.gen(function* () {
					const store = yield* openStore(directory)
					yield* store.save(
						Array.flatMap(Series.literals, series =>
							Array.map([1, 2], number =>
								Chapter.make({
									notified: true,
									number,
									pages: ['https://example.test/page.png'],
									postedAt: 0,
									series,
									source: '',
									title: ''
								})
							)
						)
					)
					yield* store.addDevice(first)
					yield* Effect.all([store.removeDevice(first), store.addDevice(second)], {concurrency: 'unbounded'})
					const chapters = Context.get(
						yield* Layer.build(
							pipe(
								Chapters.layer(directory),
								Layer.provide(
									Layer.succeed(
										HttpClient.HttpClient,
										HttpClient.make(() => Effect.never)
									)
								)
							)
						),
						Chapters
					)
					yield* chapters.read({done: true, number: 2, opened: false, page: 0, series: 'manga'})
					assert.deepStrictEqual(
						resumeOf((yield* Effect.fromOption(yield* Stream.runHead(chapters.changes))).upserted),
						Option.none()
					)
					yield* TestClock.adjust('1 second')
					yield* chapters.read({done: true, number: 1, opened: true, page: 0, series: 'manga'})
					yield* chapters.read({done: false, number: 2, opened: false, page: 0, series: 'manga'})
					yield* TestClock.adjust('1 second')
					yield* chapters.read({done: false, number: 1, opened: true, page: 0, series: 'webcomic'})
				})
			)
			const store = yield* openStore(directory)
			assert.deepStrictEqual(resumeOf(yield* store.load), Option.some({number: 1, page: 0}))
			assert.deepStrictEqual(
				Array.map(yield* store.load, chapter => [keyOf(chapter), chapter.reading?.done]),
				[
					['manga:2', false],
					['webcomic:2', undefined],
					['manga:1', true],
					['webcomic:1', false]
				]
			)
			assert.deepStrictEqual(yield* store.devices, [second])
		})
	)
})
