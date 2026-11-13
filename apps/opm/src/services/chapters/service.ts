import {NodeHttpClient} from '@effect/platform-node'

import {
	Array,
	Boolean,
	Config,
	Context,
	DateTime,
	Duration,
	Effect,
	Equal,
	HashMap,
	HashSet,
	Layer,
	Option,
	Predicate,
	Random,
	Record,
	Ref,
	Result,
	Schedule,
	Schema,
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

import {Xml} from 'effect/encoding'
import {HttpClient, HttpClientError, HttpClientResponse} from 'effect/http'
import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {Apns, apnsAccepted, apnsDeadToken} from '@deslop/runtime/server/apns'

import {
	byNumber,
	chaptersFromIndex,
	INDEXES,
	indexChapters,
	keyOf,
	missingNumbers,
	nameOf,
	pagesOf,
	postFrom,
	revisionCandidates,
	seriesOf,
	SERIES_NAMES
} from '#services/chapters/lib/utils.ts'
import {
	Chapter,
	ChapterNumber,
	ChaptersError,
	CubariSeries,
	DeadLink,
	Device,
	Post,
	Series
} from '#services/chapters/schema.ts'
import {ReadingChapter} from '#services/reading/schema.ts'
import type {ChaptersEvent} from '#services/reading/schema.ts'
import {Reading} from '#services/reading/service.ts'

// Anonymous search and JSON are refused. Recent-post Atom still answers; a release can appear on either subreddit only.
const FEEDS = [
	'https://www.reddit.com/r/OnePunchMan/new/.rss?limit=100',
	'https://www.reddit.com/r/OPMFolk/new/.rss?limit=100'
]
const BROWSER =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

// Releases whose posts link only dead readers, with a translation that still loads: webcomic 158 from https://www.reddit.com/r/OPMFolk/comments/1sbfbrf/, manga 233 from its r/OPMFolk post, and 234 to 237 from @Floppysterino's gist, which numbers them two lower.
const ARCHIVE_POSTS = Array.map(
	[
		{number: 158, postedAt: '2026-04-03T00:00:00Z', series: 'webcomic', slug: 'qe4gz2dzk7j'},
		{number: 233, postedAt: '2026-06-17T16:11:12Z', series: 'manga', slug: 'ne7bjjlnm45'},
		{number: 234, postedAt: '2026-07-01T21:47:46Z', series: 'manga', slug: 'na7kblmpm78'},
		{number: 235, postedAt: '2026-07-15T18:08:27Z', series: 'manga', slug: 'qb4zovevv7j'},
		{number: 236, postedAt: '2026-07-29T21:13:30Z', series: 'manga', slug: 'n87wo5da3yx'},
		{number: 237, postedAt: '2026-08-12T19:06:58Z', series: 'manga', slug: '9249q2bzmyn'}
	] as const,
	release =>
		Post.make({
			links: [`https://cubari.moe/read/imgchest/${release.slug}/1/1/`],
			number: ChapterNumber.make(release.number),
			postedAt: DateTime.makeUnsafe(release.postedAt),
			revised: false,
			series: release.series
		})
)

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly chapters: never
	}
}

// The chapters a list read again holds with other values than before; a row read again is a new object, so values decide.
function changed(chapters: readonly ReadingChapter[], before: readonly ReadingChapter[]) {
	const previous = HashMap.fromIterable(Array.map(before, chapter => [keyOf(chapter), chapter] as const))
	return Array.filter(
		chapters,
		chapter =>
			!pipe(
				previous,
				HashMap.get(keyOf(chapter)),
				Option.exists(item => Equal.equals(item, chapter))
			)
	)
}

function elementText(element: Xml.Element, name: string) {
	return pipe(
		element.children,
		Array.filter((child): child is Xml.Element => !Predicate.isString(child) && child.name === name),
		Array.flatMap(child => child.children),
		Array.filter(Predicate.isString),
		Array.join('')
	)
}

function postsOf(feed: string) {
	return pipe(
		Stream.make(feed),
		Stream.pipeThroughChannel(Xml.decodeString()),
		Stream.pipeThroughChannel(Xml.elements(['feed', 'entry'])),
		Stream.map(entry =>
			postFrom({
				content: elementText(entry, 'content'),
				published: elementText(entry, 'published'),
				title: elementText(entry, 'title')
			})
		),
		Stream.runCollect,
		Effect.map(Array.getSomes)
	)
}

function asStorageChaptersError(cause: unknown) {
	return ChaptersError.make({cause, message: 'The chapter storage failed.'})
}

const asChaptersError = Effect.mapError(asStorageChaptersError)

export class Chapters extends Context.Service<Chapters>()('@deslop/opm/services/chapters/service/Chapters', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const client = yield* HttpClient.HttpClient
		const apns = yield* Apns
		const exit = yield* Config.option(Config.String('OPM_PROXY'))
		// Dead reader links are known only to this run: after a restart each answers its 404 once more.
		const deadLinks = yield* Ref.make(Array.empty<DeadLink>())

		const listChapters = SqlSchema.findAll({
			Request: Schema.Void,
			Result: ReadingChapter,
			// Newest first, as the iPhone lists them.
			execute: () => sql`
				SELECT chapters.*, CASE WHEN reading.number IS NOT NULL
					THEN json_object('done', json(CASE WHEN reading.done THEN 'true' ELSE 'false' END), 'page', reading.page)
					END AS reading
				FROM chapters LEFT JOIN reading USING (series, number) ORDER BY number DESC, series
			`
		})
		const insertChapter = SqlSchema.void({
			Request: Chapter.insert,
			execute: row => sql`INSERT INTO ${sql(Chapter.table)} ${sql.insert(row)}`
		})
		const revise = SqlSchema.void({
			Request: Chapter.update.mapFields(Struct.pick(['number', 'pages', 'revisedAt', 'series', 'source'])),
			execute: row => sql`
				UPDATE ${sql(Chapter.table)} SET ${sql.update(row, ['number', 'series'])}
				WHERE series = ${row.series} AND number = ${row.number}
			`
		})
		const announce = SqlSchema.void({
			Request: Chapter.update.mapFields(Struct.pick(['notified', 'number', 'series'])),
			execute: row => sql`
				UPDATE ${sql(Chapter.table)} SET ${sql.update(row, ['number', 'series'])}
				WHERE series = ${row.series} AND number = ${row.number}
			`
		})
		const listDevices = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Device,
			execute: () => sql`SELECT * FROM ${sql(Device.table)}`
		})
		const insertDevice = SqlSchema.void({
			Request: Device.insert,
			execute: row => sql`INSERT INTO ${sql(Device.table)} ${sql.insert(row)} ON CONFLICT DO NOTHING`
		})
		const removeDevice = SqlSchema.void({
			Request: Device.update,
			execute: row => sql`DELETE FROM ${sql(Device.table)} WHERE bundle = ${row.bundle} AND token = ${row.token}`
		})

		const chapters = asChaptersError(listChapters())

		function series(url: string) {
			return pipe(
				client.get(url, {headers: {'user-agent': BROWSER}}),
				Effect.flatMap(HttpClientResponse.filterStatusOk),
				Effect.flatMap(HttpClientResponse.schemaBodyJson(CubariSeries)),
				Effect.timeout('20 seconds'),
				Effect.retry({schedule: Schedule.exponential('1 second'), times: 2, while: HttpClient.isTransientError})
			)
		}

		const resolve = Effect.fnUntraced(function* (post: Post, link: string, now: DateTime.Utc) {
			const target = yield* Effect.fromOption(seriesOf(link))
			const answer = yield* series(target.api)
			return Chapter.make({
				// A chapter found a day after its post arrives announced, so a first sync never floods the iPhone.
				notified: pipe(post.postedAt, DateTime.distance(now), Duration.isGreaterThan(Duration.days(1))),
				number: post.number,
				pages: yield* Effect.fromOption(pagesOf(answer, target.chapter)),
				postedAt: Option.some(post.postedAt),
				revisedAt: Option.none(),
				series: post.series,
				source: link,
				title: nameOf(
					pipe(
						Record.get(answer.chapters, target.chapter),
						Option.flatMap(chapter => chapter.title),
						Option.flatten,
						Option.getOrElse(() => '')
					)
				)
			})
		})

		const backfill = Effect.fnUntraced(function* (kind: Series) {
			const index = chaptersFromIndex(yield* series(`https://cubari.moe/read/api/gist/series/${INDEXES[kind]}/`), kind)
			// A chapter Reddit already supplied keeps its pages; later rounds fill only the gaps the index now covers.
			const missing = indexChapters(yield* chapters, index, kind)
			if (Array.isReadonlyArrayEmpty(missing)) return
			yield* pipe(
				Effect.forEach(missing, insertChapter, {concurrency: 1, discard: true}),
				Reactivity.mutation(['chapters']),
				sql.withTransaction,
				asChaptersError
			)
			yield* Effect.logInfo(`Backfilled ${missing.length} ${kind} chapters from the community index`)
		})

		const sync = Effect.gen(function* () {
			// The index is read every round, so a gap left by a dead reader link fills once its archive entry appears.
			yield* Effect.forEach(
				Series.literals,
				kind => Effect.ignore(backfill(kind), {log: 'Warn', message: `The ${kind} community index was not read`}),
				{concurrency: 1, discard: true}
			)
			// One subreddit that does not answer leaves the other's releases for this round.
			const feeds = yield* Effect.forEach(
				FEEDS,
				url =>
					pipe(
						Effect.scoped(
							Effect.gen(function* () {
								const feedClient = yield* Option.match(exit, {
									onNone: () => Effect.succeed(client),
									// A residential exit can be offline or flagged by Reddit, so each try leaves from another address.
									onSome: Effect.fnUntraced(function* (proxy) {
										const session = `${yield* Random.nextIntBetween(10_000_000, 99_999_999)}`
										const context = yield* Layer.build(
											Layer.provide(
												NodeHttpClient.layerNodeHttpNoAgent,
												NodeHttpClient.layerAgentOptions({
													proxyEnv: {
														HTTP_PROXY: String.replaceAll('{session}', session)(proxy),
														HTTPS_PROXY: String.replaceAll('{session}', session)(proxy),
														NODE_ENV: 'production'
													}
												})
											)
										)
										return Context.get(context, HttpClient.HttpClient)
									})
								})
								return yield* pipe(
									HttpClient.get(url, {headers: {'user-agent': BROWSER}}),
									Effect.flatMap(HttpClientResponse.filterStatusOk),
									Effect.flatMap(response => response.text),
									Effect.timeout('20 seconds'),
									Effect.provideService(HttpClient.HttpClient, feedClient)
								)
							})
						),
						Effect.retry({times: 3}),
						Effect.flatMap(postsOf),
						Effect.tapError(error => Effect.logWarning(`Reddit did not answer ${url}`, error)),
						Effect.option
					),
				{concurrency: 'unbounded'}
			)
			if (Array.every(feeds, Option.isNone)) return yield* ChaptersError.make({message: 'Reddit did not answer.'})
			const now = yield* DateTime.now
			const current = yield* chapters
			const candidates = revisionCandidates(
				[...ARCHIVE_POSTS, ...Array.flatten(Array.getSomes(feeds))],
				current,
				yield* Ref.get(deadLinks)
			)
			const groups = Record.toEntries(Array.groupBy(candidates, candidate => keyOf(candidate.post)))
			// The first link that loads wins: a release's best translation can be gone while another still reads.
			const found = yield* Effect.forEach(
				groups,
				entry =>
					pipe(
						Effect.firstSuccessOf(
							Array.flatMap(entry[1], candidate =>
								Array.map(candidate.links, link =>
									Effect.tapError(resolve(candidate.post, link, now), error =>
										Boolean.match(HttpClientError.isHttpClientError(error) && error.response?.status === 404, {
											onFalse: () => Effect.void,
											onTrue: () =>
												Ref.update(deadLinks, links =>
													pipe(
														links,
														Array.some(item => item.key === entry[0] && item.link === link),
														Boolean.match({
															onFalse: () => [...links, DeadLink.make({key: entry[0], link})],
															onTrue: () => links
														})
													)
												)
										})
									)
								)
							)
						),
						Effect.asSome,
						Effect.orElseSucceed(Option.none<Chapter>)
					),
				{concurrency: 1}
			)
			// A known chapter takes only an explicit revision's pages, so a second translation never moves a reader's page.
			const known = HashSet.fromIterable(Array.map(current, keyOf))
			const loaded = Array.getSomes(found)
			yield* pipe(
				loaded,
				Array.filter(chapter => !HashSet.has(known, keyOf(chapter))),
				Effect.forEach(insertChapter, {concurrency: 1, discard: true}),
				Effect.andThen(
					pipe(
						loaded,
						Array.filter(chapter => HashSet.has(known, keyOf(chapter))),
						Effect.forEach(
							chapter =>
								revise({
									number: chapter.number,
									pages: chapter.pages,
									revisedAt: chapter.postedAt,
									series: chapter.series,
									source: chapter.source
								}),
							{concurrency: 1, discard: true}
						)
					)
				),
				Reactivity.mutation(['chapters']),
				sql.withTransaction,
				asChaptersError
			)
			const saved = yield* chapters
			const unreadable = Array.dedupe([
				...Array.flatMap(Series.literals, kind =>
					Array.map(missingNumbers(saved, kind), number => keyOf({number, series: kind}))
				),
				...pipe(
					groups,
					Array.zip(found),
					Array.filterMap(pair =>
						Option.match(pair[1], {onNone: () => Result.succeed(pair[0][0]), onSome: () => Result.failVoid})
					)
				)
			])
			if (Array.isReadonlyArrayNonEmpty(unreadable)) {
				yield* Effect.logWarning(`No readable source for ${Array.join(unreadable, ', ')}`)
			}
		})

		const send = Effect.fnUntraced(function* (chapter: Chapter, device: Device) {
			const answer = yield* apns.sendToDevice(
				{bundle: device.bundle, production: device.bundle === 'xyz.mp281x.opm', token: device.token},
				'alert',
				{
					aps: {
						alert: {
							body: Boolean.match(String.isNonEmpty(chapter.title), {
								onFalse: () => `${chapter.pages.length} pages, out now`,
								onTrue: () => chapter.title
							}),
							title: `${SERIES_NAMES[chapter.series]} · Chapter ${chapter.number}`
						},
						sound: 'default',
						'thread-id': chapter.series
					},
					// expo-notifications exposes the remote userInfo.body as content.data.
					body: {path: keyOf(chapter)}
				},
				10
			)
			if (apnsDeadToken(answer)) {
				yield* asChaptersError(removeDevice(device))
				return
			}
			if (!apnsAccepted(answer)) {
				return yield* ChaptersError.make({
					message: `APNs refused a chapter: ${answer.status} ${Option.getOrElse(answer.reason, () => '')}`
				})
			}
		})

		// The outbox: a chapter stays unannounced until Apple accepts its messages, so a failed send retries next round.
		const notify = Effect.gen(function* () {
			if (!apns.enabled) return
			const pending = Array.filter(yield* chapters, chapter => !chapter.notified)
			if (Array.isReadonlyArrayEmpty(pending)) return
			yield* pipe(
				pending,
				Array.sort(byNumber),
				Effect.forEach(
					chapter =>
						Effect.ignore(
							Effect.gen(function* () {
								// Re-read after each chapter, so a dead token is never sent the next one.
								const devices = yield* asChaptersError(listDevices())
								// A refused device must not prevent the others from receiving this chapter.
								yield* pipe(
									devices,
									Effect.forEach(device => Effect.result(send(chapter, device)), {concurrency: 1}),
									Effect.flatMap(answers => pipe(answers, Result.all, Effect.fromResult))
								)
								yield* pipe(
									announce({notified: true, number: chapter.number, series: chapter.series}),
									Reactivity.mutation(['chapters']),
									asChaptersError
								)
								yield* Effect.logInfo(`Announced chapter ${keyOf(chapter)} to ${devices.length} iPhones`)
							}),
							{log: 'Warn', message: `Chapter ${keyOf(chapter)} was not announced yet`}
						),
					{concurrency: 1, discard: true}
				)
			)
		})

		// Announce in the discovering round, then wait an hour before reading both communities again.
		yield* pipe(
			sync,
			Effect.ignore({log: 'Warn', message: 'The chapter sync failed'}),
			Effect.andThen(Effect.ignore(notify, {log: 'Warn', message: 'The new chapters were not announced'})),
			Effect.withSpan('Chapters.sync'),
			Effect.repeat(Schedule.spaced('1 hour')),
			Effect.forkScoped
		)

		return {
			// What the iPhone watches: the whole list first, then only the chapters that changed, after each commit.
			events: pipe(
				sql.reactive(['chapters', 'reading'], listChapters()),
				Stream.mapError(asStorageChaptersError),
				Stream.mapAccum(
					() => Option.none<readonly ReadingChapter[]>(),
					(previous, current) =>
						[
							Option.some(current),
							Option.match(previous, {
								onNone: () => [{reset: true, upserted: current} satisfies ChaptersEvent],
								onSome: before =>
									Array.match(changed(current, before), {
										onEmpty: () => Array.empty<ChaptersEvent>(),
										onNonEmpty: upserted => [{reset: false, upserted} satisfies ChaptersEvent]
									})
							})
						] as const
				),
				Stream.withSpan('Chapters.events', {attributes: {'rpc.stream': true}})
			),
			register: Effect.fn('Chapters.register')(function* (device: typeof Device.insert.Type) {
				yield* asChaptersError(insertDevice(device))
			})
		}
	})
}) {
	// The tables this service owns, made and changed at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({
			loader: Migrator.fromRecord({
				'0001_chapters': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`
						CREATE TABLE chapters (
							series TEXT NOT NULL,
							number REAL NOT NULL,
							title TEXT NOT NULL,
							pages TEXT NOT NULL,
							postedAt REAL NOT NULL,
							reading TEXT,
							notified INTEGER NOT NULL,
							revisedAt REAL,
							source TEXT NOT NULL,
							PRIMARY KEY (series, number)
						) STRICT
					`
					yield* sql`CREATE TABLE devices (token TEXT PRIMARY KEY) STRICT, WITHOUT ROWID`
				}),
				'0002_apns_devices': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					// Expo tokens cannot address APNs; every phone registers a native token on its next launch.
					yield* sql`DROP TABLE devices`
					yield* sql`CREATE TABLE devices (bundle TEXT NOT NULL, token TEXT NOT NULL, PRIMARY KEY (bundle, token)) STRICT, WITHOUT ROWID`
				})
			}),
			table: 'chapters_migrations'
		})
	)

	// The joined list can start only after Reading has moved its rows out of the catalogue's original table.
	static readonly layer = Layer.provide(
		Layer.effect(this, this.make),
		Layer.provide(Reading.migrations, this.migrations)
	)
}
