import {NodeHttpClient} from '@effect/platform-node'

import {
	Array,
	Boolean,
	Clock,
	Config,
	Context,
	DateTime,
	Effect,
	Equal,
	HashMap,
	HashSet,
	Layer,
	Option,
	Predicate,
	Random,
	Record,
	Redacted,
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
import {HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

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
import type {ChaptersEvent, ReadingUpdate} from '#services/chapters/schema.ts'
import {
	Chapter,
	ChaptersError,
	CubariSeries,
	DeadLink,
	Device,
	Post,
	PushTickets,
	Series
} from '#services/chapters/schema.ts'

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
			number: release.number,
			postedAt: DateTime.toEpochMillis(DateTime.makeUnsafe(release.postedAt)),
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
function changed(chapters: readonly Chapter[], before: readonly Chapter[]) {
	const previous = HashMap.fromIterable(Array.map(before, chapter => [keyOf(chapter), chapter] as const))
	return Array.filter(
		chapters,
		chapter =>
			!pipe(
				previous,
				pipelineSubject2934 => HashMap.get(pipelineSubject2934, keyOf(chapter)),
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
		const exit = yield* Config.option(Config.String('OPM_PROXY'))
		// Writes tell this Reactivity of their commits, so callers need none of their own.
		const withReactivity = Effect.provideService(Reactivity.Reactivity, yield* Reactivity.Reactivity)
		// Dead reader links are known only to this run: after a restart each answers its 404 once more.
		const deadLinks = yield* Ref.make(Array.empty<DeadLink>())

		const listChapters = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Chapter,
			// Newest first, as the iPhone lists them.
			execute: () => sql`SELECT * FROM ${sql(Chapter.table)} ORDER BY number DESC, series`
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
		const place = SqlSchema.void({
			Request: Chapter.update.mapFields(Struct.pick(['number', 'reading', 'series'])),
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
			execute: row => sql`DELETE FROM ${sql(Device.table)} WHERE token = ${row.token}`
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

		const resolve = Effect.fnUntraced(function* (post: Post, link: string, now: number) {
			const target = yield* Effect.fromOption(seriesOf(link))
			const answer = yield* series(target.api)
			return Chapter.make({
				// A chapter found a day after its post arrives announced, so a first sync never floods the iPhone.
				notified: now - post.postedAt > 86_400_000,
				number: post.number,
				pages: yield* Effect.fromOption(pagesOf(answer, target.chapter)),
				postedAt: post.postedAt,
				reading: Option.none(),
				revisedAt: Option.none(),
				series: post.series,
				source: link,
				title: nameOf(answer.chapters[target.chapter]?.title ?? '')
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
			const now = yield* Clock.currentTimeMillis
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
														pipelineSubject11148 =>
															Boolean.match(pipelineSubject11148, {
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
				pipelineSubject11850 => Effect.forEach(pipelineSubject11850, insertChapter, {concurrency: 1, discard: true}),
				subject11929 =>
					pipe(
						subject11929,
						Effect.andThen(
							pipe(
								loaded,
								Array.filter(chapter => HashSet.has(known, keyOf(chapter))),
								pipelineSubject12030 =>
									Effect.forEach(
										pipelineSubject12030,
										chapter =>
											revise({
												number: chapter.number,
												pages: chapter.pages,
												revisedAt: Option.some(chapter.postedAt),
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

		const send = Effect.fnUntraced(function* (chapter: Chapter, devices: readonly Device[]) {
			const answer = yield* pipe(
				HttpClientRequest.post('https://exp.host/--/api/v2/push/send'),
				HttpClientRequest.bodyJson(
					Array.map(devices, device => ({
						body: Boolean.match(String.isNonEmpty(chapter.title), {
							onFalse: () => `${chapter.pages.length} pages, out now`,
							onTrue: () => chapter.title
						}),
						data: {path: keyOf(chapter)},
						sound: 'default',
						threadId: chapter.series,
						title: `${SERIES_NAMES[chapter.series]} · Chapter ${chapter.number}`,
						to: Redacted.value(device.token)
					}))
				),
				Effect.flatMap(request => client.execute(request)),
				Effect.flatMap(HttpClientResponse.filterStatusOk),
				Effect.flatMap(
					HttpClientResponse.schemaBodyJson(
						PushTickets.check(
							Schema.makeFilter(received => received.data.length === devices.length, {
								message: 'Expo must return exactly one ticket per message'
							})
						)
					)
				),
				Effect.timeout('20 seconds')
			)
			// Expo answers with one ticket per message; an uninstalled app's token never works again.
			const tickets = Array.zip(devices, answer.data)
			yield* pipe(
				tickets,
				Array.filter(pair => pair[1].details?.error === 'DeviceNotRegistered'),
				pipelineSubject14230 =>
					Effect.forEach(pipelineSubject14230, pair => asChaptersError(removeDevice(pair[0])), {
						concurrency: 1,
						discard: true
					})
			)
			// Any other refused message keeps the chapter in the outbox for the next round.
			const refused = Array.filter(
				tickets,
				pair => pair[1].status === 'error' && pair[1].details?.error !== 'DeviceNotRegistered'
			)
			if (Array.isReadonlyArrayNonEmpty(refused)) {
				return yield* ChaptersError.make({
					message: `Expo refused ${refused.length} messages: ${pipe(
						refused,
						Array.map(pair => pair[1].details?.error ?? 'unknown'),
						Array.join(', ')
					)}`
				})
			}
		})

		// The outbox: a chapter stays unannounced until Expo accepts its messages, so a failed send retries next round.
		const notify = Effect.gen(function* () {
			const pending = Array.filter(yield* chapters, chapter => !chapter.notified)
			if (Array.isReadonlyArrayEmpty(pending)) return
			const devices = yield* asChaptersError(listDevices())
			yield* pipe(pending, Array.sort(byNumber), pipelineSubject15268 =>
				Effect.forEach(
					pipelineSubject15268,
					chapter =>
						pipe(
							devices,
							Array.chunksOf(100),
							pipelineSubject15395 =>
								Effect.forEach(pipelineSubject15395, batch => send(chapter, batch), {concurrency: 1, discard: true}),
							subject15767 =>
								pipe(
									subject15767,
									Effect.andThen(
										pipe(
											announce({notified: true, number: chapter.number, series: chapter.series}),
											Reactivity.mutation(['chapters']),
											asChaptersError
										)
									),
									Effect.andThen(Effect.logInfo(`Announced chapter ${keyOf(chapter)} to ${devices.length} iPhones`)),
									Effect.ignore({log: 'Warn', message: `Chapter ${keyOf(chapter)} was not announced yet`})
								)
						),
					{concurrency: 1, discard: true}
				)
			)
		})

		// Announce in the discovering round, then wait an hour before reading both communities again.
		yield* Effect.forkScoped(
			Effect.repeat(
				pipe(
					sync,
					Effect.ignore({log: 'Warn', message: 'The chapter sync failed'}),
					Effect.andThen(Effect.ignore(notify, {log: 'Warn', message: 'The new chapters were not announced'})),
					Effect.withSpan('Chapters.sync')
				),
				Schedule.spaced('1 hour')
			)
		)

		return {
			// What the iPhone watches: the whole list first, then only the chapters that changed, after each commit.
			events: pipe(
				sql.reactive(['chapters'], listChapters()),
				pipelineSubject16520 => Stream.mapError(pipelineSubject16520, asStorageChaptersError),
				Stream.mapAccum(
					() => Option.none<readonly Chapter[]>(),
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
				)
			),
			read: Effect.fn('Chapters.read')(function* (update: ReadingUpdate) {
				yield* pipe(
					place({
						number: update.number,
						reading: Option.some({done: update.done, page: update.page}),
						series: update.series
					}),
					Reactivity.mutation(['chapters']),
					asChaptersError
				)
			}, withReactivity),
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
				})
			}),
			table: 'chapters_migrations'
		})
	)

	static readonly layer = Layer.provide(Layer.effect(this, this.make), this.migrations)
}
