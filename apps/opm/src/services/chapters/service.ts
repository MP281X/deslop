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
import type {Chapter, ChaptersEvent, Post, PushToken, ReadingUpdate} from '#services/chapters/schema.ts'
import {ChaptersError, CubariSeries, PushTickets, Series} from '#services/chapters/schema.ts'

// Reddit's JSON answers 403 to servers even through the proxy; its Atom search feed answers.
const FEED =
	'https://www.reddit.com/r/OnePunchMan/search.rss?q=title%3Achapter+english&restrict_sr=1&sort=new&limit=100'
const BROWSER =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

const INDEXES = {manga: 'OPM', webcomic: 'JYHJU'}

// The main feed misses this release and the archive's pages are broken: https://www.reddit.com/r/OPMFolk/comments/1sbfbrf/webcomic_chapter_158_english/
const ARCHIVE_POSTS: Post[] = [
	{
		link: 'https://cubari.moe/read/imgchest/qe4gz2dzk7j/1/1/',
		number: 158,
		postedAt: DateTime.toEpochMillis(DateTime.makeUnsafe('2026-04-03T00:00:00Z')),
		revised: false,
		series: 'webcomic'
	}
]

const newestFirst = Order.flip(byNumber)

function failed(message: string) {
	return Effect.mapError((cause: unknown) => ChaptersError.make({cause, message}))
}

function indexUrl(series: Series) {
	return `https://cubari.moe/read/gist/${INDEXES[series]}/`
}

// A chapter joins the list once; only an explicit revision replaces its pages, so a second translation never moves a reader's page.
function merge(current: Chapter[], chapter: Chapter) {
	return Option.match(
		Array.findFirst(current, item => keyOf(item) === keyOf(chapter)),
		{
			onNone: () => Array.sort([...current, chapter], newestFirst),
			onSome: found =>
				change(current, keyOf(found), item => ({
					...item,
					pages: chapter.pages,
					revisedAt: chapter.postedAt,
					source: chapter.source
				}))
		}
	)
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
		Array.getSomes,
		Array.sort(Order.mapInput(Order.Number, (post: Post) => post.postedAt))
	)
}

export class Chapters extends Context.Service<
	Chapters,
	{
		readonly changes: Stream.Stream<ChaptersEvent>
		readonly read: (update: ReadingUpdate) => Effect.Effect<void, ChaptersError>
		readonly register: (token: PushToken) => Effect.Effect<void, ChaptersError>
		readonly sync: Effect.Effect<void, ChaptersError>
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

				// A residential exit can be offline or flagged by Reddit, so each try leaves from another address.
				const feed = pipe(
					Effect.gen(function* () {
						const session = `${yield* Random.nextIntBetween(10_000_000, 99_999_999)}`
						return yield* pipe(
							HttpClient.get(FEED, {headers: {'user-agent': BROWSER}}),
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
					failed('Reddit did not answer.')
				)

				const resolve = Effect.fnUntraced(function* (post: Post) {
					const target = yield* Effect.fromOption(seriesOf(post.link))
					const answer = yield* series(target.api)
					return {
						notified: false,
						number: post.number,
						pages: yield* Effect.fromOption(pagesOf(answer, target.chapter)),
						postedAt: post.postedAt,
						series: post.series,
						source: post.link,
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
						return Array.reduce(
							Array.filter(chapters, chapter => !HashSet.has(numbers, keyOf(chapter))),
							current,
							merge
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
					const posts = [...ARCHIVE_POSTS, ...postsOf(yield* feed)]
					const known = HashMap.fromIterable(
						Array.map(yield* SubscriptionRef.get(state), chapter => [keyOf(chapter), chapter] as const)
					)
					const now = yield* Clock.currentTimeMillis
					const found = yield* Effect.forEach(
						// The first post of a new chapter, or a later explicit revision of a known one with other pages.
						pipe(
							posts,
							Array.mapAccum(HashSet.empty<string>(), (chosen, post) => {
								const key = keyOf(post)
								const existing = HashMap.get(known, key)
								const fresh = Option.isNone(existing) && !HashSet.has(chosen, key)
								const revision =
									post.revised &&
									Option.exists(
										existing,
										item => post.postedAt > (item.revisedAt ?? item.postedAt) && item.source !== post.link
									)
								if (fresh || revision) return [HashSet.add(chosen, key), Option.some(post)] as const
								return [chosen, Option.none<Post>()] as const
							}),
							result => Array.getSomes(result[1])
						),
						post =>
							pipe(
								resolve(post),
								Effect.asSome,
								Effect.tapError(error => Effect.logWarning(`Chapter ${post.number} has no readable pages`, error)),
								Effect.orElseSucceed(Option.none<Chapter>)
							),
						{concurrency: 1}
					)
					// Only a post from the last day is news; the backlog and a link that loads late stay quiet.
					yield* save(current =>
						Array.reduce(Array.getSomes(found), current, (chapters, chapter) =>
							merge(chapters, {...chapter, notified: now - chapter.postedAt > 86_400_000})
						)
					)
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
								Effect.andThen(Effect.logInfo(`Announced chapter ${chapter.number} to ${tokens.length} iPhones`)),
								Effect.ignore({log: 'Warn', message: `Chapter ${chapter.number} was not announced yet`})
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
					}),
					sync
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
