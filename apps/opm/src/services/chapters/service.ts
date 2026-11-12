import {NodeHttpClient} from '@effect/platform-node'

import {
	Array,
	Boolean,
	Clock,
	Config,
	Context,
	DateTime,
	Effect,
	HashMap,
	Layer,
	Option,
	Order,
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
	SubscriptionRef,
	pipe
} from 'effect'

import {Xml} from 'effect/encoding'
import {HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse} from 'effect/http'

import {openStore} from '#services/chapters/lib/store.ts'
import {
	byNumber,
	chaptersFromIndex,
	INDEXES,
	indexChapters,
	keyOf,
	mergeMissingChapters,
	missingNumbers,
	nameOf,
	pagesOf,
	postFrom,
	reconcileChapters,
	revisionCandidates,
	seriesOf,
	SERIES_NAMES
} from '#services/chapters/lib/utils.ts'
import type {Chapter, ChaptersEvent, PushToken, ReadingUpdate} from '#services/chapters/schema.ts'
import {ChaptersError, CubariSeries, DeadLink, Post, PushTickets, Series} from '#services/chapters/schema.ts'

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

const newestFirst = Order.flip(byNumber)

function change(chapters: Chapter[], key: string, update: (chapter: Chapter) => Chapter) {
	return Array.map(chapters, item =>
		Boolean.match(keyOf(item) === key, {onFalse: () => item, onTrue: () => update(item)})
	)
}

function changed(chapters: Chapter[], before: Chapter[]) {
	const previous = HashMap.fromIterable(Array.map(before, chapter => [keyOf(chapter), chapter] as const))
	return Array.filter(
		chapters,
		chapter => !Option.exists(HashMap.get(previous, keyOf(chapter)), item => item === chapter)
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

export class Chapters extends Context.Service<
	Chapters,
	{
		readonly changes: Stream.Stream<ChaptersEvent>
		readonly read: (update: ReadingUpdate) => Effect.Effect<void, ChaptersError>
		readonly register: (token: PushToken) => Effect.Effect<void, ChaptersError>
	}
>()('@deslop/opm/services/chapters/service/Chapters') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient
			const exit = yield* Config.option(Config.String('OPM_PROXY'))
			const store = yield* openStore()
			const state = yield* SubscriptionRef.make(Array.sort(yield* store.load, newestFirst))
			function series(url: string) {
				return pipe(
					client.get(url, {headers: {'user-agent': BROWSER}}),
					Effect.flatMap(HttpClientResponse.filterStatusOk),
					Effect.flatMap(HttpClientResponse.schemaBodyJson(CubariSeries)),
					Effect.timeout('20 seconds'),
					Effect.retry({schedule: Schedule.exponential('1 second'), times: 2, while: HttpClient.isTransientError})
				)
			}

			const resolve = Effect.fnUntraced(function* (post: Post, link: string) {
				const target = yield* Effect.fromOption(seriesOf(link))
				const answer = yield* series(target.api)
				return {
					notified: false,
					number: post.number,
					pages: yield* Effect.fromOption(pagesOf(answer, target.chapter)),
					postedAt: post.postedAt,
					series: post.series,
					source: link,
					title: nameOf(answer.chapters[target.chapter]?.title ?? '')
				} satisfies Chapter
			})

			// Persist before publishing; unchanged chapters keep their identity so the stream sends only changes.
			function save(apply: (current: Chapter[]) => Chapter[]) {
				return Effect.uninterruptible(
					SubscriptionRef.updateEffect(state, current => {
						const next = apply(current)
						if (Array.isReadonlyArrayEmpty(changed(next, current))) return Effect.succeed(current)
						return Effect.as(store.save(next), next)
					})
				)
			}

			const backfill = Effect.fnUntraced(function* (kind: Series) {
				const chapters = chaptersFromIndex(
					yield* series(`https://cubari.moe/read/api/gist/series/${INDEXES[kind]}/`),
					kind
				)
				// A chapter Reddit already supplied keeps its pages; later rounds fill only the gaps the index now covers.
				const missing = indexChapters(yield* SubscriptionRef.get(state), chapters, kind)
				if (Array.isReadonlyArrayEmpty(missing)) return
				yield* save(current => mergeMissingChapters(current, missing))
				yield* Effect.logInfo(`Backfilled ${missing.length} ${kind} chapters from the community index`)
			})

			const sync = Effect.gen(function* () {
				// The index is read every round, so a gap left by a dead reader link fills once its archive entry appears.
				yield* Effect.forEach(
					Series.literals,
					kind =>
						pipe(backfill(kind), Effect.ignore({log: 'Warn', message: `The ${kind} community index was not read`})),
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
										onSome: proxy =>
											Effect.gen(function* () {
												const session = `${yield* Random.nextIntBetween(10_000_000, 99_999_999)}`
												const context = yield* Layer.build(
													pipe(
														NodeHttpClient.layerNodeHttpNoAgent,
														Layer.provide(
															NodeHttpClient.layerAgentOptions({
																proxyEnv: {
																	HTTP_PROXY: String.replaceAll('{session}', session)(proxy),
																	HTTPS_PROXY: String.replaceAll('{session}', session)(proxy),
																	NODE_ENV: 'production'
																}
															})
														)
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
				const deadLinks = yield* store.deadLinks
				const candidates = revisionCandidates(
					[...ARCHIVE_POSTS, ...Array.flatten(Array.getSomes(feeds))],
					yield* SubscriptionRef.get(state),
					deadLinks
				)
				const newlyDead = yield* Ref.make(Array.empty<DeadLink>())
				const groups = Record.toEntries(Array.groupBy(candidates, candidate => keyOf(candidate.post)))
				// The first link that loads wins: a release's best translation can be gone while another still reads.
				const found = yield* Effect.forEach(
					groups,
					entry =>
						pipe(
							Effect.firstSuccessOf(
								Array.flatMap(entry[1], candidate =>
									Array.map(candidate.links, link =>
										pipe(
											resolve(candidate.post, link),
											Effect.tapError(error =>
												Boolean.match(HttpClientError.isHttpClientError(error) && error.response?.status === 404, {
													onFalse: () => Effect.void,
													onTrue: () =>
														Ref.update(newlyDead, links =>
															Boolean.match(
																Array.some(links, item => item.key === entry[0] && item.link === link),
																{onFalse: () => [...links, DeadLink.make({key: entry[0], link})], onTrue: () => links}
															)
														)
												})
											)
										)
									)
								)
							),
							Effect.asSome,
							Effect.orElseSucceed(Option.none<Chapter>)
						),
					{concurrency: 1}
				)
				const recorded = yield* Ref.get(newlyDead)
				if (Array.isReadonlyArrayNonEmpty(recorded)) yield* store.saveDeadLinks([...deadLinks, ...recorded])
				// A known chapter takes only an explicit revision's pages, so a second translation never moves a reader's page.
				yield* save(current => reconcileChapters(current, Array.getSomes(found), now))
				const current = yield* SubscriptionRef.get(state)
				const unreadable = Array.dedupe([
					...Array.flatMap(Series.literals, kind =>
						Array.map(missingNumbers(current, kind), number => keyOf({number, series: kind}))
					),
					...Array.filterMap(Array.zip(groups, found), pair =>
						Option.match(pair[1], {onNone: () => Result.succeed(pair[0][0]), onSome: () => Result.failVoid})
					)
				])
				if (Array.isReadonlyArrayNonEmpty(unreadable)) {
					yield* Effect.logWarning(`No readable source for ${Array.join(unreadable, ', ')}`)
				}
			})

			const send = Effect.fnUntraced(function* (chapter: Chapter, tokens: string[]) {
				const answer = yield* pipe(
					HttpClientRequest.post('https://exp.host/--/api/v2/push/send'),
					HttpClientRequest.bodyJson(
						Array.map(tokens, to => ({
							body: Boolean.match(String.isNonEmpty(chapter.title), {
								onFalse: () => `${chapter.pages.length} pages, out now`,
								onTrue: () => chapter.title
							}),
							data: {path: keyOf(chapter)},
							sound: 'default',
							threadId: chapter.series,
							title: `${SERIES_NAMES[chapter.series]} · Chapter ${chapter.number}`,
							to
						}))
					),
					Effect.flatMap(request => client.execute(request)),
					Effect.flatMap(HttpClientResponse.filterStatusOk),
					Effect.flatMap(
						HttpClientResponse.schemaBodyJson(
							PushTickets.check(
								Schema.makeFilter(received => received.data.length === tokens.length, {
									message: 'Expo must return exactly one ticket per message'
								})
							)
						)
					),
					Effect.timeout('20 seconds')
				)
				// Expo answers with one ticket per message; an uninstalled app's token never works again.
				const tickets = Array.zip(tokens, answer.data)
				yield* Effect.forEach(
					Array.filter(tickets, pair => pair[1].details?.error === 'DeviceNotRegistered'),
					pair => store.removeDevice(pair[0]),
					{concurrency: 1, discard: true}
				)
				// Any other refused message keeps the chapter in the outbox for the next round.
				const refused = Array.filter(
					tickets,
					pair => pair[1].status === 'error' && pair[1].details?.error !== 'DeviceNotRegistered'
				)
				if (Array.isReadonlyArrayNonEmpty(refused)) {
					return yield* ChaptersError.make({
						message: `Expo refused ${refused.length} messages: ${Array.join(
							Array.map(refused, pair => pair[1].details?.error ?? 'unknown'),
							', '
						)}`
					})
				}
			})

			// The outbox: a chapter stays unannounced until Expo accepts its messages, so a failed send retries next round.
			const notify = Effect.gen(function* () {
				const pending = Array.filter(yield* SubscriptionRef.get(state), chapter => !chapter.notified)
				if (Array.isReadonlyArrayEmpty(pending)) return
				const tokens = yield* store.devices
				yield* Effect.forEach(
					Array.sort(pending, byNumber),
					chapter =>
						pipe(
							Effect.forEach(Array.chunksOf(tokens, 100), batch => send(chapter, batch), {
								concurrency: 1,
								discard: true
							}),
							Effect.andThen(save(chapters => change(chapters, keyOf(chapter), item => ({...item, notified: true})))),
							Effect.andThen(Effect.logInfo(`Announced chapter ${keyOf(chapter)} to ${tokens.length} iPhones`)),
							Effect.ignore({log: 'Warn', message: `Chapter ${keyOf(chapter)} was not announced yet`})
						),
					{concurrency: 1, discard: true}
				)
			})

			// Announce in the discovering round, then wait an hour before reading both communities again.
			yield* Effect.forkScoped(
				Effect.repeat(
					pipe(
						sync,
						Effect.ignore({log: 'Warn', message: 'The chapter sync failed'}),
						Effect.andThen(notify),
						Effect.withSpan('Chapters.sync')
					),
					Schedule.spaced('1 hour')
				)
			)

			return Chapters.of({
				changes: pipe(
					SubscriptionRef.changes(state),
					Stream.mapAccum(
						() => Option.none<Chapter[]>(),
						(previous, current: Chapter[]) =>
							[
								Option.some(current),
								Option.match(previous, {
									onNone: () => [
										{reset: true, upserted: Array.map(current, Struct.omit(['notified', 'revisedAt', 'source']))}
									],
									onSome: before =>
										pipe(
											changed(current, before),
											Array.match({
												onEmpty: () => Array.empty<ChaptersEvent>(),
												onNonEmpty: updates => [
													{reset: false, upserted: Array.map(updates, Struct.omit(['notified', 'revisedAt', 'source']))}
												]
											})
										)
								})
							] as const
					)
				),
				read: Effect.fn('Chapters.read')(function* (update) {
					yield* save(chapters =>
						change(chapters, keyOf(update), item => ({...item, reading: {done: update.done, page: update.page}}))
					)
				}),
				register: Effect.fn('Chapters.register')(function* (token) {
					yield* store.addDevice(token)
				})
			})
		})
	)
}
