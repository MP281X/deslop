import {NodeHttpClient} from '@effect/platform-node'

import {
	Array,
	Boolean,
	Cache,
	Config,
	Context,
	DateTime,
	Duration,
	Effect,
	Function,
	HashMap,
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
import type {SqlError} from 'effect/sql'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {listEvents} from '@deslop/runtime/shared/list'

import {migrations, readingMigrations} from './migrations.ts'

import {
	chaptersFromIndex,
	INDEXES,
	keyOf,
	missingRanges,
	nameOf,
	pagesOf,
	postFrom,
	revisionCandidates,
	roundChapters,
	seriesOf
} from '#services/chapters/lib/utils.ts'
import {
	CatalogueRow,
	Chapter,
	ChapterNumber,
	ChapterState,
	ChaptersError,
	CubariSeries,
	DeadLink,
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
		readonly reading: never
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

function asStorageChaptersError(cause: SqlError.SqlError | Schema.SchemaError) {
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

		const listStates = SqlSchema.findAll({
			Request: Schema.Void,
			Result: ChapterState,
			execute: () => sql`SELECT series, number, notified, postedAt, revisedAt, source FROM chapters`
		})
		const listPending = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Chapter,
			execute: () => sql`SELECT * FROM chapters WHERE notified = 0 ORDER BY number, series`
		})
		const listCatalogue = SqlSchema.findAll({
			Request: Schema.Void,
			Result: CatalogueRow,
			// Newest first, as the iPhone lists them.
			execute: () => sql`SELECT series, number, title, pages, postedAt FROM chapters ORDER BY number DESC, series`
		})
		const listReading = SqlSchema.findAll({
			Request: Schema.Void,
			Result: ReadingPosition,
			execute: () => sql`SELECT * FROM ${sql(ReadingPosition.table)}`
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
		// Community imports and chapter revisions must not overwrite the reader's place.
		const write = SqlSchema.void({
			Request: ReadingPosition.insert,
			execute: row =>
				sql`INSERT INTO ${sql(ReadingPosition.table)} ${sql.insert(row)} ON CONFLICT (series, number) DO UPDATE SET done = excluded.done, page = excluded.page`
		})

		const states = asChaptersError(listStates())

		// Each try reads the whole answer within its own 20 seconds.
		function series(url: string) {
			return pipe(
				client.get(url, {headers: {'user-agent': BROWSER}}),
				Effect.flatMap(HttpClientResponse.filterStatusOk),
				Effect.flatMap(HttpClientResponse.schemaBodyJson(CubariSeries)),
				Effect.timeout('20 seconds'),
				Effect.retry({schedule: Schedule.exponential('1 second'), times: 2, while: HttpClient.isTransientError})
			)
		}

		// A residential exit can be offline or flagged by Reddit, so each try of a feed leaves from another address, and a refusal is worth a retry from the next one.
		const feedClient = Option.match(exit, {
			onNone: () => Effect.succeed(client),
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

		const sync = Effect.gen(function* () {
			// One read per reader per round, however many posts link the same one.
			const answers = yield* Cache.make({capacity: 256, lookup: series})
			const fetched = yield* Effect.all(
				{
					// One subreddit that does not answer leaves the other's releases for this round.
					feeds: Effect.forEach(
						FEEDS,
						url =>
							pipe(
								Effect.gen(function* () {
									return yield* (yield* HttpClientResponse.filterStatusOk(
										yield* (yield* feedClient).get(url, {headers: {'user-agent': BROWSER}})
									)).text
								}),
								Effect.scoped,
								// Each try reads the whole feed within its own 20 seconds, so a body that stalls is retried like a request that does.
								Effect.timeout('20 seconds'),
								Effect.retry({
									schedule: Schedule.exponential('1 second'),
									times: 3,
									while: error =>
										HttpClient.isTransientError(error) ||
										(Option.isSome(exit) && HttpClientError.isHttpClientError(error) && error.response?.status === 403)
								}),
								Effect.flatMap(postsOf),
								Effect.tapError(error => Effect.logWarning(`Reddit did not answer ${url}`, error)),
								Effect.option
							),
						{concurrency: 'unbounded'}
					),
					indexes: Effect.forEach(
						Series.literals,
						kind =>
							Effect.map(
								Effect.result(Cache.get(answers, `https://cubari.moe/read/api/gist/series/${INDEXES[kind]}/`)),
								answer => ({answer, kind})
							),
						{concurrency: 'unbounded'}
					)
				},
				{concurrency: 'unbounded'}
			)
			const now = yield* DateTime.now
			// Both sources are weighed against the catalogue as the round found it, so a release Reddit and the index bring together keeps Reddit's pages.
			const current = yield* states
			const posts = [...ARCHIVE_POSTS, ...Array.flatten(Array.getSomes(fetched.feeds))]
			// A link that answered 404 is tried again a day later, since an archive post never leaves the list and its translation may come back.
			yield* Ref.update(deadLinks, links =>
				Array.filter(
					links,
					dead =>
						pipe(dead.at, DateTime.distance(now), Duration.isLessThan(Duration.days(1))) &&
						Array.some(posts, post => keyOf(post) === dead.key && Array.contains(post.links, dead.link))
				)
			)
			const groups = revisionCandidates(posts, current, yield* Ref.get(deadLinks))
			// The first link that loads wins: a release's best translation can be gone while another still reads.
			const found = yield* Effect.forEach(
				groups,
				entry =>
					Effect.result(
						Effect.firstSuccessOf(
							Array.flatMap(entry[1], candidate =>
								Array.map(candidate.links, link =>
									Effect.tapError(
										Effect.gen(function* () {
											const target = yield* Effect.fromOption(seriesOf(link))
											const answer = yield* Cache.get(answers, target.api)
											return Chapter.make({
												// A chapter found a day after its post arrives announced, so a first sync never floods the iPhone.
												notified: pipe(
													candidate.post.postedAt,
													DateTime.distance(now),
													Duration.isGreaterThan(Duration.days(1))
												),
												number: candidate.post.number,
												pages: yield* Effect.fromOption(pagesOf(answer, target.chapter)),
												postedAt: Option.some(candidate.post.postedAt),
												revisedAt: Option.none(),
												series: candidate.post.series,
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
										}),
										error =>
											Boolean.match(HttpClientError.isHttpClientError(error) && error.response?.status === 404, {
												onFalse: () => Effect.void,
												onTrue: () =>
													Ref.update(deadLinks, links =>
														pipe(
															links,
															Array.some(item => item.key === entry[0] && item.link === link),
															Boolean.match({
																onFalse: () => [...links, DeadLink.make({at: now, key: entry[0], link})],
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
			// The index is read every round, so a gap left by a dead reader link fills once its archive entry appears.
			const round = roundChapters(
				current,
				Array.getSuccesses(found),
				Array.flatMap(fetched.indexes, read =>
					Result.match(read.answer, {
						onFailure: () => [],
						onSuccess: index => [{chapters: chaptersFromIndex(index, read.kind), kind: read.kind}]
					})
				)
			)
			yield* pipe(
				Effect.forEach([...round.fresh, ...round.backfilled], insertChapter, {concurrency: 1, discard: true}),
				Effect.andThen(
					Effect.forEach(
						round.revisions,
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
			yield* Effect.forEach(
				fetched.indexes,
				read =>
					Result.match(read.answer, {
						onFailure: error => Effect.logWarning(`The ${read.kind} community index was not read`, error),
						onSuccess: () => Effect.void
					}),
				{concurrency: 1, discard: true}
			)
			if (Array.isReadonlyArrayNonEmpty(round.backfilled)) {
				yield* Effect.logInfo(`Backfilled ${round.backfilled.length} chapters from the community indexes`)
			}
			const saved = yield* states
			const unreadable = [
				...Array.flatMap(Series.literals, kind =>
					Array.map(missingRanges(saved, kind), range =>
						Boolean.match(range.from === range.to, {
							onFalse: () => `${kind}:${range.from}-${range.to}`,
							onTrue: () => `${kind}:${range.from}`
						})
					)
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
			]
			if (Array.isReadonlyArrayNonEmpty(unreadable)) {
				yield* Effect.logWarning('No readable source for chapters', unreadable)
			}
			// The archive and the indexes were still read; the round reports the outage.
			if (Array.every(fetched.feeds, Option.isNone)) {
				return yield* ChaptersError.make({message: 'Reddit did not answer.'})
			}
		})

		// Discovery has no say in what the iPhone sees, so marking a chapter announced tells no subscriber.
		const notify = Effect.ignore(
			Effect.gen(function* () {
				yield* Effect.forEach(
					yield* asChaptersError(listPending()),
					chapter =>
						Effect.ignore(
							Effect.gen(function* () {
								if (!(yield* push.announce(chapter))) return
								yield* asChaptersError(announce({notified: true, number: chapter.number, series: chapter.series}))
							}),
							{log: 'Warn', message: `Chapter ${keyOf(chapter)} was not announced yet`}
						),
					{concurrency: 1, discard: true}
				)
			}),
			{log: 'Warn', message: 'The new chapters were not announced'}
		)

		// Alerts left by an earlier round or a restart go out before discovery's wait; what discovery finds is announced in the same round, then an hour passes before both communities are read again.
		yield* pipe(
			notify,
			Effect.andThen(Effect.ignore(sync, {log: 'Warn', message: 'The chapter sync failed'})),
			Effect.andThen(notify),
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
			// What the iPhone watches: the whole list, then the chapters each commit changed; a page turn rereads saved places, not page lists.
			events: pipe(
				listEvents(
					pipe(
						Stream.zipLatest(sql.reactive(['chapters'], listCatalogue()), sql.reactive(['reading'], listReading())),
						Stream.mapError(asStorageChaptersError),
						Stream.map(pair => {
							const saved = HashMap.fromIterable(
								Array.map(pair[1], position => [keyOf(position), {done: position.done, page: position.page}] as const)
							)
							return Array.map(pair[0], row => ({...row, reading: HashMap.get(saved, keyOf(row))}))
						})
					),
					keyOf
				),
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
					Reactivity.mutation(['reading']),
					Effect.mapError(cause => ReadingError.make({cause, message: 'The reading position could not be saved.'}))
				)
			}, withReactivity)
		}
	})
}) {
	// The tables this service owns, made and changed at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.provide(
		Layer.effectDiscard(
			Migrator.make({})({loader: Migrator.fromRecord(readingMigrations), table: 'reading_migrations'})
		),
		Layer.effectDiscard(Migrator.make({})({loader: Migrator.fromRecord(migrations), table: 'chapters_migrations'}))
	)

	static readonly layer = pipe(Layer.effect(this, this.make), Layer.provide(Push.layer), Layer.provide(this.migrations))
}
