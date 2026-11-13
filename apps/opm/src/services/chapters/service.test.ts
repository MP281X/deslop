import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Boolean,
	Clock,
	ConfigProvider,
	Context,
	Effect,
	Fiber,
	Layer,
	Logger,
	MutableRef,
	Option,
	Predicate,
	Queue,
	Random,
	Record,
	Redacted,
	Ref,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {KeyFormat, Signature} from 'effect/crypto'
import {Base64, Base64Url} from 'effect/encoding'
import {HttpClient, HttpClientError, HttpClientResponse} from 'effect/http'
import {Reactivity} from 'effect/reactivity'
import {SqlClient, SqlSchema} from 'effect/sql'
import {TestClock} from 'effect/testing'

import {Apns} from '@deslop/runtime/server/apns'
import {ApnsToken} from '@deslop/runtime/shared/apns'

import onePunchMan from './fixtures/one-punch-man.xml?raw'
import opmFolk from './fixtures/opm-folk.xml?raw'

import {INDEXES, byNumber, keyOf} from '#services/chapters/lib/utils.ts'
import type {Series} from '#services/chapters/schema.ts'
import {Chapter, ChapterNumber, Device, PostedAt} from '#services/chapters/schema.ts'
import {Chapters} from '#services/chapters/service.ts'
import {ReadingChapter, ChaptersEvent} from '#services/reading/schema.ts'
import {Reading} from '#services/reading/service.ts'

const memory = Layer.merge(SqliteClient.layer({filename: ':memory:'}), Reactivity.layer)

type Database = Layer.Success<typeof memory>

function chapterAt(series: Series, number: number, notified = true) {
	return Chapter.make({
		notified,
		number: ChapterNumber.make(number),
		pages: [`https://example.test/${series}-${number}.png`],
		postedAt: Option.none(),
		revisedAt: Option.none(),
		series,
		source: `https://cubari.moe/read/gist/${INDEXES[series]}/${number}/1/`,
		title: ''
	})
}

function insertChapters(database: Context.Context<Database>, chapters: readonly Chapter[]) {
	const sql = Context.get(database, SqlClient.SqlClient)
	return Effect.forEach(
		chapters,
		chapter =>
			Effect.flatMap(Schema.encodeEffect(Chapter.insert)(chapter), row => sql`INSERT INTO chapters ${sql.insert(row)}`),
		{concurrency: 1, discard: true}
	)
}

// A database holding these chapters and iPhones before the service first starts; building the service on it again is a restart.
const seeded = Effect.fnUntraced(function* (chapters: readonly Chapter[], tokens: readonly string[] = []) {
	const database = yield* Layer.build(memory)
	const sql = Context.get(database, SqlClient.SqlClient)
	yield* pipe(
		Reading.migrations,
		Layer.provide(Chapters.migrations),
		Layer.provide(Layer.succeedContext(database)),
		Layer.build
	)
	yield* insertChapters(database, chapters)
	yield* Effect.forEach(
		tokens,
		token =>
			Effect.flatMap(
				Schema.encodeEffect(Device.insert)({bundle: 'xyz.mp281x.opm', token: Redacted.make(ApnsToken.make(token))}),
				row => sql`INSERT INTO devices ${sql.insert(row)}`
			),
		{concurrency: 1, discard: true}
	)
	return database
})

// What the database holds, read the way the service reads it.
function stored(database: Context.Context<Database>) {
	const sql = Context.get(database, SqlClient.SqlClient)
	return {
		chapters: SqlSchema.findAll({
			Request: Schema.Void,
			Result: ReadingChapter,
			execute: () => sql`SELECT chapters.*, CASE WHEN reading.number IS NOT NULL
				THEN json_object('done', json(CASE WHEN reading.done THEN 'true' ELSE 'false' END), 'page', reading.page) END AS reading
				FROM chapters LEFT JOIN reading USING (series, number) ORDER BY number DESC, series`
		}),
		devices: SqlSchema.findAll({Request: Schema.Void, Result: Device, execute: () => sql`SELECT * FROM devices`})
	}
}

const open = Effect.fnUntraced(function* (
	database: Context.Context<Database>,
	client: HttpClient.HttpClient,
	extra: Layer.Layer<never> = Layer.empty
) {
	const key = yield* (yield* Signature.Signature).generateKeyPair(Signature.ecdsaP256)
	const context = yield* Layer.build(
		pipe(
			Layer.merge(Chapters.layer, Reading.layer),
			Layer.provide(
				Layer.provide(
					Apns.layer,
					ConfigProvider.layer(
						ConfigProvider.fromUnknown({
							APNS_KEY: Base64.encode(yield* KeyFormat.encode(KeyFormat.pkcs8, key.privateKey)),
							APNS_KEY_ID: 'fixture',
							APNS_TEAM_ID: 'fixture'
						})
					)
				)
			),
			Layer.provide(Layer.succeedContext(database)),
			Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
			Layer.provide(extra)
		)
	)
	return {...Context.get(context, Chapters), reading: Context.get(context, Reading)}
})

function index(links: Record<string, string>) {
	return Response.json({chapters: Record.map(links, link => ({groups: {english: [link]}}))})
}

function warningLayer(queue: Queue.Queue<void>, prefix: string) {
	return Logger.layer([
		Logger.make(options => {
			for (const message of Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(options.message)) {
				if (Predicate.isString(message) && String.startsWith(prefix)(message)) {
					Queue.offerUnsafe(queue, undefined)
				}
			}
		})
	])
}

// The events the iPhone reads, collected from now on as the wire carries them.
const watch = Effect.fnUntraced(function* (chapters: typeof Chapters.Service) {
	const events = yield* Queue.unbounded<typeof ChaptersEvent.Encoded>()
	yield* pipe(
		chapters.events,
		Stream.runForEach(event =>
			Effect.flatMap(Schema.encodeEffect(ChaptersEvent)(event), encoded => Queue.offer(events, encoded))
		),
		Effect.forkScoped
	)
	return events
})

it.layer(Layer.merge(NodeServices.layer, NodeCrypto.layer))(test => {
	for (const scenario of [
		{answers: [429, 429], attempts: 4, name: 'all throttled', notified: false},
		{answers: [503, 503], attempts: 4, name: 'all unavailable', notified: false},
		{answers: [200, 429], attempts: 2, name: 'accepted beside throttled', notified: true},
		{answers: [429, 200], attempts: 2, name: 'throttled beside accepted', notified: true},
		{answers: [403, 429], attempts: 4, name: 'provider rejected beside throttled', notified: false},
		{answers: [403, 403], attempts: 4, name: 'invalid provider token', notified: false},
		{answers: [410, 503], attempts: 3, name: 'dead beside unavailable', notified: false},
		{answers: [410, 410], attempts: 2, name: 'all dead', notified: true},
		{answers: ['network'], attempts: 2, name: 'network failure', notified: false},
		{answers: [200, 'network'], attempts: 2, name: 'accepted beside network failure', notified: true},
		{answers: [], attempts: 0, name: 'no devices', notified: true}
	] as const) {
		test.effect(
			`chapter announcement: ${scenario.name}`,
			Effect.fnUntraced(function* () {
				const database = yield* seeded(
					[chapterAt('manga', 1, false)],
					Array.take([String.repeat(64)('a'), String.repeat(64)('b')], scenario.answers.length)
				)
				const answers = yield* Ref.make<readonly (number | 'network')[]>(scenario.answers)
				const attempts = yield* Ref.make(0)
				const rounds = yield* Queue.unbounded<void>()
				yield* open(
					database,
					HttpClient.make(request =>
						Effect.gen(function* () {
							if (String.includes('/3/device/')(request.url)) {
								yield* Ref.update(attempts, count => count + 1)
								const recipient = Boolean.match(String.endsWith(String.repeat(64)('a'))(request.url), {
									onFalse: () => 1,
									onTrue: () => 0
								})
								const status = Array.getUnsafe(yield* Ref.get(answers), recipient)
								if (status === 'network') {
									return yield* new HttpClientError.HttpClientError({
										reason: new HttpClientError.TransportError({request})
									})
								}
								if (status === 403) {
									return HttpClientResponse.fromWeb(request, Response.json({reason: 'InvalidProviderToken'}, {status}))
								}
								return HttpClientResponse.fromWeb(request, new Response(undefined, {status}))
							}
							return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 404}))
						})
					),
					Logger.layer([
						Logger.make(options => {
							for (const message of Option.getOrElse(
								Schema.decodeUnknownOption(Schema.Array(Schema.Unknown))(options.message),
								() => []
							)) {
								if (
									message === 'Chapter manga:1 was not announced yet' ||
									(Predicate.isString(message) && String.startsWith('Announced chapter manga:1 to ')(message))
								) {
									Queue.offerUnsafe(rounds, undefined)
								}
							}
						})
					])
				)
				yield* Queue.take(rounds)
				assert.deepStrictEqual(
					Array.map(yield* stored(database).chapters(), chapter => chapter.notified),
					[scenario.notified]
				)
				yield* Ref.set(
					answers,
					Array.map(scenario.answers, () => 200)
				)
				yield* TestClock.adjust('1 hour')
				if (!scenario.notified) yield* Queue.take(rounds)
				assert.deepStrictEqual(
					Array.map(yield* stored(database).chapters(), chapter => chapter.notified),
					[true]
				)
				assert.strictEqual(yield* Ref.get(attempts), scenario.attempts)
			})
		)
	}

	test.effect(
		'forgets an iPhone whose app was removed and never sends its token back',
		Effect.fnUntraced(function* () {
			const database = yield* seeded([])
			const kept = String.repeat(64)('a')
			const announced = yield* Queue.unbounded<void>()
			const chapters = yield* open(
				database,
				HttpClient.make(request =>
					Effect.sync(() =>
						Boolean.match(String.includes('/3/device/')(request.url), {
							onFalse: () => HttpClientResponse.fromWeb(request, new Response(undefined, {status: 404})),
							// The second iPhone's app was removed.
							onTrue: () =>
								HttpClientResponse.fromWeb(
									request,
									Boolean.match(String.endsWith(kept)(request.url), {
										onFalse: () => Response.json({reason: 'Unregistered'}, {status: 410}),
										onTrue: () => new Response()
									})
								)
						})
					)
				),
				warningLayer(announced, 'Announced chapter manga:1')
			)
			yield* chapters.register({bundle: 'xyz.mp281x.opm', token: Redacted.make(ApnsToken.make(kept))})
			yield* chapters.register({bundle: 'xyz.mp281x.opm', token: Redacted.make(ApnsToken.make(String.repeat(64)('b')))})
			yield* chapters.register({bundle: 'xyz.mp281x.opm', token: Redacted.make(ApnsToken.make(kept))})
			// A chapter found once both iPhones are registered, so whichever round sees it tells both.
			yield* insertChapters(database, [chapterAt('manga', 1, false)])
			yield* TestClock.adjust('1 hour')
			yield* Queue.take(announced)
			const devices = yield* stored(database).devices()
			assert.deepStrictEqual(
				Array.map(devices, device => Redacted.value(device.token)),
				[kept]
			)
			// The token is stored for the server's own use: it prints redacted and has no JSON form to leak through.
			assert.isTrue(Array.every(devices, device => Redacted.isRedacted(device.token)))
			assert.deepStrictEqual(Record.keys(Device.json.fields), ['bundle'])
		})
	)

	test.effect(
		'a found chapter and its reading reach the stream the iPhone reads, survive a restart, and Unread clears the mark',
		Effect.fnUntraced(function* () {
			const database = yield* seeded([])
			const indexed = yield* Queue.unbounded<void>()
			const client = HttpClient.make(request =>
				Effect.gen(function* () {
					if (String.endsWith('/gist/series/OPM/')(request.url)) {
						// The index answers only once the iPhone listens, so the chapter arrives live.
						yield* Queue.take(indexed)
						return HttpClientResponse.fromWeb(request, index({'1': 'https://example.test/1.png'}))
					}
					return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 404}))
				})
			)
			const chapter = {
				number: 1,
				pages: ['https://example.test/1.png'],
				postedAt: 0,
				series: 'manga',
				title: ''
			} as const
			yield* Effect.scoped(
				Effect.gen(function* () {
					const chapters = yield* open(database, client)
					const events = yield* watch(chapters)
					assert.deepStrictEqual(yield* Queue.take(events), {reset: true, upserted: []})
					yield* Queue.offer(indexed, undefined)
					// The server's bookkeeping, such as the source link and the announced mark, stays on the server.
					assert.deepStrictEqual(yield* Queue.take(events), {reset: false, upserted: [chapter]})
					yield* chapters.reading.write({done: false, number: ChapterNumber.make(1), page: 3, series: 'manga'})
					assert.deepStrictEqual(yield* Queue.take(events), {
						reset: false,
						upserted: [{...chapter, reading: {done: false, page: 3}}]
					})
				})
			)
			const chapters = yield* open(database, client)
			const events = yield* watch(chapters)
			assert.deepStrictEqual(yield* Queue.take(events), {
				reset: true,
				upserted: [{...chapter, reading: {done: false, page: 3}}]
			})
			yield* chapters.reading.write({done: true, number: ChapterNumber.make(1), page: 0, series: 'manga'})
			assert.deepStrictEqual(yield* Queue.take(events), {
				reset: false,
				upserted: [{...chapter, reading: {done: true, page: 0}}]
			})
			yield* chapters.reading.write({done: false, number: ChapterNumber.make(1), page: 0, series: 'manga'})
			assert.deepStrictEqual(yield* Queue.take(events), {
				reset: false,
				upserted: [{...chapter, reading: {done: false, page: 0}}]
			})
		})
	)

	test.effect(
		'persists shared reading and concurrent device changes without treating list marks as visits',
		Effect.fnUntraced(function* () {
			const first = String.repeat(64)('a')
			const second = String.repeat(64)('b')
			const database = yield* seeded(
				Array.flatMap(['manga', 'webcomic'] as const, series => [chapterAt(series, 1), chapterAt(series, 2)])
			)
			const client = HttpClient.make(() => Effect.never)
			yield* Effect.scoped(
				Effect.gen(function* () {
					const chapters = yield* open(database, client)
					yield* Effect.all(
						[
							chapters.register({bundle: 'xyz.mp281x.opm', token: Redacted.make(ApnsToken.make(first))}),
							chapters.register({bundle: 'xyz.mp281x.opm', token: Redacted.make(ApnsToken.make(second))}),
							chapters.register({bundle: 'xyz.mp281x.opm', token: Redacted.make(ApnsToken.make(first))})
						],
						{concurrency: 'unbounded', discard: true}
					)
					yield* chapters.reading.write({done: true, number: ChapterNumber.make(2), page: 0, series: 'manga'})
					assert.deepStrictEqual(
						pipe(
							(yield* Effect.fromOption(yield* Stream.runHead(chapters.events))).upserted,
							Array.findFirst(chapter => keyOf(chapter) === 'manga:2'),
							Option.map(chapter => chapter.reading)
						),
						Option.some(Option.some({done: true, page: 0}))
					)
					yield* chapters.reading.write({done: true, number: ChapterNumber.make(1), page: 0, series: 'manga'})
					yield* chapters.reading.write({done: false, number: ChapterNumber.make(2), page: 0, series: 'manga'})
					yield* chapters.reading.write({done: false, number: ChapterNumber.make(1), page: 0, series: 'webcomic'})
				})
			)
			// Read again after a restart: a reading holds only its page and whether it is done.
			assert.deepStrictEqual(
				Array.map(
					(yield* Effect.fromOption(yield* Stream.runHead((yield* open(database, client)).events))).upserted,
					chapter => [keyOf(chapter), chapter.reading]
				),
				[
					['manga:2', Option.some({done: false, page: 0})],
					['webcomic:2', Option.none()],
					['manga:1', Option.some({done: true, page: 0})],
					['webcomic:1', Option.some({done: false, page: 0})]
				]
			)
			assert.deepStrictEqual(
				Array.map(yield* stored(database).devices(), device => Redacted.value(device.token)),
				[first, second]
			)
		})
	)

	test.effect(
		'backfills the webcomic beside existing manga and scopes releases, revisions and reading by series',
		Effect.fnUntraced(function* () {
			const database = yield* seeded([chapterAt('manga', 1)])
			const revised = yield* Ref.make(false)
			const broken = yield* Ref.make(0)
			const brokenRequests = yield* Queue.unbounded<void>()
			const chapters = yield* open(
				database,
				HttpClient.make(request =>
					Effect.gen(function* () {
						// r/OPMFolk alone posts some releases, numbered its own way and listing several translations.
						if (String.includes('/r/OPMFolk/new/.rss')(request.url)) {
							return HttpClientResponse.fromWeb(
								request,
								new Response(
									`<feed><entry><title>Chapter 3/48 [Translations]</title><published>2026-04-06T00:00:00Z</published><content>&lt;a href="https://cubari.moe/read/imgchest/broken/1/1/"&gt;Best&lt;/a&gt; &lt;a href="https://cubari.moe/read/imgchest/folk/1/1/"&gt;Alternative&lt;/a&gt;</content></entry></feed>`
								)
							)
						}
						if (String.includes('/new/.rss')(request.url)) {
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
									`<feed>${pipe(
										entries,
										Array.map(
											entry =>
												`<entry><title>${entry.title}</title><published>2026-04-06T00:00:00Z</published><content>&lt;a href="https://cubari.moe/read/imgchest/${entry.slug}/1/1/"&gt;Read&lt;/a&gt;</content></entry>`
										),
										Array.join('')
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
			)
			const loaded = yield* pipe(
				chapters.events,
				Stream.filter(event => Array.some(event.upserted, chapter => keyOf(chapter) === 'webcomic:2')),
				Stream.runHead,
				Effect.forkChild
			)
			yield* Queue.take(brokenRequests)
			yield* TestClock.adjust('8 seconds')
			yield* Fiber.join(loaded)
			assert.strictEqual(yield* Ref.get(broken), 2)
			const first = (yield* Effect.fromOption(yield* Stream.runHead(chapters.events))).upserted
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
			const saved = stored(database).chapters()
			assert.deepStrictEqual(
				pipe(
					yield* saved,
					Array.findFirst(chapter => keyOf(chapter) === 'manga:3'),
					Option.map(chapter => chapter.source)
				),
				Option.some('https://cubari.moe/read/imgchest/folk/1')
			)
			assert.deepStrictEqual(
				Option.map(Array.last(first), chapter => Schema.encodeSync(PostedAt)(chapter.postedAt)),
				Option.some(0)
			)
			// The next round's hourly wait starts only once this round has announced its new chapters.
			yield* pipe(
				Context.get(database, SqlClient.SqlClient).reactive(['chapters'], saved),
				Stream.filter(Array.every(chapter => chapter.notified)),
				Stream.runHead
			)
			yield* chapters.reading.write({done: true, number: ChapterNumber.make(1), page: 0, series: 'manga'})
			yield* chapters.reading.write({done: false, number: ChapterNumber.make(1), page: 0, series: 'webcomic'})
			yield* Ref.set(revised, true)
			yield* TestClock.adjust('1 hour')
			yield* pipe(
				chapters.events,
				Stream.filter(event =>
					Array.some(
						event.upserted,
						chapter => keyOf(chapter) === 'webcomic:1' && Array.some(chapter.pages, String.includes('/revision/'))
					)
				),
				Stream.runHead
			)
			const after = yield* saved
			assert.deepStrictEqual(
				pipe(
					after,
					Array.filter(chapter => chapter.number === 1),
					Array.map(chapter => [chapter.series, Option.map(chapter.reading, reading => reading.done), chapter.pages])
				),
				[
					['manga', Option.some(true), ['https://example.test/manga-1.png']],
					['webcomic', Option.some(false), ['https://example.test/read/api/imgchest/series/revision/page.png']]
				]
			)
			assert.isTrue(Array.every(after, chapter => chapter.notified))
		})
	)

	test.effect(
		'fills a chapter gap from the community index on a later sync',
		Effect.fnUntraced(function* () {
			const database = yield* seeded([
				...Array.map([228, 233, 234, 235, 236, 237], number => chapterAt('manga', number)),
				chapterAt('webcomic', 158)
			])
			const later = yield* Ref.make(false)
			const reads = yield* Ref.make(0)
			const reported = yield* Queue.unbounded<void>()
			yield* open(
				database,
				HttpClient.make(request =>
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
						if (String.includes('/new/.rss')(request.url)) {
							return HttpClientResponse.fromWeb(request, new Response('<feed></feed>'))
						}
						return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 404}))
					})
				),
				warningLayer(reported, 'No readable source for')
			)
			const saved = stored(database).chapters()
			yield* Queue.take(reported)
			assert.isFalse(Array.some(yield* saved, item => item.number === 229))
			yield* Ref.set(later, true)
			yield* TestClock.adjust('1 hour')
			yield* Queue.take(reported)
			const after = yield* saved
			assert.deepStrictEqual(
				pipe(
					after,
					Array.filter(item => item.series === 'manga' && item.number >= 229 && item.number <= 230),
					Array.sort(byNumber),
					Array.map(item => [Schema.encodeSync(ChapterNumber)(item.number), item.pages])
				),
				[
					[229, ['https://example.test/229.png']],
					[230, ['https://example.test/230.png']]
				]
			)
			assert.isFalse(Array.some(after, item => item.series === 'manga' && (item.number === 231 || item.number === 232)))
			assert.strictEqual(yield* Ref.get(reads), 2)
		})
	)

	test.effect(
		'fetches a dead reader link once across two syncs',
		Effect.fnUntraced(function* () {
			const database = yield* seeded([
				...Array.map([228, 233, 234, 235, 236, 237], number => chapterAt('manga', number)),
				chapterAt('webcomic', 158)
			])
			const fetches = yield* Ref.make(0)
			const reported = yield* Queue.unbounded<void>()
			yield* open(
				database,
				HttpClient.make(request =>
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
						if (String.includes('/r/OnePunchMan/new/.rss')(request.url)) {
							return HttpClientResponse.fromWeb(
								request,
								new Response(
									`<feed><entry><title>Chapter 229 [English]</title><published>1969-12-30T00:00:00Z</published><content>&lt;a href="https://cubari.moe/read/gist/dead/1/1/"&gt;Read&lt;/a&gt;</content></entry></feed>`
								)
							)
						}
						if (String.includes('/new/.rss')(request.url)) {
							return HttpClientResponse.fromWeb(request, new Response('<feed></feed>'))
						}
						return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 404}))
					})
				),
				warningLayer(reported, 'No readable source for')
			)
			yield* Queue.take(reported)
			assert.strictEqual(yield* Ref.get(fetches), 1)
			yield* TestClock.adjust('1 hour')
			yield* Queue.take(reported)
			assert.strictEqual(yield* Ref.get(fetches), 1)
			assert.isFalse(Array.some(yield* stored(database).chapters(), item => keyOf(item) === 'manga:229'))
		})
	)

	test.effect(
		'fetches both recent-post feeds concurrently and discovers chapter 243 from their real Atom entries',
		Effect.fnUntraced(function* () {
			const starts = yield* Ref.make(Array.empty<number>())
			const arrivals = yield* Queue.unbounded<void>()
			const client = HttpClient.make(request =>
				Effect.gen(function* () {
					if (String.includes('/r/OnePunchMan/new/.rss')(request.url)) {
						const started = yield* Clock.currentTimeMillis
						yield* Ref.update(starts, times => [...times, started])
						yield* Queue.offer(arrivals, undefined)
						yield* Effect.sleep('1 second')
						return HttpClientResponse.fromWeb(request, new Response(onePunchMan))
					}
					if (String.includes('/r/OPMFolk/new/.rss')(request.url)) {
						const started = yield* Clock.currentTimeMillis
						yield* Ref.update(starts, times => [...times, started])
						yield* Queue.offer(arrivals, undefined)
						yield* Effect.sleep('1 second')
						return HttpClientResponse.fromWeb(request, new Response(opmFolk))
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
			const chapters = yield* open(yield* seeded([]), client)
			yield* Queue.take(arrivals)
			yield* Queue.take(arrivals)
			yield* TestClock.adjust('10 seconds')
			yield* pipe(
				chapters.events,
				Stream.filter(event => Array.some(event.upserted, item => keyOf(item) === 'manga:243')),
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
			yield* open(
				yield* seeded([]),
				client,
				Layer.mergeAll(
					ConfigProvider.layer(ConfigProvider.fromUnknown({OPM_PROXY: 'http://127.0.0.1:9'})),
					warningLayer(failed, 'The chapter sync failed'),
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
			yield* Queue.take(failed)
			assert.strictEqual(Array.length(sessions.current), 8)
			assert.strictEqual(Array.length(Array.dedupe(sessions.current)), 8)
			yield* TestClock.adjust('1 hour')
			yield* Queue.take(failed)
			assert.strictEqual(Array.length(sessions.current), 16)
			assert.strictEqual(Array.length(Array.dedupe(sessions.current)), 16)
		})
	)
})
