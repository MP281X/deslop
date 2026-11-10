import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Boolean,
	Clock,
	ConfigProvider,
	Context,
	Effect,
	Fiber,
	FileSystem,
	Layer,
	Logger,
	MutableRef,
	Option,
	Predicate,
	Queue,
	Random,
	Record,
	Ref,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {Base64Url} from 'effect/encoding'
import {HttpClient, HttpClientResponse} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'
import {TestClock} from 'effect/testing'

import {layerKeyValueStore} from '@deslop/runtime/server'

import {openStore} from '#services/chapters/lib/store.ts'
import {INDEXES, byNumber, keyOf} from '#services/chapters/lib/utils.ts'
import {Chapter, Series} from '#services/chapters/schema.ts'
import {Chapters} from '#services/chapters/service.ts'

function chapterAt(series: Series, number: number) {
	return Chapter.make({
		notified: true,
		number,
		pages: [`https://example.test/${series}-${number}.png`],
		postedAt: 0,
		series,
		source: `https://cubari.moe/read/gist/${INDEXES[series]}/${number}/1/`,
		title: ''
	})
}

function index(links: Record<string, string>) {
	return Response.json({chapters: Record.map(links, link => ({groups: {english: [link]}}))})
}

function warningLayer(queue: Queue.Queue<void>, prefix: string) {
	return Logger.layer([
		Logger.make(options => {
			for (const message of Option.getOrElse(
				Schema.decodeUnknownOption(Schema.Array(Schema.Unknown))(options.message),
				() => []
			)) {
				if (Predicate.isString(message) && String.startsWith(prefix)(message)) {
					Queue.offerUnsafe(queue, undefined)
				}
			}
		})
	])
}

it.layer(NodeServices.layer)(test => {
	test.effect(
		'keeps a chapter in the outbox until Expo returns exactly one ticket per device',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const store = yield* Effect.provideContext(openStore(), yield* Layer.build(layerKeyValueStore(directory)))
			yield* store.save([
				Chapter.make({
					notified: false,
					number: 1,
					pages: ['https://example.test/page.png'],
					postedAt: 0,
					series: 'manga',
					source: '',
					title: ''
				})
			])
			yield* store.addDevice('ExpoPushToken[device00000001]')
			yield* store.addDevice('ExpoPushToken[device00000002]')
			const count = yield* Ref.make(0)
			const rounds = yield* Queue.unbounded<void>()
			yield* Layer.build(
				pipe(
					Chapters.layer,
					Layer.provide(layerKeyValueStore(directory)),
					Layer.provide(
						Layer.succeed(
							HttpClient.HttpClient,
							HttpClient.make(request =>
								Effect.gen(function* () {
									if (request.url === 'https://exp.host/--/api/v2/push/send') {
										return HttpClientResponse.fromWeb(
											request,
											Response.json({data: Array.makeBy(yield* Ref.get(count), () => ({status: 'ok'}))})
										)
									}
									return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 404}))
								})
							)
						)
					),
					Layer.provide(
						Logger.layer([
							Logger.make(options => {
								for (const message of Option.getOrElse(
									Schema.decodeUnknownOption(Schema.Array(Schema.Unknown))(options.message),
									() => []
								)) {
									if (
										message === 'Chapter manga:1 was not announced yet' ||
										message === 'Announced chapter manga:1 to 2 iPhones'
									) {
										Queue.offerUnsafe(rounds, undefined)
									}
								}
							})
						])
					)
				)
			)
			for (const received of [0, 1, 3, 2]) {
				yield* Ref.set(count, received)
				if (received !== 0) yield* TestClock.adjust('6 hours')
				yield* Queue.take(rounds)
				assert.strictEqual((yield* store.load)[0]?.notified, received === 2)
			}
		})
	)

	test.effect(
		'backfills the webcomic beside existing manga and scopes releases, revisions and reading by series',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const store = yield* Effect.provideContext(openStore(), yield* Layer.build(layerKeyValueStore(directory)))
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
			const broken = yield* Ref.make(0)
			const brokenRequests = yield* Queue.unbounded<void>()
			const client = HttpClient.make(request =>
				Effect.gen(function* () {
					// r/OPMFolk alone posts some releases, numbered its own way and listing several translations.
					if (String.includes('/r/OPMFolk/search.rss')(request.url)) {
						return HttpClientResponse.fromWeb(
							request,
							new Response(
								`<feed><entry><title>Chapter 3/48 [Translations]</title><published>2026-04-06T00:00:00Z</published><content>&lt;a href="https://cubari.moe/read/imgchest/broken/1/1/"&gt;Best&lt;/a&gt; &lt;a href="https://cubari.moe/read/imgchest/folk/1/1/"&gt;Alternative&lt;/a&gt;</content></entry></feed>`
							)
						)
					}
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
									'003': {
										groups: {english: [`https://services.f-ck.me/v1/image/${Base64Url.encode('Invalid uploader')}`]}
									}
								}
							})
						)
					}
					if (String.includes('/imgchest/series/broken/')(request.url)) {
						yield* Ref.update(broken, count => count + 1)
						yield* Queue.offer(brokenRequests, undefined)
						return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 404}))
					}
					return HttpClientResponse.fromWeb(
						request,
						Response.json({
							chapters: {'1': {groups: {english: [`https://example.test${new URL(request.url).pathname}page.png`]}}}
						})
					)
				})
			)
			const chapters = Context.get(
				yield* Layer.build(
					pipe(
						Chapters.layer,
						Layer.provide(layerKeyValueStore(directory)),
						Layer.provide(Layer.succeed(HttpClient.HttpClient, client))
					)
				),
				Chapters
			)
			const loaded = yield* pipe(
				chapters.changes,
				Stream.filter(event => Array.some(event.upserted, chapter => keyOf(chapter) === 'webcomic:2')),
				Stream.runHead,
				Effect.forkChild
			)
			yield* Queue.take(brokenRequests)
			yield* TestClock.adjust('8 seconds')
			yield* Fiber.join(loaded)
			assert.strictEqual(yield* Ref.get(broken), 2)
			const first = (yield* Effect.fromOption(yield* Stream.runHead(chapters.changes))).upserted
			assert.deepStrictEqual(Array.map(first, keyOf), [
				'manga:237',
				'manga:236',
				'manga:235',
				'manga:234',
				'manga:233',
				'webcomic:158',
				'manga:3',
				'manga:2',
				'webcomic:2',
				'manga:1',
				'webcomic:1'
			])
			assert.deepStrictEqual(
				Option.map(
					Array.findFirst(yield* store.load, chapter => keyOf(chapter) === 'manga:3'),
					chapter => chapter.source
				),
				Option.some('https://cubari.moe/read/imgchest/folk/1')
			)
			assert.deepStrictEqual(
				Option.map(Array.last(first), chapter => chapter.postedAt),
				Option.some(0)
			)
			// The next round's six-hour wait starts only once this round has announced its new chapters.
			// oxlint-disable-next-line @deslop/coding-standards/no-polling-test -- the round marks chapters announced through file writes that no event or service reports, so only the store shows it.
			yield* Effect.repeat(store.load, {until: saved => Array.every(saved, chapter => chapter.notified)})
			yield* chapters.read({done: true, number: 1, page: 0, series: 'manga'})
			yield* chapters.read({done: false, number: 1, page: 0, series: 'webcomic'})
			yield* Ref.set(revised, true)
			yield* TestClock.adjust('6 hours')
			yield* pipe(
				chapters.changes,
				Stream.filter(event =>
					Array.some(
						event.upserted,
						chapter => keyOf(chapter) === 'webcomic:1' && Array.some(chapter.pages, String.includes('/revision/'))
					)
				),
				Stream.runHead
			)
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

	test.effect(
		'fills a chapter gap from the community index on a later sync',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const store = yield* Effect.provideContext(openStore(), yield* Layer.build(layerKeyValueStore(directory)))
			yield* store.save([
				...Array.map([228, 233, 234, 235, 236, 237], number => chapterAt('manga', number)),
				chapterAt('webcomic', 158)
			])
			const later = yield* Ref.make(false)
			const reads = yield* Ref.make(0)
			const reported = yield* Queue.unbounded<void>()
			const client = HttpClient.make(request =>
				Effect.gen(function* () {
					if (String.endsWith('/gist/series/OPM/')(request.url)) {
						yield* Ref.update(reads, count => count + 1)
						const links = Boolean.match(yield* Ref.get(later), {
							onFalse: () => ({'228': 'https://example.test/228.png', '233': 'https://example.test/233.png'}),
							onTrue: () => ({
								'228': 'https://example.test/228.png',
								'229': 'https://example.test/229.png',
								'230': 'https://example.test/230.png',
								'233': 'https://example.test/233.png'
							})
						})
						return HttpClientResponse.fromWeb(request, index(links))
					}
					if (String.endsWith('/gist/series/JYHJU/')(request.url)) {
						return HttpClientResponse.fromWeb(request, index({'158': 'https://example.test/158.png'}))
					}
					if (String.includes('search.rss')(request.url)) {
						return HttpClientResponse.fromWeb(request, new Response('<feed></feed>'))
					}
					return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 404}))
				})
			)
			yield* Layer.build(
				pipe(
					Chapters.layer,
					Layer.provide(layerKeyValueStore(directory)),
					Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
					Layer.provide(warningLayer(reported, 'No readable source for'))
				)
			)
			yield* Queue.take(reported)
			assert.isFalse(Array.some(yield* store.load, item => item.number === 229))
			yield* Ref.set(later, true)
			yield* TestClock.adjust('6 hours')
			yield* Queue.take(reported)
			const saved = yield* store.load
			assert.deepStrictEqual(
				Array.map(
					Array.sort(
						Array.filter(saved, item => item.series === 'manga' && item.number >= 229 && item.number <= 230),
						byNumber
					),
					item => [item.number, item.pages]
				),
				[
					[229, ['https://example.test/229.png']],
					[230, ['https://example.test/230.png']]
				]
			)
			assert.isFalse(Array.some(saved, item => item.series === 'manga' && (item.number === 231 || item.number === 232)))
			assert.strictEqual(yield* Ref.get(reads), 2)
		})
	)

	test.effect(
		'fetches a dead reader link once across two syncs',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const store = yield* Effect.provideContext(openStore(), yield* Layer.build(layerKeyValueStore(directory)))
			yield* store.save([
				...Array.map([228, 233, 234, 235, 236, 237], number => chapterAt('manga', number)),
				chapterAt('webcomic', 158)
			])
			const fetches = yield* Ref.make(0)
			const reported = yield* Queue.unbounded<void>()
			const client = HttpClient.make(request =>
				Effect.gen(function* () {
					if (String.includes('/read/api/gist/series/dead/')(request.url)) {
						yield* Ref.update(fetches, count => count + 1)
						return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 404}))
					}
					if (String.endsWith('/gist/series/OPM/')(request.url)) {
						return HttpClientResponse.fromWeb(
							request,
							index({'228': 'https://example.test/228.png', '233': 'https://example.test/233.png'})
						)
					}
					if (String.endsWith('/gist/series/JYHJU/')(request.url)) {
						return HttpClientResponse.fromWeb(request, index({'158': 'https://example.test/158.png'}))
					}
					if (String.includes('/r/OnePunchMan/search.rss')(request.url)) {
						return HttpClientResponse.fromWeb(
							request,
							new Response(
								`<feed><entry><title>Chapter 229 [English]</title><published>1969-12-30T00:00:00Z</published><content>&lt;a href="https://cubari.moe/read/gist/dead/1/1/"&gt;Read&lt;/a&gt;</content></entry></feed>`
							)
						)
					}
					if (String.includes('search.rss')(request.url)) {
						return HttpClientResponse.fromWeb(request, new Response('<feed></feed>'))
					}
					return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 404}))
				})
			)
			yield* Layer.build(
				pipe(
					Chapters.layer,
					Layer.provide(layerKeyValueStore(directory)),
					Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
					Layer.provide(warningLayer(reported, 'No readable source for'))
				)
			)
			yield* Queue.take(reported)
			assert.strictEqual(yield* Ref.get(fetches), 1)
			yield* TestClock.adjust('6 hours')
			yield* Queue.take(reported)
			assert.strictEqual(yield* Ref.get(fetches), 1)
			assert.isFalse(Array.some(yield* store.load, item => keyOf(item) === 'manga:229'))
		})
	)

	test.effect(
		'fetches both subreddit feeds concurrently',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const starts = yield* Ref.make(Array.empty<number>())
			const arrivals = yield* Queue.unbounded<void>()
			const client = HttpClient.make(request =>
				Effect.gen(function* () {
					if (String.includes('/r/OnePunchMan/search.rss')(request.url)) {
						const started = yield* Clock.currentTimeMillis
						yield* Ref.update(starts, times => [...times, started])
						yield* Queue.offer(arrivals, undefined)
						yield* Effect.sleep('1 second')
						return HttpClientResponse.fromWeb(
							request,
							new Response(
								`<feed><entry><title>Chapter 100 [English]</title><published>1969-12-30T00:00:00Z</published><content>&lt;a href="https://cubari.moe/read/imgchest/first/1/1/"&gt;Read&lt;/a&gt;</content></entry></feed>`
							)
						)
					}
					if (String.includes('/r/OPMFolk/search.rss')(request.url)) {
						const started = yield* Clock.currentTimeMillis
						yield* Ref.update(starts, times => [...times, started])
						yield* Queue.offer(arrivals, undefined)
						yield* Effect.sleep('1 second')
						return HttpClientResponse.fromWeb(
							request,
							new Response(
								`<feed><entry><title>Chapter 101 [English]</title><published>1969-12-30T00:00:00Z</published><content>&lt;a href="https://cubari.moe/read/imgchest/second/1/1/"&gt;Read&lt;/a&gt;</content></entry></feed>`
							)
						)
					}
					if (
						String.endsWith('/gist/series/OPM/')(request.url) ||
						String.endsWith('/gist/series/JYHJU/')(request.url)
					) {
						return HttpClientResponse.fromWeb(request, index({'1': 'https://example.test/index.png'}))
					}
					return HttpClientResponse.fromWeb(
						request,
						Response.json({chapters: {'1': {groups: {english: ['https://example.test/page.png']}}}})
					)
				})
			)
			const chapters = Context.get(
				yield* Layer.build(
					pipe(
						Chapters.layer,
						Layer.provide(layerKeyValueStore(directory)),
						Layer.provide(Layer.succeed(HttpClient.HttpClient, client))
					)
				),
				Chapters
			)
			yield* Queue.take(arrivals)
			yield* Queue.take(arrivals)
			yield* TestClock.adjust('10 seconds')
			yield* pipe(
				chapters.changes,
				Stream.filter(event =>
					Array.every(['manga:100', 'manga:101'], key => Array.some(event.upserted, item => keyOf(item) === key))
				),
				Stream.runHead
			)
			const startedAt = yield* Ref.get(starts)
			assert.strictEqual(Array.length(startedAt), 2)
			assert.strictEqual(Option.getOrThrow(Array.head(startedAt)), Option.getOrThrow(Array.last(startedAt)))
		})
	)

	test.effect(
		'leaves from a fresh proxy session on every feed try',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const sessions = MutableRef.make(Array.empty<number>())
			const failed = yield* Queue.unbounded<void>()
			const client = HttpClient.make(request =>
				Effect.sync(() =>
					Boolean.match(
						String.endsWith('/gist/series/OPM/')(request.url) || String.endsWith('/gist/series/JYHJU/')(request.url),
						{
							onFalse: () => HttpClientResponse.fromWeb(request, new Response(undefined, {status: 404})),
							onTrue: () => HttpClientResponse.fromWeb(request, index({'1': 'https://example.test/index.png'}))
						}
					)
				)
			)
			yield* Layer.build(
				pipe(
					Chapters.layer,
					Layer.provide(layerKeyValueStore(directory)),
					Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
					Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({OPM_PROXY: 'http://127.0.0.1:9'}))),
					Layer.provide(warningLayer(failed, 'The chapter sync failed')),
					Layer.provide(
						Layer.succeed(Random.Random, {
							nextDoubleUnsafe: () => {
								const session = Array.length(sessions.current) + 1
								sessions.current = [...sessions.current, session]
								return session / 100
							},
							nextIntUnsafe: () => 0
						})
					)
				)
			)
			yield* Queue.take(failed)
			assert.strictEqual(Array.length(sessions.current), 8)
			assert.strictEqual(Array.length(Array.dedupe(sessions.current)), 8)
			yield* TestClock.adjust('6 hours')
			yield* Queue.take(failed)
			assert.strictEqual(Array.length(sessions.current), 16)
			assert.strictEqual(Array.length(Array.dedupe(sessions.current)), 16)
		})
	)

	test.effect(
		'persists shared reading and concurrent device changes without treating list marks as visits',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const first = 'ExpoPushToken[device00000001]'
			const second = 'ExpoPushToken[device00000002]'
			yield* Effect.scoped(
				Effect.gen(function* () {
					const store = yield* Effect.provideContext(openStore(), yield* Layer.build(layerKeyValueStore(directory)))
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
								Chapters.layer,
								Layer.provide(layerKeyValueStore(directory)),
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
					yield* chapters.read({done: true, number: 2, page: 0, series: 'manga'})
					assert.deepStrictEqual(
						Option.map(
							Array.findFirst(
								(yield* Effect.fromOption(yield* Stream.runHead(chapters.changes))).upserted,
								chapter => chapter.series === 'manga' && chapter.number === 2
							),
							chapter => chapter.reading
						),
						Option.some({done: true, page: 0})
					)
					yield* TestClock.adjust('1 second')
					yield* chapters.read({done: true, number: 1, page: 0, series: 'manga'})
					yield* chapters.read({done: false, number: 2, page: 0, series: 'manga'})
					yield* TestClock.adjust('1 second')
					yield* chapters.read({done: false, number: 1, page: 0, series: 'webcomic'})
				})
			)
			const store = yield* Effect.provideContext(openStore(), yield* Layer.build(layerKeyValueStore(directory)))
			assert.deepStrictEqual(
				Array.map(
					Array.filter(yield* store.load, chapter => chapter.reading !== undefined),
					chapter => [keyOf(chapter), chapter.reading?.page]
				),
				[
					['manga:2', 0],
					['manga:1', 0],
					['webcomic:1', 0]
				]
			)
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

	test.effect(
		'loads a stored chapter whose reading still carries the old visit timestamp',
		Effect.fnUntraced(function* () {
			const keyValueStore = Context.get(yield* Layer.build(KeyValueStore.layerMemory), KeyValueStore.KeyValueStore)
			yield* keyValueStore.set(
				'chapters',
				'[{"notified":true,"number":1,"pages":[],"postedAt":0,"reading":{"at":1700000000000,"done":true,"page":3},"series":"manga","source":"https://example.test/1","title":""}]'
			)
			const store = yield* Effect.provideService(openStore(), KeyValueStore.KeyValueStore, keyValueStore)
			assert.deepStrictEqual((yield* store.load)[0]?.reading, {done: true, page: 3})
		})
	)
})
