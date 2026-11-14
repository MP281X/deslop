import {NodeHttpClient} from '@effect/platform-node'

import type {Duration} from 'effect'
import {
	Array,
	Boolean,
	ByteSize,
	Context,
	Effect,
	Function,
	Layer,
	Option,
	Random,
	Result,
	Schema,
	Stream,
	String,
	flow,
	pipe
} from 'effect'

import {load} from 'cheerio'
import {HttpClient} from 'effect/http'
import type {HttpClientResponse} from 'effect/http'
import {Dns, NetAddress} from 'effect/net'

import {isPublicIp} from '@deslop/runtime/shared/net'

import {pageText} from './page.ts'
import {conversationPlan, conversationExtraction, tikTokExtraction} from './x.ts'

import {sourceProxy, sticky} from '#services/media/service.ts'
import {canonical, isYouTube, plainText, sourceOf} from '#services/notes/lib/utils.ts'
import type {FxPost, Image} from '#services/notes/schema.ts'
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

const Exit = Context.Reference<Option.Option<string>>('@deslop/stash/services/notes/lib/extraction/Exit', {
	defaultValue: Option.none
})

function timeLimit(duration: Duration.Input, message: string, reason?: NotesError['reason']) {
	return Effect.timeoutOrElse({duration, orElse: () => Effect.fail(NotesError.make({message, reason}))})
}

function readText(characters: number) {
	return (response: HttpClientResponse.HttpClientResponse) =>
		pipe(
			Stream.limitBytes(response.stream, ByteSize.bytes(characters), () => Stream.empty),
			Stream.decodeText,
			Stream.mkString
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
const readSource = Effect.fnUntraced(function* <A, E>(
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
	const addresses = yield* Effect.mapError((yield* Dns.Dns).lookup(url.hostname, {family: 'IPv4'}), cause =>
		NotesError.make({cause, message: 'The link host could not be found.'})
	)
	if (!Array.every(addresses, isPublicIp)) {
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
			pipe(
				read(response),
				Effect.when(Effect.succeed(response.status === 200)),
				Effect.map(body => ({
					body,
					location: response.headers['location'],
					status: response.status,
					type: response.headers['content-type'] ?? ''
				}))
			)
		),
		Effect.scoped,
		// oxlint-disable-next-line effecttsgo/strict-effect-provide -- Each request owns an agent pinned to its checked address or its proxy.
		Effect.provide(
			Layer.provide(
				NodeHttpClient.layerNodeHttpNoAgent,
				Option.match(proxy, {
					onNone: () =>
						NodeHttpClient.layerAgentOptions({
							autoSelectFamily: false,
							// oxlint-disable-next-line unicorn/no-null -- Node's lookup callback takes null on success.
							lookup: (_hostname, _options, callback) => callback(null, address, 4)
						}),
					// Expo's types make NODE_ENV required in every environment object.
					onSome: exit =>
						NodeHttpClient.layerAgentOptions({proxyEnv: {HTTP_PROXY: exit, HTTPS_PROXY: exit, NODE_ENV: 'production'}})
				})
			)
		),
		Effect.provideService(HttpClient.TracerDisabledWhen, Function.constTrue),
		Effect.mapError(cause =>
			pipe(
				cause,
				Option.liftPredicate(Schema.is(NotesError)),
				Option.getOrElse(() => NotesError.make({cause, message: UNREACHABLE, reason: 'Unreachable'}))
			)
		)
	)
})

// One span per request to a source, with the address and its answer, while the pinned agent and proxy keep their client spans off.
function attempt<A, E>(url: URL, read: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<A, E>) {
	return pipe(
		readSource(url, read),
		Effect.tap(found => Effect.annotateCurrentSpan('status', found.status)),
		Effect.withSpan('Sources.fetch', {attributes: {source: sourceOf(url.href), url: url.href}})
	)
}

const follow = Effect.fnUntraced(function* <A, E>(
	url: URL,
	read: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<A, E>,
	hops: number
): Effect.fn.Return<{body: A; type: string; url: URL}, NotesError, Dns.Dns> {
	const proxied = Option.isSome(yield* Exit)
	const answer = yield* pipe(
		attempt(url, read),
		Effect.filterOrFail(
			// A residential exit can be offline or flagged; each new try gets another exit address.
			found => !proxied || !Array.contains([403, 429, 500, 502, 503], found.status),
			() => NotesError.make({message: UNREACHABLE, reason: 'Unreachable'})
		),
		timeLimit('15 seconds', UNREACHABLE, 'Unreachable'),
		Effect.retry({
			times: Boolean.match(proxied, {onFalse: Function.constant(0), onTrue: Function.constant(2)}),
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
	return yield* Effect.mapError(
		Schema.decodeEffect(Schema.fromJsonString(schema))((yield* follow(url, api, 0)).body),
		cause => NotesError.make({cause, message: 'The source answered in an unknown format.'})
	)
})

function fx<S extends Schema.Constraint>(schema: S, path: string) {
	return decode(schema, new URL(`https://api.fxtwitter.com/2/${path}`))
}

// The conversation answer sometimes drops an article's body; the post's own answer keeps it.
function whole<A extends FxPost>(post: A) {
	if (
		Option.match(post.article, {
			onNone: Function.constTrue,
			onSome: article => Array.isReadonlyArrayNonEmpty(article.content.blocks)
		})
	) {
		return Effect.succeed(post)
	}
	// Without its body the article still reads as its title among the posts already loaded around it.
	return pipe(
		fx(FxStatus, `status/${post.id}`),
		Effect.map(found => ({...post, ...found.status})),
		Effect.catch(error => Effect.as(Effect.logWarning('The article body did not load', error), post))
	)
}

const resolve = Effect.fnUntraced(function* (url: URL, hops: number): Effect.fn.Return<URL, NotesError, Dns.Dns> {
	if (!Array.contains(['vm.tiktok.com', 'vt.tiktok.com', 't.co'], url.hostname)) return url
	const answer = yield* attempt(url, () => Effect.void)
	if (answer.location === undefined || hops === 5) {
		return yield* NotesError.make({message: 'The short link leads to no post.'})
	}
	return yield* resolve(new URL(answer.location, url), hops + 1)
})

const fetchOEmbed = Effect.fnUntraced(function* (endpoint: string, url: URL, title: (embed: OEmbed) => string) {
	const embed = yield* decode(OEmbed, new URL(`${endpoint}${encodeURIComponent(url.href)}`))
	return Extraction.make({
		author: embed.author_name,
		image: embed.thumbnail_url,
		slides: Option.none(),
		text: plainText(Option.getOrElse(embed.title, Function.constant(''))),
		title: title(embed),
		url: canonical(url),
		video: Option.none()
	})
})

const xOEmbed = Effect.fnUntraced(function* (url: URL) {
	const embed = yield* decode(
		OEmbed,
		new URL(`https://publish.x.com/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(url.href)}`)
	)
	return Extraction.make({
		author: embed.author_name,
		image: Option.none(),
		slides: Option.none(),
		text: plainText(load(Option.getOrElse(embed.html, Function.constant('')))('blockquote p').text()),
		title: `${Option.getOrElse(embed.author_name, Function.constant('A post'))} on X`,
		url: canonical(url),
		// Without the thread nothing says whether the post has a video, so yt-dlp tries.
		video: Option.some(canonical(url))
	})
})

// A photo post has no oEmbed and yt-dlp cannot read it, but its page under /video/ holds every slide.
const tikTokPhotos = Effect.fnUntraced(function* (url: URL) {
	const html = yield* follow(new URL(String.replace('/photo/', '/video/')(url.href)), api, 0)
	const item = (yield* Effect.mapError(
		Schema.decodeEffect(Schema.fromJsonString(TikTokPage))(
			load(html.body)('#__UNIVERSAL_DATA_FOR_REHYDRATION__').text()
		),
		cause => NotesError.make({cause, message: 'The TikTok photo post is unreadable.', reason: 'UnreadablePhoto'})
	)).__DEFAULT_SCOPE__['webapp.video-detail'].itemInfo.itemStruct
	return tikTokExtraction(item, url)
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
		slides: Option.none(),
		text: pipe(
			[found, ...comments],
			Array.map(post => Option.map(post.body, body => `**${post.user.login}**: ${body}`)),
			Array.getSomes,
			Array.prepend(`# ${found.title} (${found.state})`),
			Array.join('\n\n')
		),
		title: found.title,
		url: canonical(url),
		video: Option.none()
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
		slides: Option.none(),
		text: pipe(
			[
				found.description,
				pipe(
					found.topics,
					Option.filter(Array.isReadonlyArrayNonEmpty),
					Option.map(topics => `Topics: ${Array.join(topics, ', ')}`)
				),
				Option.flatten(found.homepage),
				readme
			],
			Array.getSomes,
			Array.filter(String.isNonEmpty),
			Array.join('\n\n')
		),
		title: found.full_name,
		url: canonical(url),
		video: Option.none()
	})
})

const gitHub = Effect.fnUntraced(function* (url: URL) {
	const path = pipe(url.pathname, String.split('/'), Array.filter(String.isNonEmpty))
	const name = pipe(path, Array.take(2), Array.join('/'))
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
	const answer = yield* timeLimit(
		'30 seconds',
		'The reader took too long.'
	)(decode(Reader, new URL(`https://r.jina.ai/${url.href}`)))
	if (CHALLENGE.test(answer.data.content) || String.isEmpty(String.trim(answer.data.content))) {
		return yield* NotesError.make({message: 'The site blocks automated reading.'})
	}
	return Extraction.make({
		author: Option.some(url.hostname),
		image: Option.none(),
		slides: Option.none(),
		text: answer.data.content,
		title: plainText(answer.data.title),
		url: canonical(url),
		video: Option.none()
	})
})

function readable(found: {body: string; type: string; url: URL}) {
	if (!String.includes('text/html')(String.toLowerCase(found.type))) return Option.none<Extraction>()
	return Option.liftPredicate(pageText(found.body, found.url), extraction => String.isNonEmpty(extraction.text))
}

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
								Effect.catchTag('NotesError', () => Effect.succeed(extraction))
							)
					})
			})
	})
})

// A linked article or repository often holds what the post only points at.
function readLinked(url: URL) {
	return pipe(
		Boolean.match(url.hostname === 'github.com', {
			onFalse: () => readPage(url),
			onTrue: () => Effect.catchTag(gitHub(url), 'NotesError', () => readPage(url))
		}),
		Effect.map(found => `### ${found.title}\n\n${found.url}\n\n${String.slice(0, 40_000)(found.text)}`),
		timeLimit('40 seconds', 'The linked page took too long.'),
		Effect.option
	)
}

const xThread = Effect.fnUntraced(function* (url: URL) {
	const id = yield* pipe(
		String.match(/\/status\/(\d+)/u)(url.pathname),
		Option.flatMap(match => Array.get(match, 1)),
		Effect.fromOption,
		Effect.mapError(() => NotesError.make({message: 'The link names no post.'}))
	)
	const conversation = yield* fx(FxConversation, `conversation/${id}`)
	const status = yield* whole(conversation.status)

	const plan = conversationPlan(conversation, status, yield* Effect.transposeOption(Option.map(status.quote, whole)))
	const linked = yield* Effect.all(
		{
			pages: Effect.forEach(plan.pages, readLinked, {concurrency: 'unbounded'}),
			posts: Effect.forEach(
				plan.posts,
				linkedId => Effect.option(Effect.map(fx(FxStatus, `status/${linkedId}`), found => found.status)),
				{concurrency: 'unbounded'}
			)
		},
		{concurrency: 'unbounded'}
	)
	return conversationExtraction(url, plan, linked)
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
						const source = sourceOf(url.href)
						// TikTok answers some exits with a login page instead of the post.
						if (source === 'TikTok' && String.includes('/photo/')(url.pathname)) {
							return yield* Effect.retry(tikTokPhotos(url), {
								times: Boolean.match(Option.isSome(yield* Exit), {
									onFalse: Function.constant(0),
									onTrue: Function.constant(2)
								}),
								while: error => error.reason === 'UnreadablePhoto'
							})
						}
						if (source === 'TikTok') {
							return yield* fetchOEmbed(
								'https://www.tiktok.com/oembed?url=',
								url,
								embed => `${Option.getOrElse(embed.author_name, Function.constant('A video'))} on TikTok`
							)
						}
						if (source === 'X') return yield* Effect.catchTag(xThread(url), 'NotesError', () => xOEmbed(url))
						// YouTube answers a datacenter address with a bot check, but its oEmbed still answers.
						if (isYouTube(url.href)) {
							return yield* fetchOEmbed('https://www.youtube.com/oembed?format=json&url=', url, embed =>
								plainText(Option.getOrElse(embed.title, Function.constant('A YouTube video')))
							)
						}
						if (url.hostname === 'github.com') {
							return yield* Effect.catchTag(gitHub(url), 'NotesError', () => readPage(url))
						}
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
