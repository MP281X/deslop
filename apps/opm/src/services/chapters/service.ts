import {NodeHttpClient} from '@effect/platform-node'

import {
	Array,
	Boolean,
	Clock,
	Config,
	Context,
	DateTime,
	Effect,
	FileSystem,
	HashMap,
	HashSet,
	Layer,
	Number,
	Option,
	Order,
	Path,
	Random,
	Record,
	Result,
	Schedule,
	Stream,
	String,
	Struct,
	SubscriptionRef,
	pipe
} from 'effect'

import * as cheerio from 'cheerio'
import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'

import {openStore} from '#services/chapters/lib/store.ts'
import {byNumber, keyOf, nameOf, pagesOf, postFrom, seriesOf, SERIES_NAMES} from '#services/chapters/lib/utils.ts'
import type {Chapter, ChaptersEvent, PushToken, ReadingUpdate} from '#services/chapters/schema.ts'
import {ChaptersError, CubariSeries, Post, PushTickets, Series} from '#services/chapters/schema.ts'

// Reddit's JSON answers 403 to servers even through the proxy; its Atom search feed answers. A release can be posted on either subreddit only.
const FEEDS = [
	'https://www.reddit.com/r/OnePunchMan/search.rss?q=title%3Achapter+english&restrict_sr=1&sort=new&limit=100',
	'https://www.reddit.com/r/OPMFolk/search.rss?q=title%3Achapter+english&restrict_sr=1&sort=new&limit=100'
]
const BROWSER =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

const INDEXES = {manga: 'OPM', webcomic: 'JYHJU'}

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

function failed(message: string) {
	return Effect.mapError((cause: unknown) => ChaptersError.make({cause, message}))
}

function indexUrl(series: Series) {
	return `https://cubari.moe/read/gist/${INDEXES[series]}/`
}

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

function postsOf(feed: string) {
	const $ = cheerio.load(feed, {xml: true})
	return pipe(
		$('entry').toArray(),
		Array.map(entry =>
			postFrom({
				content: $(entry).children('content').text(),
				published: $(entry).children('published').text(),
				title: $(entry).children('title').text()
			})
		),
		Array.getSomes
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
	static readonly layer = (directory: string) =>
		Layer.effect(
			this,
			Effect.gen(function* () {
				const client = yield* HttpClient.HttpClient
				const exit = yield* pipe(Config.option(Config.String('OPM_PROXY')), failed('OPM_PROXY is unreadable.'))
				const store = yield* openStore(directory)
				const state = yield* SubscriptionRef.make(Array.sort(yield* store.load, newestFirst))
				function series(url: string) {
					return pipe(
						client.get(url, {headers: {'user-agent': BROWSER}}),
						Effect.flatMap(HttpClientResponse.filterStatusOk),
						Effect.flatMap(HttpClientResponse.schemaBodyJson(CubariSeries)),
						Effect.timeout('20 seconds'),
						Effect.retry({schedule: Schedule.exponential('1 second'), times: 2})
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

				// The community's back catalogues; Reddit supplies the newer releases.
				const backfill = Effect.fnUntraced(function* (kind: Series) {
					const index = yield* series(`https://cubari.moe/read/api/gist/series/${INDEXES[kind]}/`)
					const chapters = pipe(
						Record.toEntries(index.chapters),
						Array.map(entry =>
							pipe(
								Option.all({
									number: Number.parse(entry[0]),
									pages: pagesOf(index, entry[0]),
									postedAt: Option.some(
										Boolean.match(kind === 'webcomic', {
											onFalse: () =>
												Option.getOrElse(Array.head(Record.values(entry[1].release_date ?? {})), () => 0) * 1000,
											onTrue: () => 0
										})
									)
								}),
								Option.map(found => ({
									...found,
									notified: true,
									series: kind,
									source: `${indexUrl(kind)}${entry[0]}/1/`,
									title: nameOf(entry[1].title ?? '')
								}))
							)
						),
						Array.getSomes
					)
					// Only the numbers still missing: a chapter Reddit already supplied keeps its pages.
					yield* save(current => {
						const numbers = HashSet.fromIterable(Array.map(current, keyOf))
						return Array.sort(
							[...current, ...Array.filter(chapters, chapter => !HashSet.has(numbers, keyOf(chapter)))],
							newestFirst
						)
					})
					yield* Effect.logInfo(`Backfilled ${chapters.length} ${kind} chapters from the community index`)
				})

				const sync = Effect.gen(function* () {
					// The index fills the back catalogue once; a failed read is tried again next round.
					yield* Effect.forEach(
						Series.literals,
						kind =>
							Effect.gen(function* () {
								if (
									!Array.some(
										yield* SubscriptionRef.get(state),
										chapter => chapter.series === kind && String.startsWith(indexUrl(kind))(chapter.source)
									)
								) {
									yield* pipe(
										backfill(kind),
										Effect.ignore({log: 'Warn', message: `The ${kind} community index was not read`})
									)
								}
							}),
						{concurrency: 1, discard: true}
					)
					// One subreddit that does not answer leaves the other's releases for this round.
					const feeds = yield* Effect.forEach(
						FEEDS,
						url =>
							pipe(
								// A residential exit can be offline or flagged by Reddit, so each try leaves from another address.
								Effect.gen(function* () {
									const session = `${yield* Random.nextIntBetween(10_000_000, 99_999_999)}`
									return yield* pipe(
										HttpClient.get(url, {headers: {'user-agent': BROWSER}}),
										Effect.flatMap(HttpClientResponse.filterStatusOk),
										Effect.flatMap(response => response.text),
										Effect.timeout('20 seconds'),
										// @effect-diagnostics-next-line strictEffectProvide:off -- Each try owns an agent pinned to one proxy session.
										Effect.provide(
											Option.match(exit, {
												onNone: () => Layer.succeed(HttpClient.HttpClient, client),
												onSome: proxy =>
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
											})
										)
									)
								}),
								Effect.retry({times: 3}),
								Effect.map(postsOf),
								Effect.tapError(error => Effect.logWarning(`Reddit did not answer ${url}`, error)),
								Effect.option
							),
						{concurrency: 1}
					)
					if (Array.every(feeds, Option.isNone)) return yield* ChaptersError.make({message: 'Reddit did not answer.'})
					const posts = Array.sort(
						[...ARCHIVE_POSTS, ...Array.flatten(Array.getSomes(feeds))],
						Order.mapInput(Order.Number, (post: Post) => post.postedAt)
					)
					const known = HashMap.fromIterable(
						Array.map(yield* SubscriptionRef.get(state), chapter => [keyOf(chapter), chapter] as const)
					)
					const now = yield* Clock.currentTimeMillis
					// A new chapter's posts, oldest first, or later explicit revisions of a known one, each with the links not already read.
					const candidates = Array.filterMap(posts, post =>
						Array.match(
							Array.filter(post.links, link =>
								Option.match(HashMap.get(known, keyOf(post)), {
									onNone: () => true,
									onSome: item =>
										post.revised && post.postedAt > (item.revisedAt ?? item.postedAt) && link !== item.source
								})
							),
							{onEmpty: () => Result.failVoid, onNonEmpty: links => Result.succeed({links, post})}
						)
					)
					// The first link that loads wins: a release's best translation can be gone while another still reads.
					const found = yield* Effect.forEach(
						Record.toEntries(Array.groupBy(candidates, candidate => keyOf(candidate.post))),
						entry =>
							pipe(
								Effect.firstSuccessOf(
									Array.flatMap(entry[1], candidate =>
										Array.map(candidate.links, link => resolve(candidate.post, link))
									)
								),
								Effect.asSome,
								Effect.tapError(error => Effect.logWarning(`Chapter ${entry[0]} has no readable pages`, error)),
								Effect.orElseSucceed(Option.none<Chapter>)
							),
						{concurrency: 1}
					)
					const loaded = HashMap.fromIterable(
						Array.map(Array.getSomes(found), chapter => [keyOf(chapter), chapter] as const)
					)
					// A known chapter takes only an explicit revision's pages, so a second translation never moves a reader's page.
					yield* save(current => {
						const revised = Array.map(current, item =>
							Option.match(HashMap.get(loaded, keyOf(item)), {
								onNone: () => item,
								onSome: chapter => ({
									...item,
									pages: chapter.pages,
									revisedAt: chapter.postedAt,
									source: chapter.source
								})
							})
						)
						const present = HashSet.fromIterable(Array.map(current, keyOf))
						// Only a post from the last day is news; the backlog and a link that loads late stay quiet.
						const added = Array.map(
							Array.filter(
								Array.fromIterable(HashMap.values(loaded)),
								chapter => !HashSet.has(present, keyOf(chapter))
							),
							chapter => ({...chapter, notified: now - chapter.postedAt > 86_400_000})
						)
						return Array.sort([...revised, ...added], newestFirst)
					})
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
						Effect.flatMap(HttpClientResponse.schemaBodyJson(PushTickets)),
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

				// Chapters come out weekly, so four rounds a day announce one within six hours.
				yield* Effect.forkScoped(
					Effect.repeat(
						pipe(sync, Effect.ignore({log: 'Warn', message: 'The chapter sync failed'}), Effect.andThen(notify)),
						Schedule.spaced('6 hours')
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
										onNone: () => [{reset: true, upserted: Array.map(current, Struct.omit(['notified']))}],
										onSome: before =>
											pipe(
												changed(current, before),
												Array.match({
													onEmpty: () => Array.empty<ChaptersEvent>(),
													onNonEmpty: updates => [
														{reset: false, upserted: Array.map(updates, Struct.omit(['notified']))}
													]
												})
											)
									})
								] as const
						)
					),
					read: Effect.fn('Chapters.read')(function* (update) {
						const at = yield* Clock.currentTimeMillis
						yield* save(chapters =>
							change(chapters, keyOf(update), item => ({
								...item,
								reading: {
									at: Boolean.match(update.opened, {onFalse: () => item.reading?.at ?? 0, onTrue: () => at}),
									done: update.done,
									page: update.page
								}
							}))
						)
					}),
					register: Effect.fn('Chapters.register')(function* (token) {
						yield* store.addDevice(token)
					})
				})
			})
		)
}

const dataFolder = pipe(
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const directory = yield* pipe(
			Config.String('OPM_DATA_DIR'),
			Config.withDefault(path.join(yield* Config.String('HOME'), '.deslop', 'opm'))
		)
		yield* fs.makeDirectory(directory, {mode: 0o700, recursive: true})
		return directory
	}),
	failed('The chapters folder could not be read.')
)

export const layerChapters = Layer.unwrap(Effect.map(dataFolder, directory => Chapters.layer(directory)))
