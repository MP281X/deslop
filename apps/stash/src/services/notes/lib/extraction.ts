import {NodeHttpClient} from '@effect/platform-node'

import type {Duration} from 'effect'
import {
	Array,
	Boolean,
	ByteSize,
	Context,
	Effect,
	HashMap,
	HashSet,
	Layer,
	Match,
	Option,
	Order,
	Predicate,
	Random,
	Result,
	Schema,
	Stream,
	String,
	flow,
	pipe
} from 'effect'

import * as cheerio from 'cheerio'
import {HttpClient} from 'effect/http'
import type {HttpClientResponse} from 'effect/http'
import {Dns, NetAddress} from 'effect/net'

import {sourceProxy, sticky} from '#services/media/lib/proxy.ts'
import {pageText} from '#services/notes/lib/page.ts'
import {captureUrl, isYouTube, plainText, sourceFor} from '#services/notes/lib/utils.ts'
import type {FxArticle, FxPost, Image} from '#services/notes/schema.ts'
import {
	Extraction,
	FxConversation,
	FxStatus,
	GitHubComment,
	GitHubIssue,
	GitHubReadme,
	GitHubRepo,
	ImageType,
	NotesError,
	OEmbed,
	Reader,
	TikTokPage
} from '#services/notes/schema.ts'

const CHALLENGE =
	/Just a moment\.\.\.|Verify you are human|Attention Required! \| Cloudflare|Enable JavaScript and cookies to continue|Performing security verification/u

const UNREACHABLE = 'The link could not be loaded.'

const X_LINK = /^https?:\/\/(?:[\w-]+\.)?(?:x|twitter)\.com\//u

// The proxy every request of a Sources method exits through.
const Exit = Context.Reference<Option.Option<string>>('@deslop/stash/services/notes/lib/extraction/Exit', {
	defaultValue: Option.none
})

function timeLimit(duration: Duration.Input, message: string, reason?: NotesError['reason']) {
	return Effect.timeoutOrElse({duration, orElse: () => Effect.fail(NotesError.make({message, reason}))})
}

function isPublic(address: NetAddress.Ipv4Address) {
	const octets = NetAddress.ipv4ToOctets(address)
	return (
		NetAddress.isUnicast(address) &&
		!NetAddress.isPrivate(address) &&
		!NetAddress.isLoopback(address) &&
		!NetAddress.isLinkLocal(address) &&
		octets[0] !== 0 &&
		octets[0] < 224 &&
		!(octets[0] === 100 && octets[1] >= 64 && octets[1] < 128) &&
		!(octets[0] === 192 && octets[1] === 0 && (octets[2] === 0 || octets[2] === 2)) &&
		!(octets[0] === 198 && (octets[1] === 18 || octets[1] === 19)) &&
		!(octets[0] === 198 && octets[1] === 51 && octets[2] === 100) &&
		!(octets[0] === 203 && octets[1] === 0 && octets[2] === 113)
	)
}

function readText(characters: number) {
	return (response: HttpClientResponse.HttpClientResponse) =>
		pipe(
			response.stream,
			Stream.decodeText,
			Stream.scan(
				() => '',
				(total: string, chunk: string) => total + chunk
			),
			Stream.takeUntil(total => String.length(total) >= characters),
			Stream.runLast,
			Effect.map(Option.getOrElse(() => ''))
		)
}

const page = readText(6 * 1024 * 1024)
const api = readText(4 * 1024 * 1024)

function readBytes(response: HttpClientResponse.HttpClientResponse) {
	return pipe(
		response.stream,
		Stream.mapError(cause => NotesError.make({cause, message: 'The preview image could not be read.'})),
		Stream.limitBytes(ByteSize.mebibytes(3), () =>
			Stream.fail(NotesError.make({message: 'The preview image is too large.'}))
		),
		Stream.mkUint8Array
	)
}

// Pinning the checked address stops a rebinding host from reaching the tailnet; the proxy resolves outside it.
const load = Effect.fnUntraced(function* <A, E>(
	url: URL,
	read: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<A, E>
) {
	if (
		(url.protocol !== 'https:' && url.protocol !== 'http:') ||
		String.isNonEmpty(url.username) ||
		Result.isSuccess(NetAddress.ipFromString(url.hostname)) ||
		!String.includes('.')(url.hostname)
	) {
		return yield* NotesError.make({message: 'Only public web links can be read.'})
	}
	const addresses = yield* pipe(
		(yield* Dns.Dns).lookup(url.hostname, {family: 'IPv4'}),
		Effect.mapError(cause => NotesError.make({cause, message: 'The link host could not be found.'}))
	)
	if (!Array.every(addresses, isPublic)) {
		return yield* NotesError.make({message: 'The link points to a private network.'})
	}
	const address = NetAddress.formatIp(Array.headNonEmpty(addresses))
	const session = `${yield* Random.nextIntBetween(10_000_000, 99_999_999)}`
	const proxy = Option.map(yield* Exit, exit => sticky(exit, session))
	return yield* pipe(
		HttpClient.get(url, {
			headers: {
				accept: 'text/html,application/json,image/*',
				'accept-language': 'en-US,en;q=0.9',
				'user-agent': 'Mozilla/5.0 (compatible; DeslopNotes/1.0)'
			}
		}),
		Effect.flatMap(response =>
			Effect.map(Effect.when(read(response), Effect.succeed(response.status === 200)), body => ({
				body,
				location: response.headers['location'],
				status: response.status,
				type: response.headers['content-type'] ?? ''
			}))
		),
		Effect.scoped,
		// @effect-diagnostics-next-line strictEffectProvide:off -- Each request owns an agent pinned to its checked address or its proxy.
		Effect.provide(
			pipe(
				NodeHttpClient.layerNodeHttpNoAgent,
				Layer.provide(
					Option.match(proxy, {
						onNone: () =>
							NodeHttpClient.layerAgentOptions({
								autoSelectFamily: false,
								// oxlint-disable-next-line unicorn/no-null -- Node's lookup callback takes null on success.
								lookup: (_hostname, _options, callback) => callback(null, address, 4)
							}),
						// Expo's types make NODE_ENV required in every environment object.
						onSome: exit =>
							NodeHttpClient.layerAgentOptions({
								proxyEnv: {HTTP_PROXY: exit, HTTPS_PROXY: exit, NODE_ENV: 'production'}
							})
					})
				)
			)
		),
		Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
		Effect.mapError(cause =>
			pipe(
				Option.liftPredicate(cause, Schema.is(NotesError)),
				Option.getOrElse(() => NotesError.make({cause, message: UNREACHABLE, reason: 'Unreachable'}))
			)
		)
	)
})

const follow = Effect.fnUntraced(function* <A, E>(
	url: URL,
	read: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<A, E>,
	hops: number
): Effect.fn.Return<{body: A; type: string; url: URL}, NotesError, Dns.Dns> {
	const proxied = Option.isSome(yield* Exit)
	const answer = yield* pipe(
		load(url, read),
		Effect.filterOrFail(
			// A residential exit can be offline or flagged; each new try gets another exit address.
			found => !proxied || !Array.contains([403, 429, 500, 502, 503], found.status),
			() => NotesError.make({message: UNREACHABLE, reason: 'Unreachable'})
		),
		timeLimit('15 seconds', UNREACHABLE, 'Unreachable'),
		Effect.retry({
			times: Boolean.match(proxied, {onFalse: () => 0, onTrue: () => 2}),
			while: error => error.reason === 'Unreachable'
		})
	)
	if (answer.status >= 300 && answer.status < 400 && answer.location !== undefined) {
		if (hops === 5) return yield* NotesError.make({message: 'The link redirects too often.'})
		return yield* follow(new URL(answer.location, url), read, hops + 1)
	}
	return yield* Option.match(answer.body, {
		onNone: () => Effect.fail(NotesError.make({message: `The link answered with status ${answer.status}.`})),
		onSome: body => Effect.succeed({body, type: answer.type, url})
	})
})

const decode = Effect.fnUntraced(function* <S extends Schema.Constraint>(schema: S, url: URL) {
	return yield* pipe(
		Schema.decodeEffect(Schema.fromJsonString(schema))((yield* follow(url, api, 0)).body),
		Effect.mapError(cause => NotesError.make({cause, message: 'The source answered in an unknown format.'}))
	)
})

function fx<S extends Schema.Constraint>(schema: S, path: string) {
	return decode(schema, new URL(`https://api.fxtwitter.com/2/${path}`))
}

// The conversation answer sometimes drops an article's body; the post's own answer keeps it.
function whole(post: FxStatus['status']) {
	if (post.article === undefined || Array.isReadonlyArrayNonEmpty(post.article.content.blocks)) {
		return Effect.succeed(post)
	}
	return pipe(
		fx(FxStatus, `status/${post.id}`),
		Effect.map(found => found.status),
		Effect.orElseSucceed(() => post)
	)
}

const resolve = Effect.fnUntraced(function* (url: URL, hops: number): Effect.fn.Return<URL, NotesError, Dns.Dns> {
	if (!Array.contains(['vm.tiktok.com', 'vt.tiktok.com', 't.co'], url.hostname)) return url
	const answer = yield* load(url, () => Effect.void)
	if (answer.location === undefined || hops === 5) {
		return yield* NotesError.make({message: 'The short link leads to no post.'})
	}
	return yield* resolve(new URL(answer.location, url), hops + 1)
})

function canonical(url: URL) {
	return captureUrl(url.href) ?? url.href
}

const fromOEmbed = Effect.fnUntraced(function* (endpoint: string, url: URL, title: (embed: OEmbed) => string) {
	const embed = yield* decode(OEmbed, new URL(`${endpoint}${encodeURIComponent(url.href)}`))
	return Extraction.make({
		author: Option.fromUndefinedOr(embed.author_name),
		image: Option.fromNullishOr(embed.thumbnail_url),
		text: plainText(embed.title ?? ''),
		title: title(embed),
		url: canonical(url)
	})
})

const xOEmbed = Effect.fnUntraced(function* (url: URL) {
	const embed = yield* decode(
		OEmbed,
		new URL(`https://publish.x.com/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(url.href)}`)
	)
	return Extraction.make({
		author: Option.fromUndefinedOr(embed.author_name),
		image: Option.none(),
		text: plainText(
			cheerio
				.load(embed.html ?? '')('blockquote p')
				.text()
		),
		title: `${embed.author_name ?? 'A post'} on X`,
		url: canonical(url),
		// Without the thread nothing says whether the post has a video, so yt-dlp tries.
		video: canonical(url)
	})
})

// A block's entity ranges name entityMap entries by their key; links and code blocks live there.
function articleText(article: FxArticle) {
	// findFirst used the first entry when a source repeated a key.
	const entities = HashMap.fromIterable(
		Array.map(Array.reverse(article.content.entityMap), entity => [entity.key, entity] as const)
	)
	const lines = Array.filterMap(article.content.blocks, block => {
		const attached = pipe(
			block.entityRanges,
			Array.filterMap(range =>
				Result.fromOption(
					pipe(
						HashMap.get(entities, `${range.key}`),
						Option.flatMapNullishOr(entity => entity.value.data.markdown ?? entity.value.data.url)
					),
					() => undefined
				)
			)
		)
		const text = pipe([String.trim(block.text), ...attached], Array.filter(String.isNonEmpty), Array.join(' '))
		if (String.isEmpty(text)) return Result.failVoid
		return Result.succeed(
			pipe(
				Match.value(block.type),
				Match.when('header-one', () => `# ${text}`),
				Match.when('header-two', () => `## ${text}`),
				Match.when('header-three', () => `### ${text}`),
				Match.when('unordered-list-item', () => `- ${text}`),
				Match.when('ordered-list-item', () => `1. ${text}`),
				Match.when('blockquote', () => `> ${text}`),
				Match.orElse(() => text)
			)
		)
	})
	return `# ${article.title}\n\n${Array.join(lines, '\n\n')}`
}

// A photo post has no oEmbed and yt-dlp cannot read it, but its page under /video/ holds every slide.
const tikTokPhotos = Effect.fnUntraced(function* (url: URL) {
	const html = yield* follow(new URL(String.replace('/photo/', '/video/')(url.href)), api, 0)
	const item = (yield* pipe(
		Schema.decodeEffect(Schema.fromJsonString(TikTokPage))(
			cheerio.load(html.body)('#__UNIVERSAL_DATA_FOR_REHYDRATION__').text()
		),
		Effect.mapError(cause =>
			NotesError.make({cause, message: 'The TikTok photo post is unreadable.', reason: 'UnreadablePhoto'})
		)
	)).__DEFAULT_SCOPE__['webapp.video-detail'].itemInfo.itemStruct
	const images = Array.filterMap(item.imagePost.images, image =>
		Result.fromOption(Array.head(image.imageURL.urlList), () => undefined)
	)
	return Extraction.make({
		author: Option.some(item.author.nickname),
		image: Array.head(images),
		slides: Array.drop(images, 1),
		text: pipe(
			[item.imagePost.title, item.desc],
			Array.filter(Predicate.isNotUndefined),
			Array.map(plainText),
			Array.filter(String.isNonEmpty),
			Array.join('\n')
		),
		title: `${item.author.nickname} on TikTok`,
		url: canonical(url)
	})
})

const issue = Effect.fnUntraced(function* (url: URL, repository: string, number: string) {
	const found = yield* decode(GitHubIssue, new URL(`https://api.github.com/repos/${repository}/issues/${number}`))
	const comments = yield* decode(
		Schema.Array(GitHubComment),
		new URL(`https://api.github.com/repos/${repository}/issues/${number}/comments?per_page=100`)
	)
	return Extraction.make({
		author: Option.some(found.user.login),
		image: Option.some(`https://opengraph.githubassets.com/1/${repository}/issues/${number}`),
		text: pipe(
			[found, ...comments],
			Array.map(post => Option.map(Option.fromNullishOr(post.body), body => `**${post.user.login}**: ${body}`)),
			Array.getSomes,
			Array.prepend(`# ${found.title} (${found.state})`),
			Array.join('\n\n')
		),
		title: found.title,
		url: canonical(url)
	})
})

const repository = Effect.fnUntraced(function* (url: URL, name: string) {
	const found = yield* decode(GitHubRepo, new URL(`https://api.github.com/repos/${name}`))
	const readme = yield* pipe(
		decode(GitHubReadme, new URL(`https://api.github.com/repos/${name}/readme`)),
		Effect.flatMap(file => follow(new URL(file.download_url), api, 0)),
		Effect.map(file => file.body),
		// A repository without a README answers 404; the note keeps the description and topics.
		Effect.option
	)
	return Extraction.make({
		author: Option.some(found.owner.login),
		image: Option.some(`https://opengraph.githubassets.com/1/${name}`),
		text: pipe(
			[
				Option.fromNullishOr(found.description),
				pipe(
					Option.fromNullishOr(found.topics),
					Option.filter(Array.isReadonlyArrayNonEmpty),
					Option.map(topics => `Topics: ${Array.join(topics, ', ')}`)
				),
				Option.fromNullishOr(found.homepage),
				readme
			],
			Array.getSomes,
			Array.filter(String.isNonEmpty),
			Array.join('\n\n')
		),
		title: found.full_name,
		url: canonical(url)
	})
})

const gitHub = Effect.fnUntraced(function* (url: URL) {
	const path = Array.filter(String.split(url.pathname, '/'), String.isNonEmpty)
	const name = Array.join(Array.take(path, 2), '/')
	if (path.length === 2) return yield* repository(url, name)
	return yield* pipe(
		Option.all([Array.get(path, 2), Array.get(path, 3)]),
		Option.filter(parts => parts[0] === 'issues' || parts[0] === 'pull'),
		Option.match({
			onNone: () => Effect.fail(NotesError.make({message: 'The GitHub page is neither a repository nor an issue.'})),
			onSome: parts => issue(url, name, parts[1])
		})
	)
})

const reader = Effect.fnUntraced(function* (url: URL) {
	const answer = yield* pipe(
		decode(Reader, new URL(`https://r.jina.ai/${url.href}`)),
		timeLimit('30 seconds', 'The reader took too long.')
	)
	if (CHALLENGE.test(answer.data.content) || String.isEmpty(String.trim(answer.data.content))) {
		return yield* NotesError.make({message: 'The site blocks automated reading.'})
	}
	return Extraction.make({
		author: Option.some(url.hostname),
		image: Option.none(),
		text: answer.data.content,
		title: plainText(answer.data.title),
		url: canonical(url)
	})
})

function readable(found: {body: string; type: string; url: URL}) {
	if (!String.includes('text/html')(String.toLowerCase(found.type))) return Option.none<Extraction>()
	return Option.liftPredicate(pageText(found.body, found.url), extraction => String.isNonEmpty(extraction.text))
}

// A blocked page, a bot check, a page without text or a page that is mostly script and renders its text in the browser goes to the reader.
const readPage = Effect.fnUntraced(function* (url: URL) {
	const loaded = yield* pipe(
		follow(url, page, 0),
		Effect.filterOrFail(
			found => !CHALLENGE.test(found.body),
			() => NotesError.make({message: 'The site answered with a bot check.'})
		),
		Effect.result
	)
	return yield* Result.match(loaded, {
		onFailure: error => Effect.mapError(reader(url), () => error),
		onSuccess: found =>
			Option.match(readable(found), {
				onNone: () => reader(url),
				onSome: extraction =>
					Boolean.match(String.length(extraction.text) * 40 < String.length(found.body), {
						onFalse: () => Effect.succeed(extraction),
						onTrue: () =>
							pipe(
								reader(url),
								Effect.map(rendered => ({...rendered, author: extraction.author, image: extraction.image})),
								Effect.orElseSucceed(() => extraction)
							)
					})
			})
	})
})

const byTime = Order.mapInput(Order.Number, (post: FxPost) => post.created_timestamp)

const byLikes = Order.mapInput(Order.flip(Order.Number), (post: FxPost) => post.likes ?? 0)

function said(post: FxPost) {
	return pipe(
		[
			`**${post.author.name} (@${post.author.screen_name})**: ${plainText(post.text)}`,
			Option.match(Option.fromNullishOr(post.article), {onNone: () => '', onSome: articleText})
		],
		Array.filter(String.isNonEmpty),
		Array.join('\n\n')
	)
}

function section(title: string, entries: string[]) {
	if (Array.isReadonlyArrayEmpty(entries)) return ''
	return `## ${title}\n\n${Array.join(entries, '\n\n')}`
}

function photosOf(post: FxPost) {
	return [
		...pipe(
			post.media?.all ?? [],
			Array.filter(item => item.type === 'photo'),
			Array.map(item => item.url)
		),
		...Array.getSomes(
			Array.map(post.article?.media_entities ?? [], entity =>
				Option.fromUndefinedOr(entity.media_info.original_img_url)
			)
		)
	]
}

function linksOf(post: FxPost) {
	return Array.getSomes(Array.map(post.raw_text?.facets ?? [], facet => Option.fromUndefinedOr(facet.replacement)))
}

// A linked article or repository often holds what the post only points at.
function readLinked(url: URL) {
	return pipe(
		Boolean.match(url.hostname === 'github.com', {
			onFalse: () => readPage(url),
			onTrue: () => Effect.catch(gitHub(url), () => readPage(url))
		}),
		Effect.map(found => `### ${found.title}\n\n${found.url}\n\n${String.slice(0, 40_000)(found.text)}`),
		timeLimit('40 seconds', 'The linked page took too long.'),
		Effect.option
	)
}

// The saved post with the posts it answers, the author's follow-ups, the quoted post or article, linked posts and pages, and the most liked replies.
const xThread = Effect.fnUntraced(function* (url: URL) {
	const id = yield* pipe(
		String.match(/\/status\/(\d+)/u)(url.pathname),
		Option.flatMap(match => Array.get(match, 1)),
		Effect.fromOption,
		Effect.mapError(() => NotesError.make({message: 'The link names no post.'}))
	)
	const conversation = yield* fx(FxConversation, `conversation/${id}`)
	const status = yield* whole(conversation.status)
	const quote = yield* Effect.transposeOption(Option.map(Option.fromNullishOr(status.quote), whole))
	const replies = conversation.replies ?? []
	const byId = HashMap.fromIterable(Array.map(Array.reverse(replies), post => [post.id, post] as const))
	// The author's follow-ups answer the saved post or an earlier follow-up; the author's answers to readers stay replies.
	const followUps = pipe(
		Array.sort(
			Array.filter(replies, post => post.author.id === status.author.id),
			byTime
		),
		Array.mapAccum(HashSet.make(status.id), (chain, post) => {
			if (!HashSet.has(chain, post.replying_to?.status ?? '')) return [chain, Option.none<FxPost>()] as const
			return [HashSet.add(chain, post.id), Option.some(post)] as const
		}),
		result => Array.getSomes(result[1])
	)
	const earlier = Array.sort(
		Array.filter(conversation.thread ?? [], post => post.id !== status.id),
		byTime
	)
	const shown = [status, ...followUps, ...Option.toArray(quote)]
	// The posts above the saved one come after it, so its own links and photos lead.
	const context = [...shown, ...earlier]
	const contextIds = HashSet.fromIterable(Array.map(context, post => post.id))
	const followUpIds = HashSet.fromIterable(Array.map(followUps, post => post.id))
	const links = Array.dedupe(Array.flatMap(context, linksOf))
	const linked = yield* Effect.all(
		{
			pages: Effect.forEach(
				pipe(
					links,
					Array.filter(link => !X_LINK.test(link)),
					Array.filterMap(link => Result.fromOption(Option.liftThrowable(() => new URL(link))(), () => undefined)),
					Array.take(3)
				),
				readLinked,
				{concurrency: 'unbounded'}
			),
			posts: Effect.forEach(
				pipe(
					links,
					Array.filterMap(link =>
						Result.fromOption(
							pipe(
								String.match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/u)(link),
								Option.flatMap(match => Array.get(match, 1))
							),
							() => undefined
						)
					),
					Array.filter(linkedId => !HashSet.has(contextIds, linkedId)),
					Array.dedupe,
					Array.take(5)
				),
				linkedId => Effect.option(Effect.map(fx(FxStatus, `status/${linkedId}`), found => found.status)),
				{concurrency: 'unbounded'}
			)
		},
		{concurrency: 'unbounded'}
	)
	const posts = Array.getSomes(linked.posts)
	const media = Array.flatMap(shown, post => post.media?.all ?? [])
	const photos = Array.dedupe(Array.flatMap([...context, ...posts], photosOf))
	return Extraction.make({
		author: Option.some(status.author.name),
		image: Option.orElse(Array.head(photos), () =>
			Option.map(Array.head(media), item => item.thumbnail_url ?? item.url)
		),
		slides: Array.take(Array.drop(photos, 1), 30),
		text: pipe(
			[
				section('Earlier in the conversation', Array.map(earlier, said)),
				said(status),
				...Array.map(followUps, post => plainText(post.text)),
				Option.match(quote, {onNone: () => '', onSome: post => `Quoting ${said(post)}`}),
				section('Linked posts', Array.map(posts, said)),
				section('Linked pages', Array.getSomes(linked.pages)),
				section(
					"The author's answers to readers",
					pipe(
						replies,
						Array.filter(post => post.author.id === status.author.id && !HashSet.has(followUpIds, post.id)),
						Array.sort(byTime),
						Array.map(answer =>
							Option.match(
								Option.flatMap(Option.fromNullishOr(answer.replying_to?.status), parentId =>
									HashMap.get(byId, parentId)
								),
								{
									onNone: () => plainText(answer.text),
									onSome: question =>
										`**${question.author.name} (@${question.author.screen_name})** wrote: ${plainText(question.text)}\nThe author answered: ${plainText(answer.text)}`
								}
							)
						)
					)
				),
				section(
					'Replies',
					pipe(
						replies,
						Array.filter(post => post.author.id !== status.author.id),
						Array.sort(byLikes),
						Array.take(40),
						// Likes tell the AI which replies readers agreed with.
						Array.map(
							post =>
								`**${post.author.name} (@${post.author.screen_name})**${Option.match(
									Option.fromUndefinedOr(post.likes),
									{onNone: () => '', onSome: likes => `, ${likes} likes`}
								)}: ${plainText(post.text)}`
						)
					)
				)
			],
			Array.filter(String.isNonEmpty),
			Array.join('\n\n')
		),
		title: `${status.author.name} on X`,
		url: canonical(url),
		...pipe(
			// A clip with speech says more than a looping GIF beside it.
			Array.findFirst(media, item => item.type === 'video'),
			Option.orElse(() => Array.findFirst(media, item => item.type === 'gif')),
			Option.match({onNone: () => ({}), onSome: item => ({video: item.url})})
		)
	})
})

export class Sources extends Context.Service<
	Sources,
	{
		readonly extract: (url: string) => Effect.Effect<Extraction, NotesError>
		readonly image: (url: string) => Effect.Effect<Image, NotesError>
		readonly resolve: (url: string) => Effect.Effect<string, NotesError>
	}
>()('@deslop/stash/services/notes/lib/extraction/Sources') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const through = flow(
				Effect.provideService(Exit, yield* sourceProxy),
				Effect.provideService(Dns.Dns, yield* Dns.Dns)
			)

			return Sources.of({
				extract: Effect.fn('Sources.extract')(
					function* (link) {
						const url = yield* resolve(new URL(link), 0)
						const source = sourceFor(url.href)
						// TikTok answers some exits with a login page instead of the post.
						if (source === 'TikTok' && String.includes('/photo/')(url.pathname)) {
							return yield* Effect.retry(tikTokPhotos(url), {
								times: Boolean.match(Option.isSome(yield* Exit), {onFalse: () => 0, onTrue: () => 2}),
								while: error => error.reason === 'UnreadablePhoto'
							})
						}
						if (source === 'TikTok') {
							return yield* fromOEmbed(
								'https://www.tiktok.com/oembed?url=',
								url,
								embed => `${embed.author_name ?? 'A video'} on TikTok`
							)
						}
						if (source === 'X') return yield* Effect.catch(xThread(url), () => xOEmbed(url))
						// YouTube answers a datacenter address with a bot check, but its oEmbed still answers.
						if (isYouTube(url.href)) {
							return yield* fromOEmbed('https://www.youtube.com/oembed?format=json&url=', url, embed =>
								plainText(embed.title ?? 'A YouTube video')
							)
						}
						if (url.hostname === 'github.com') return yield* Effect.catch(gitHub(url), () => readPage(url))
						return yield* readPage(url)
					},
					timeLimit('2 minutes', 'Reading the link took too long.'),
					through
				),
				image: Effect.fn('Sources.image')(
					function* (link) {
						const url = yield* Effect.try({
							catch: cause => NotesError.make({cause, message: 'The preview image link is invalid.'}),
							try: () => new URL(link)
						})
						const image = yield* follow(url, readBytes, 0)
						const type = yield* pipe(
							image.type,
							String.split(';'),
							Array.head,
							Option.map(String.trim),
							Option.filter(Schema.is(ImageType)),
							Effect.fromOption,
							Effect.mapError(() => NotesError.make({message: 'The preview is not a JPEG, PNG, WebP or GIF image.'}))
						)
						return {bytes: image.body, type}
					},
					timeLimit('15 seconds', 'Loading the preview image took too long.'),
					through
				),
				resolve: Effect.fn('Sources.resolve')(
					function* (link) {
						return canonical(yield* resolve(new URL(link), 0))
					},
					timeLimit('15 seconds', 'The short link took too long to answer.'),
					through
				)
			})
		})
	)
}
