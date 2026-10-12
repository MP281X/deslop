// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's platform has no DNS API, and the checked address is pinned for the connection.
import {lookup} from 'node:dns/promises'

import {NodeHttpClient} from '@effect/platform-node'

import type {Duration} from 'effect'
import {
	Array,
	ByteSize,
	Context,
	Effect,
	Layer,
	Match,
	Option,
	Order,
	Random,
	Record,
	Result,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import * as cheerio from 'cheerio'
import {HttpClient} from 'effect/http'
import type {HttpClientResponse} from 'effect/http'
import {NetAddress} from 'effect/net'

import {sourceProxy, sticky} from '#services/media/lib/utils.ts'
import {captureUrl, isYouTube, plainText, sourceFor} from '#services/notes/lib/utils.ts'
import type {Image} from '#services/notes/schema.ts'
import {Extraction, ImageType, NotesError} from '#services/notes/schema.ts'

const shortHosts = ['vm.tiktok.com', 'vt.tiktok.com', 't.co']

// The proxy every request of a Sources method exits through.
const Exit = Context.Reference<Option.Option<string>>('@deslop/stash/services/notes/internal/extraction/Exit', {
	defaultValue: Option.none
})

function timeLimit(duration: Duration.Input, message: string) {
	return Effect.timeoutOrElse({duration, orElse: () => Effect.fail(NotesError.make({message}))})
}

type FxPost = typeof FxPost.Type
const FxPost = Schema.Struct({
	author: Schema.Struct({id: Schema.String, name: Schema.String, screen_name: Schema.String}),
	created_timestamp: Schema.Finite,
	id: Schema.String,
	media: Schema.optionalKey(
		Schema.Struct({
			all: Schema.optionalKey(
				Schema.Array(
					Schema.Struct({thumbnail_url: Schema.optionalKey(Schema.String), type: Schema.String, url: Schema.String})
				)
			)
		})
	),
	raw_text: Schema.optionalKey(
		Schema.Struct({facets: Schema.Array(Schema.Struct({replacement: Schema.optionalKey(Schema.String)}))})
	),
	text: Schema.String
})

type FxArticle = typeof FxArticle.Type
const FxArticle = Schema.Struct({
	content: Schema.Struct({
		blocks: Schema.Array(
			Schema.Struct({
				entityRanges: Schema.Array(Schema.Struct({key: Schema.Finite})),
				text: Schema.String,
				type: Schema.String
			})
		),
		entityMap: Schema.Array(
			Schema.Struct({
				key: Schema.String,
				value: Schema.Struct({
					data: Schema.Struct({markdown: Schema.optionalKey(Schema.String), url: Schema.optionalKey(Schema.String)}),
					type: Schema.String
				})
			})
		)
	}),
	title: Schema.String
})

type FxStatus = typeof FxStatus.Type
const FxStatus = Schema.Struct({
	status: Schema.Struct({...FxPost.fields, article: Schema.optionalKey(FxArticle), quote: Schema.optionalKey(FxPost)})
})

// `thread` holds the posts above the saved one and the saved post itself; `replies` holds the posts below it.
type FxConversation = typeof FxConversation.Type
const FxConversation = Schema.Struct({
	...FxStatus.fields,
	replies: Schema.optionalKey(Schema.Array(FxPost)),
	thread: Schema.optionalKey(Schema.Array(FxPost))
})

type OEmbed = typeof OEmbed.Type
const OEmbed = Schema.Struct({
	author_name: Schema.optionalKey(Schema.String),
	html: Schema.optionalKey(Schema.String),
	thumbnail_url: Schema.optionalKey(Schema.String),
	title: Schema.optionalKey(Schema.String)
})

type TikTokPage = typeof TikTokPage.Type
const TikTokPage = Schema.Struct({
	__DEFAULT_SCOPE__: Schema.Struct({
		'webapp.video-detail': Schema.Struct({
			itemInfo: Schema.Struct({
				itemStruct: Schema.Struct({
					author: Schema.Struct({nickname: Schema.String}),
					desc: Schema.String,
					imagePost: Schema.Struct({
						images: Schema.Array(Schema.Struct({imageURL: Schema.Struct({urlList: Schema.Array(Schema.String)})})),
						title: Schema.optionalKey(Schema.String)
					})
				})
			})
		})
	})
})

type GitHubRepo = typeof GitHubRepo.Type
const GitHubRepo = Schema.Struct({
	description: Schema.NullOr(Schema.String),
	full_name: Schema.String,
	homepage: Schema.optionalKey(Schema.NullOr(Schema.String)),
	owner: Schema.Struct({login: Schema.String}),
	topics: Schema.optionalKey(Schema.Array(Schema.String))
})

type GitHubComment = typeof GitHubComment.Type
const GitHubComment = Schema.Struct({body: Schema.NullOr(Schema.String), user: Schema.Struct({login: Schema.String})})

type GitHubIssue = typeof GitHubIssue.Type
const GitHubIssue = Schema.Struct({...GitHubComment.fields, state: Schema.String, title: Schema.String})

type Reader = typeof Reader.Type
const Reader = Schema.Struct({data: Schema.Struct({content: Schema.String, title: Schema.String})})

const challenge =
	/Just a moment\.\.\.|Verify you are human|Attention Required! \| Cloudflare|Enable JavaScript and cookies to continue|Performing security verification/u

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

const page = readText(512 * 1024)
const api = readText(4 * 1024 * 1024)

type AgentOptions = Parameters<typeof NodeHttpClient.layerAgentOptions>[0]

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

// DNS is resolved once and the connection pinned to the checked address, so a rebinding host cannot reach the tailnet.
// Through the proxy, the proxy resolves the host outside the tailnet.
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
	const resolved = yield* Effect.tryPromise({
		catch: cause => NotesError.make({cause, message: 'The link host could not be found.'}),
		try: () => lookup(url.hostname, {all: true, family: 4})
	})
	const addresses = Array.map(resolved, entry => entry.address)
	const allPublic = Array.every(addresses, address =>
		pipe(
			NetAddress.ipv4FromString(address),
			Result.map(isPublic),
			Result.getOrElse(() => false)
		)
	)
	if (!Array.isReadonlyArrayNonEmpty(addresses) || !allPublic) {
		return yield* NotesError.make({message: 'The link points to a private network.'})
	}
	const address = Array.headNonEmpty(addresses)
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
			Effect.map(response.status === 200 ? Effect.asSome(read(response)) : Effect.succeed(Option.none<A>()), body => ({
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
					NodeHttpClient.layerAgentOptions(
						Option.match(proxy, {
							onNone: (): AgentOptions => ({
								autoSelectFamily: false,
								// oxlint-disable-next-line unicorn/no-null -- Node's lookup callback takes null on success.
								lookup: (_hostname, _options, callback) => callback(null, address, 4)
							}),
							// Expo's types make NODE_ENV required in every environment object.
							onSome: (exit): AgentOptions => ({
								proxyEnv: {HTTP_PROXY: exit, HTTPS_PROXY: exit, NODE_ENV: 'production'}
							})
						})
					)
				)
			)
		),
		Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
		Effect.mapError(cause => (Schema.is(NotesError)(cause) ? cause : NotesError.make({cause, message: unreachable})))
	)
})

// A residential exit can be offline or flagged; each new try gets another exit address.
const blockedStatuses = [403, 429, 500, 502, 503]

const unreachable = 'The link could not be loaded.'

const follow = Effect.fnUntraced(function* <A, E>(
	url: URL,
	read: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<A, E>,
	hops: number
): Effect.fn.Return<{body: A; type: string; url: URL}, NotesError> {
	const proxied = Option.isSome(yield* Exit)
	const answer = yield* pipe(
		load(url, read),
		Effect.filterOrFail(
			found => !proxied || !Array.contains(blockedStatuses, found.status),
			() => NotesError.make({message: unreachable})
		),
		timeLimit('15 seconds', unreachable),
		Effect.retry({times: proxied ? 2 : 0, while: error => error.message === unreachable})
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

const resolve = Effect.fnUntraced(function* (url: URL, hops: number): Effect.fn.Return<URL, NotesError> {
	if (!Array.contains(shortHosts, url.hostname)) return url
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
		author: embed.author_name ?? '',
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
		author: embed.author_name ?? '',
		image: Option.none(),
		text: plainText(
			cheerio
				.load(embed.html ?? '')('blockquote p')
				.text()
		),
		title: `${embed.author_name ?? 'A post'} on X`,
		url: canonical(url)
	})
})

// A block's entity ranges name entityMap entries by their key; links and code blocks live there.
function articleText(article: FxArticle) {
	const lines = Array.filterMap(article.content.blocks, block => {
		const attached = pipe(
			block.entityRanges,
			Array.filterMap(range =>
				Result.fromOption(
					pipe(
						Array.findFirst(article.content.entityMap, entity => entity.key === `${range.key}`),
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

const byTime = Order.mapInput(Order.Number, (post: FxPost) => post.created_timestamp)

function said(post: FxStatus['status']) {
	return pipe(
		[
			`**${post.author.name} (@${post.author.screen_name})**: ${plainText(post.text)}`,
			Option.match(Option.fromNullishOr(post.article), {onNone: () => '', onSome: articleText})
		],
		Array.filter(String.isNonEmpty),
		Array.join('\n\n')
	)
}

function section(title: string, posts: FxStatus['status'][]) {
	if (Array.isReadonlyArrayEmpty(posts)) return ''
	return `## ${title}\n\n${Array.join(Array.map(posts, said), '\n\n')}`
}

// The saved post with the posts it answers, the author's follow-ups, quoted and linked posts, and the top replies.
const xThread = Effect.fnUntraced(function* (url: URL) {
	const id = yield* pipe(
		String.match(/\/status\/(\d+)/u)(url.pathname),
		Option.flatMap(match => Array.get(match, 1)),
		Effect.fromOption,
		Effect.mapError(() => NotesError.make({message: 'The link names no post.'}))
	)
	const conversation = yield* decode(FxConversation, new URL(`https://api.fxtwitter.com/2/conversation/${id}`))
	const status = conversation.status
	const quote = Option.fromNullishOr(status.quote)
	const media = Array.flatMap([status, ...Option.toArray(quote)], (post: FxPost) => post.media?.all ?? [])
	const replies = conversation.replies ?? []
	const linked = yield* Effect.forEach(
		pipe(
			status.raw_text?.facets ?? [],
			Array.filterMap(facet =>
				Result.fromOption(
					pipe(
						Option.fromNullishOr(facet.replacement),
						Option.flatMap(String.match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/u)),
						Option.flatMap(match => Array.get(match, 1))
					),
					() => undefined
				)
			),
			Array.filter(linkedId => linkedId !== status.id && !Option.exists(quote, post => post.id === linkedId)),
			Array.dedupe,
			Array.take(5)
		),
		linkedId =>
			Effect.option(
				Effect.map(decode(FxStatus, new URL(`https://api.fxtwitter.com/2/status/${linkedId}`)), found => found.status)
			)
	)
	return Extraction.make({
		author: status.author.name,
		image: Option.map(Array.head(media), item => item.thumbnail_url ?? item.url),
		text: pipe(
			[
				section(
					'Earlier in the conversation',
					Array.sort(
						Array.filter(conversation.thread ?? [], post => post.id !== status.id),
						byTime
					)
				),
				plainText(status.text),
				...pipe(
					Array.filter(replies, post => post.author.id === status.author.id),
					Array.sort(byTime),
					Array.map(post => plainText(post.text))
				),
				Option.match(quote, {onNone: () => '', onSome: post => `Quoting ${said(post)}`}),
				Option.match(Option.fromNullishOr(status.article), {onNone: () => '', onSome: articleText}),
				section('Linked posts', Array.getSomes(linked)),
				section(
					'Replies',
					Array.take(
						Array.filter(replies, post => post.author.id !== status.author.id),
						30
					)
				)
			],
			Array.filter(String.isNonEmpty),
			Array.join('\n\n')
		),
		title: `${status.author.name} on X`,
		url: canonical(url),
		...pipe(
			Array.findFirst(media, item => item.type === 'video' || item.type === 'gif'),
			Option.match({onNone: () => ({}), onSome: item => ({video: item.url})})
		)
	})
})

// A photo post has no oEmbed and yt-dlp cannot read it, but its page under /video/ holds every slide.
const tikTokPhotos = Effect.fnUntraced(function* (url: URL) {
	const html = yield* follow(new URL(String.replace('/photo/', '/video/')(url.href)), api, 0)
	const item = (yield* pipe(
		Schema.decodeEffect(Schema.fromJsonString(TikTokPage))(
			cheerio.load(html.body)('#__UNIVERSAL_DATA_FOR_REHYDRATION__').text()
		),
		Effect.mapError(cause => NotesError.make({cause, message: 'The TikTok photo post is unreadable.'}))
	)).__DEFAULT_SCOPE__['webapp.video-detail'].itemInfo.itemStruct
	const images = Array.filterMap(item.imagePost.images, image =>
		Result.fromOption(Array.head(image.imageURL.urlList), () => undefined)
	)
	return Extraction.make({
		author: item.author.nickname,
		image: Array.head(images),
		slides: Array.drop(images, 1),
		text: pipe(
			[item.imagePost.title ?? '', item.desc],
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
		author: found.user.login,
		image: Option.some(`https://opengraph.githubassets.com/1/${repository}/issues/${number}`),
		text: pipe(
			[
				`# ${found.title} (${found.state})`,
				`**${found.user.login}**: ${found.body ?? ''}`,
				...Array.map(comments, comment => `**${comment.user.login}**: ${comment.body ?? ''}`)
			],
			Array.join('\n\n')
		),
		title: found.title,
		url: canonical(url)
	})
})

const repository = Effect.fnUntraced(function* (url: URL, name: string) {
	const found = yield* decode(GitHubRepo, new URL(`https://api.github.com/repos/${name}`))
	const readme = yield* pipe(
		decode(Schema.Struct({download_url: Schema.String}), new URL(`https://api.github.com/repos/${name}/readme`)),
		Effect.flatMap(file => follow(new URL(file.download_url), api, 0)),
		Effect.map(file => file.body),
		Effect.orElseSucceed(() => '')
	)
	return Extraction.make({
		author: found.owner.login,
		image: Option.some(`https://opengraph.githubassets.com/1/${name}`),
		text: pipe(
			[
				found.description ?? '',
				pipe(
					Option.fromNullishOr(found.topics),
					Option.filter(Array.isReadonlyArrayNonEmpty),
					Option.match({onNone: () => '', onSome: topics => `Topics: ${Array.join(topics, ', ')}`})
				),
				found.homepage ?? '',
				readme
			],
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

type Node = Parameters<typeof cheerio.contains>[1]

const headings: Record.ReadonlyRecord<string, number> = {h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6}

const blockTags = [
	'article',
	'aside',
	'blockquote',
	'dd',
	'details',
	'div',
	'dl',
	'dt',
	'figure',
	'main',
	'p',
	'section',
	'table'
]

function markdown($: cheerio.CheerioAPI, node: Node, base: URL): string {
	if (node.nodeType === 3) return String.replace(/\s+/gu, ' ')(node.data)
	if (!('tagName' in node)) return ''
	const inner = pipe(
		$(node).contents().toArray(),
		Array.map(child => markdown($, child, base)),
		Array.join('')
	)
	return pipe(
		Record.get(headings, node.tagName),
		Option.map(level => `\n\n${String.repeat(level)('#')} ${String.trim(inner)}\n\n`),
		Option.getOrElse(() => element($, {base, inner, node, tag: node.tagName}))
	)
}

function element($: cheerio.CheerioAPI, input: {base: URL; inner: string; node: Node; tag: string}) {
	const node = input.node
	const text = String.trim(input.inner)
	return pipe(
		Match.value(input.tag),
		Match.when('li', () => {
			const marker = $(node).parent().is('ol') ? `${$(node).index() + 1}.` : '-'
			return `\n${String.repeat($(node).parents('ul, ol').length - 1)('  ')}${marker} ${text}`
		}),
		Match.when('pre', () => `\n\n\`\`\`\n${$(node).text()}\n\`\`\`\n\n`),
		Match.when('code', () => `\`${text}\``),
		Match.when('br', () => '\n'),
		Match.when('tr', () => `\n${text}`),
		Match.when(
			name => name === 'td' || name === 'th',
			() => `${text} | `
		),
		Match.when('a', () =>
			pipe(
				Option.fromNullishOr($(node).attr('href')),
				Option.flatMap(Option.liftThrowable(href => new URL(href, input.base))),
				Option.filter(link => (link.protocol === 'https:' || link.protocol === 'http:') && String.isNonEmpty(text)),
				Option.match({onNone: () => input.inner, onSome: link => `[${text}](${link.href})`})
			)
		),
		Match.when(
			name => Array.contains(blockTags, name),
			() => `\n\n${text}\n\n`
		),
		Match.orElse(() => input.inner)
	)
}

// The article's text as Markdown, so the AI keeps its headings, lists and link targets.
export function pageText(html: string, url: URL) {
	const $ = cheerio.load(html)
	$('script, style, noscript, iframe, svg, nav, header, footer, form, aside, button, dialog, template').remove()
	const description =
		$('meta[property="og:description"]').attr('content') ?? $('meta[name="description"]').attr('content')
	const root = pipe(
		['article', 'main', '[role="main"]'],
		Array.map(selector => $(selector).first()),
		Array.findFirst(found => String.length(plainText(found.text())) >= 200),
		Option.getOrElse(() => $('body'))
	)
	// Whitespace stays only inside code blocks; elsewhere it is markup indentation.
	const body = pipe(
		Array.join(
			Array.map(root.toArray(), node => markdown($, node, url)),
			''
		),
		String.split('```'),
		Array.map((part, index) =>
			index % 2 === 1
				? part
				: pipe(
						part,
						String.split('\n'),
						Array.map(line => String.replace(/^ (?=\S)/u, '')(String.trimEnd(line))),
						Array.join('\n'),
						String.replace(/\n{3,}/gu, '\n\n')
					)
		),
		Array.join('```'),
		String.trim
	)
	return Extraction.make({
		author: plainText($('meta[property="og:site_name"]').attr('content') ?? url.hostname),
		image: pipe(
			Option.fromNullishOr(
				$('meta[property="og:image"]').attr('content') ?? $('meta[name="twitter:image"]').attr('content')
			),
			Option.flatMap(Option.liftThrowable(image => new URL(image, url).href))
		),
		text: pipe([plainText(description ?? ''), body], Array.filter(String.isNonEmpty), Array.join('\n\n')),
		title: plainText($('meta[property="og:title"]').attr('content') ?? $('title').first().text()),
		url: canonical(url)
	})
}

const reader = Effect.fnUntraced(function* (url: URL) {
	const answer = yield* pipe(
		decode(Reader, new URL(`https://r.jina.ai/${url.href}`)),
		timeLimit('30 seconds', 'The reader took too long.')
	)
	if (challenge.test(answer.data.content) || String.isEmpty(String.trim(answer.data.content))) {
		return yield* NotesError.make({message: 'The site blocks automated reading.'})
	}
	return Extraction.make({
		author: url.hostname,
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

// A blocked page, a bot check or a page without text, such as a JavaScript app or a PDF, goes to the reader.
const readPage = Effect.fnUntraced(function* (url: URL) {
	const loaded = yield* pipe(
		follow(url, page, 0),
		Effect.filterOrFail(
			found => !challenge.test(found.body),
			() => NotesError.make({message: 'The site answered with a bot check.'})
		),
		Effect.map(readable),
		Effect.result
	)
	return yield* Result.match(loaded, {
		onFailure: error => Effect.mapError(reader(url), () => error),
		onSuccess: Option.match({onNone: () => reader(url), onSome: Effect.succeed})
	})
})

export class Sources extends Context.Service<
	Sources,
	{
		readonly extract: (url: string) => Effect.Effect<Extraction, NotesError>
		readonly image: (url: string) => Effect.Effect<Image, NotesError>
		readonly resolve: (url: string) => Effect.Effect<string, NotesError>
	}
>()('@deslop/stash/services/notes/internal/extraction/Sources') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const through = Effect.provideService(Exit, yield* sourceProxy)

			return Sources.of({
				extract: Effect.fn('Sources.extract')(
					function* (link) {
						const url = yield* resolve(new URL(link), 0)
						const source = sourceFor(url.href)
						// TikTok answers some exits with a login page instead of the post.
						if (source === 'TikTok' && String.includes('/photo/')(url.pathname)) {
							return yield* Effect.retry(tikTokPhotos(url), {
								times: Option.isSome(yield* Exit) ? 2 : 0,
								while: error => error.message === 'The TikTok photo post is unreadable.'
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
