import {NodeHttpClient} from '@effect/platform-node'

import {
	Array,
	Boolean,
	Clock,
	Config,
	Context,
	Effect,
	FileSystem,
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
import {byNumber, nameOf, pagesOf, postFrom, seriesOf} from '#services/chapters/lib/utils.ts'
import type {Chapter, ChaptersEvent, Post, PushToken, ReadingUpdate} from '#services/chapters/schema.ts'
import {ChaptersError, CubariSeries, PushTickets} from '#services/chapters/schema.ts'

// Reddit's JSON answers 403 to servers even through the proxy; its Atom search feed answers.
const FEED =
	'https://www.reddit.com/r/OnePunchMan/search.rss?q=title%3Achapter+english&restrict_sr=1&sort=new&limit=100'
const BROWSER =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

const INDEX = 'https://cubari.moe/read/gist/OPM/'

const newestFirst = Order.flip(byNumber)

function failed(message: string) {
	return Effect.mapError((cause: unknown) => ChaptersError.make({cause, message}))
}

function fromIndex(chapter: Chapter) {
	return String.startsWith(INDEX)(chapter.source)
}

// A chapter joins the list once; only an explicit revision replaces its pages, so a second translation never moves a reader's page.
function merge(current: Chapter[], chapter: Chapter) {
	return Option.match(
		Array.findFirst(current, item => item.number === chapter.number),
		{
			onNone: () => Array.sort([...current, chapter], newestFirst),
			onSome: found =>
				change(current, found.number, item => ({
					...item,
					pages: chapter.pages,
					revisedAt: chapter.postedAt,
					source: chapter.source
				}))
		}
	)
}

function change(chapters: Chapter[], number: number, update: (chapter: Chapter) => Chapter) {
	return Array.map(chapters, item =>
		Boolean.match(item.number === number, {onFalse: () => item, onTrue: () => update(item)})
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
				const store = yield* openStore(`${directory}/opm.db`)
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
						source: post.link,
						title: nameOf(answer.chapters[target.chapter]?.title ?? '')
					} satisfies Chapter
				})

				// Every change replaces only the chapters it touches, so the rest keep their identity and are not written again.
				function save(apply: (current: Chapter[]) => Chapter[]) {
					return Effect.uninterruptible(
						SubscriptionRef.updateEffect(state, current => {
							const next = apply(current)
							return Effect.as(
								store.save(Array.filter(next, chapter => !Array.some(current, item => item === chapter))),
								next
							)
						})
					)
				}

				// The community's index of every chapter up to 230; Reddit holds the ones after it.
				const backfill = Effect.gen(function* () {
					const index = yield* series('https://cubari.moe/read/api/gist/series/OPM/')
					const chapters = pipe(
						Record.toEntries(index.chapters),
						Array.map(entry =>
							pipe(
								Option.all({
									number: Number.parse(entry[0]),
									pages: pagesOf(index, entry[0]),
									postedAt: Option.some(
										Option.getOrElse(Array.head(Record.values(entry[1].release_date ?? {})), () => 0) * 1000
									)
								}),
								Option.map(found => ({
									...found,
									notified: true,
									source: `${INDEX}${entry[0]}/1/`,
									title: nameOf(entry[1].title ?? '')
								}))
							)
						),
						Array.getSomes
					)
					// Only the numbers still missing: a chapter Reddit already supplied keeps its pages.
					yield* save(current =>
						Array.reduce(
							Array.filter(chapters, chapter => !Array.some(current, item => item.number === chapter.number)),
							current,
							merge
						)
					)
					yield* Effect.logInfo(`Backfilled ${chapters.length} chapters from the community index`)
				})

				const sync = Effect.gen(function* () {
					// The index fills the back catalogue once; a failed read is tried again next round.
					if (!Array.some(yield* SubscriptionRef.get(state), fromIndex)) {
						yield* pipe(backfill, Effect.ignore({log: 'Warn', message: 'The community index was not read'}))
					}
					const posts = postsOf(yield* feed)
					const known = yield* SubscriptionRef.get(state)
					const now = yield* Clock.currentTimeMillis
					const found = yield* Effect.forEach(
						// The first post of a new chapter, or a later explicit revision of a known one with other pages.
						Array.reduce(posts, Array.empty<Post>(), (chosen, post) => {
							const existing = Array.findFirst(known, item => item.number === post.number)
							const fresh = Option.isNone(existing) && !Array.some(chosen, item => item.number === post.number)
							const revision =
								post.revised &&
								Option.exists(
									existing,
									item => post.postedAt > (item.revisedAt ?? item.postedAt) && item.source !== post.link
								)
							if (fresh || revision) return Array.append(chosen, post)
							return chosen
						}),
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
								data: {chapter: chapter.number},
								sound: 'default',
								threadId: 'chapters',
								title: `Chapter ${chapter.number}`,
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
								Effect.andThen(save(chapters => change(chapters, chapter.number, item => ({...item, notified: true})))),
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
												Array.filter(current, chapter => !Array.some(before, item => item === chapter)),
												Array.match({
													onEmpty: () => Array.empty<ChaptersEvent>(),
													onNonEmpty: changed => [
														{reset: false, upserted: Array.map(changed, Struct.omit(['notified']))}
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
							change(chapters, update.number, item => ({...item, reading: {at, done: update.done, page: update.page}}))
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
