import {NodeHttpClient} from '@effect/platform-node'

import {
	Array,
	Boolean,
	Config,
	Context,
	DateTime,
	Duration,
	Effect,
	Filter,
	Function,
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

import {listEvents} from '@deslop/runtime/shared/list'

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
	seriesOf
} from '#services/chapters/lib/utils.ts'
import {
	Chapter,
	ChapterNumber,
	ChaptersError,
	CubariSeries,
	DeadLink,
	ReadingChapter,
	ReadingPosition,
	ReadingError,
	Post,
	Series
} from '#services/chapters/schema.ts'
import {Push} from '#services/push/service.ts'

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
		const push = yield* Push
		const withReactivity = Effect.provideService(Reactivity.Reactivity, yield* Reactivity.Reactivity)
		const exit = yield* Config.option(Config.String('OPM_PROXY'))
		// Keep a dead reader link skipped only while the current discovery posts still reference it.
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
		const write = SqlSchema.void({
			Request: ReadingPosition.insert,
			execute: row =>
				sql`INSERT INTO ${sql(ReadingPosition.table)} ${sql.insert(row)} ON CONFLICT (series, number) DO UPDATE SET done = excluded.done, page = excluded.page`
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
						Option.getOrElse(Function.constant(''))
					)
				)
			})
		})

		const backfill = Effect.fnUntraced(function* (kind: Series, answer: CubariSeries) {
			const index = chaptersFromIndex(answer, kind)
			// A chapter Reddit already supplied keeps its pages; later rounds fill gaps and discover new index releases.
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
			const fetched = yield* Effect.all(
				{
					// One subreddit that does not answer leaves the other's releases for this round.
					feeds: Effect.forEach(
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
					),
					// Fetch independently, but replay failures alongside the serialized backfills below.
					indexes: Effect.forEach(
						Series.literals,
						kind =>
							Effect.map(
								Effect.result(series(`https://cubari.moe/read/api/gist/series/${INDEXES[kind]}/`)),
								answer => ({answer, kind})
							),
						{concurrency: 'unbounded'}
					)
				},
				{concurrency: 'unbounded'}
			)
			// The index is read every round, so a gap left by a dead reader link fills once its archive entry appears.
			yield* Effect.forEach(
				fetched.indexes,
				read =>
					pipe(
						Effect.fromResult(read.answer),
						Effect.flatMap(index => backfill(read.kind, index)),
						Effect.ignore({log: 'Warn', message: `The ${read.kind} community index was not read`})
					),
				{concurrency: 1, discard: true}
			)
			if (Array.every(fetched.feeds, Option.isNone)) {
				return yield* ChaptersError.make({message: 'Reddit did not answer.'})
			}
			const now = yield* DateTime.now
			const current = yield* chapters
			const posts = [...ARCHIVE_POSTS, ...Array.flatten(Array.getSomes(fetched.feeds))]
			yield* Ref.update(deadLinks, links =>
				Array.filter(links, dead =>
					Array.some(posts, post => keyOf(post) === dead.key && Array.contains(post.links, dead.link))
				)
			)
			const groups = Record.toEntries(
				Array.groupBy(revisionCandidates(posts, current, yield* Ref.get(deadLinks)), candidate => keyOf(candidate.post))
			)
			// The first link that loads wins: a release's best translation can be gone while another still reads.
			const found = yield* Effect.forEach(
				groups,
				entry =>
					Effect.result(
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
						)
					),
				{concurrency: 4}
			)
			// A known chapter takes only an explicit revision's pages, so a second translation never moves a reader's page.
			const known = HashSet.fromIterable(Array.map(current, keyOf))
			const [fresh, revisions] = pipe(
				found,
				Array.getSuccesses,
				Array.partition(Filter.fromPredicate(chapter => !HashSet.has(known, keyOf(chapter))))
			)
			yield* pipe(
				Effect.forEach(fresh, insertChapter, {concurrency: 1, discard: true}),
				Effect.andThen(
					Effect.forEach(
						revisions,
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
						Result.match(pair[1], {
							onFailure: error => Result.succeed({error, key: pair[0][0]}),
							onSuccess: () => Result.failVoid
						})
					)
				)
			])
			if (Array.isReadonlyArrayNonEmpty(unreadable)) {
				yield* Effect.logWarning('No readable source for chapters', unreadable)
			}
		})

		const notify = Effect.gen(function* () {
			yield* Effect.forEach(
				pipe(
					yield* chapters,
					Array.filter(chapter => !chapter.notified),
					Array.sort(byNumber)
				),
				chapter =>
					Effect.ignore(
						Effect.gen(function* () {
							if (!(yield* push.announce(chapter))) return
							yield* pipe(
								announce({notified: true, number: chapter.number, series: chapter.series}),
								Reactivity.mutation(['chapters']),
								asChaptersError
							)
						}),
						{log: 'Warn', message: `Chapter ${keyOf(chapter)} was not announced yet`}
					),
				{concurrency: 1, discard: true}
			)
		})

		// Announce in the discovering round, then wait an hour before reading both communities again.
		yield* pipe(
			sync,
			Effect.ignore({log: 'Warn', message: 'The chapter sync failed'}),
			Effect.andThen(Effect.ignore(notify, {log: 'Warn', message: 'The new chapters were not announced'})),
			Effect.andThen(
				Effect.ignore(
					sql`DELETE FROM deliveries WHERE EXISTS (SELECT 1 FROM chapters WHERE chapters.series = deliveries.series AND chapters.number = deliveries.number AND notified = 1)`,
					{log: 'Warn', message: 'Finished deliveries were not pruned'}
				)
			),
			Effect.withSpan('Chapters.sync'),
			Effect.repeat(Schedule.spaced('1 hour')),
			Effect.forkScoped
		)

		return {
			// What the iPhone watches: the whole list first, then only the chapters that changed, after each commit.
			events: pipe(
				listEvents(Stream.mapError(sql.reactive(['chapters'], listChapters()), asStorageChaptersError), keyOf),
				Stream.map(Struct.pick(['reset', 'upserted'])),
				Stream.withSpan('Chapters.events', {attributes: {'rpc.stream': true}})
			),
			write: Effect.fn('Chapters.write')(function* (update: typeof ReadingPosition.insert.Type) {
				yield* Effect.annotateCurrentSpan({
					chapter: update.number,
					done: update.done,
					page: update.page,
					series: update.series
				})
				yield* pipe(
					write(update),
					Reactivity.mutation(['chapters']),
					Effect.mapError(cause => ReadingError.make({cause, message: 'The reading position could not be saved.'}))
				)
			}, withReactivity)
		}
	})
}) {
	// The tables this service owns, made and changed at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.provide(
		Layer.effectDiscard(
			Migrator.make({})({
				loader: Migrator.fromRecord({
					'0002_reading': Effect.gen(function* () {
						const sql = yield* SqlClient.SqlClient
						yield* sql`CREATE TABLE reading (
						series TEXT NOT NULL, number REAL NOT NULL, done INTEGER NOT NULL, page INTEGER NOT NULL,
						PRIMARY KEY (series, number), FOREIGN KEY (series, number) REFERENCES chapters (series, number)
					) STRICT, WITHOUT ROWID`
						yield* sql`INSERT INTO reading (series, number, done, page)
						SELECT series, number, json_extract(reading, '$.done'), json_extract(reading, '$.page')
						FROM chapters WHERE reading IS NOT NULL`
						yield* sql`ALTER TABLE chapters DROP COLUMN reading`
					})
				}),
				table: 'reading_migrations'
			})
		),
		Layer.effectDiscard(
			Migrator.make({})({
				loader: Migrator.fromRecord({
					// judge-ignore no-unrelated-jobs -- This immutable historical migration created the original catalogue and registry together; moving Reading's ownership must not rewrite it.
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
					}),
					// judge-ignore no-unrelated-jobs -- One atomic device-delivery migration preserves registered tokens while introducing their receipt table.
					'0003_device_delivery': Effect.gen(function* () {
						const sql = yield* SqlClient.SqlClient
						yield* sql`ALTER TABLE devices RENAME TO old_devices`
						yield* sql`CREATE TABLE devices (token TEXT PRIMARY KEY, bundle TEXT NOT NULL, kind TEXT NOT NULL) STRICT, WITHOUT ROWID`
						yield* sql`INSERT INTO devices SELECT token, bundle, 'alert' FROM old_devices`
						yield* sql`DROP TABLE old_devices`
						yield* sql`CREATE TABLE deliveries (series TEXT NOT NULL, number REAL NOT NULL, token TEXT NOT NULL, PRIMARY KEY (series, number, token)) STRICT, WITHOUT ROWID`
					})
				}),
				table: 'chapters_migrations'
			})
		)
	)

	static readonly layer = pipe(Layer.effect(this, this.make), Layer.provide(Push.layer), Layer.provide(this.migrations))
}
