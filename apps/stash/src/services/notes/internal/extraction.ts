// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's platform has no DNS API, and the checked address is pinned for the connection.
import {lookup} from 'node:dns/promises'

import {NodeHttpClient} from '@effect/platform-node'

import {Array, ByteSize, Context, Effect, Layer, Match, Option, Result, Schema, Stream, String, pipe} from 'effect'

import * as cheerio from 'cheerio'
import {HttpClient} from 'effect/http'
import type {HttpClientResponse} from 'effect/http'
import {NetAddress} from 'effect/net'

import {captureUrl, isYouTube, plainText, sourceFor} from '#services/notes/lib/utils.ts'
import type {Image} from '#services/notes/schema.ts'
import {Extraction, ImageType, NotesError} from '#services/notes/schema.ts'

const shortHosts = ['vm.tiktok.com', 'vt.tiktok.com', 't.co']

type FxPost = typeof FxPost.Type
const FxPost = Schema.Struct({
	author: Schema.Struct({id: Schema.String, name: Schema.String, screen_name: Schema.String}),
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
	text: Schema.String
})

type FxThread = typeof FxThread.Type
const FxThread = Schema.Struct({
	status: Schema.Struct({...FxPost.fields, quote: Schema.optionalKey(FxPost)}),
	thread: Schema.optionalKey(Schema.Array(FxPost))
})

type OEmbed = typeof OEmbed.Type
const OEmbed = Schema.Struct({
	author_name: Schema.optionalKey(Schema.String),
	html: Schema.optionalKey(Schema.String),
	thumbnail_url: Schema.optionalKey(Schema.String),
	title: Schema.optionalKey(Schema.String)
})

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

function readText(response: HttpClientResponse.HttpClientResponse) {
	return pipe(
		response.stream,
		Stream.decodeText,
		Stream.scan(
			() => '',
			(total: string, chunk: string) => total + chunk
		),
		Stream.takeUntil(total => String.length(total) >= 512 * 1024),
		Stream.runLast,
		Effect.map(Option.getOrElse(() => ''))
	)
}

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
	return yield* pipe(
		HttpClient.get(url, {
			headers: {accept: 'text/html,application/json,image/*', 'user-agent': 'Mozilla/5.0 (compatible; DeslopNotes/1.0)'}
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
		// @effect-diagnostics-next-line strictEffectProvide:off -- Each request owns an agent pinned to its checked address.
		Effect.provide(
			pipe(
				NodeHttpClient.layerNodeHttpNoAgent,
				Layer.provide(
					NodeHttpClient.layerAgentOptions({
						autoSelectFamily: false,
						// oxlint-disable-next-line unicorn/no-null -- Node's lookup callback takes null on success.
						lookup: (_hostname, _options, callback) => callback(null, address, 4)
					})
				)
			)
		),
		Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
		Effect.mapError(cause => NotesError.make({cause, message: 'The link could not be loaded.'}))
	)
})

const follow = Effect.fnUntraced(function* <A, E>(
	url: URL,
	read: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<A, E>,
	hops: number
): Effect.fn.Return<{body: A; type: string; url: URL}, NotesError> {
	const page = yield* load(url, read)
	if (page.status >= 300 && page.status < 400 && page.location !== undefined) {
		if (hops === 5) return yield* NotesError.make({message: 'The link redirects too often.'})
		return yield* follow(new URL(page.location, url), read, hops + 1)
	}
	return yield* Option.match(page.body, {
		onNone: () => Effect.fail(NotesError.make({message: `The link answered with status ${page.status}.`})),
		onSome: body => Effect.succeed({body, type: page.type, url})
	})
})

const resolve = Effect.fnUntraced(function* (url: URL, hops: number): Effect.fn.Return<URL, NotesError> {
	if (!Array.contains(shortHosts, url.hostname)) return url
	const page = yield* load(url, () => Effect.void)
	if (page.location === undefined || hops === 5) {
		return yield* NotesError.make({message: 'The short link leads to no post.'})
	}
	return yield* resolve(new URL(page.location, url), hops + 1)
})

function canonical(url: URL) {
	return captureUrl(url.href) ?? url.href
}

const oEmbed = Effect.fnUntraced(function* (endpoint: string, url: URL) {
	return yield* pipe(
		Schema.decodeEffect(Schema.fromJsonString(OEmbed))(
			(yield* follow(new URL(`${endpoint}${encodeURIComponent(url.href)}`), readText, 0)).body
		),
		Effect.mapError(cause => NotesError.make({cause, message: 'The post preview is unreadable.'}))
	)
})

const fromOEmbed = Effect.fnUntraced(function* (endpoint: string, url: URL, title: (embed: OEmbed) => string) {
	const embed = yield* oEmbed(endpoint, url)
	return Extraction.make({
		author: embed.author_name ?? '',
		image: Option.fromNullishOr(embed.thumbnail_url),
		text: plainText(embed.title ?? ''),
		title: title(embed),
		url: canonical(url)
	})
})

const xOEmbed = Effect.fnUntraced(function* (url: URL) {
	const embed = yield* oEmbed('https://publish.x.com/oembed?omit_script=true&dnt=true&url=', url)
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

const xThread = Effect.fnUntraced(function* (url: URL) {
	const id = yield* pipe(
		String.match(/\/status\/(\d+)/u)(url.pathname),
		Option.flatMap(match => Array.get(match, 1)),
		Effect.fromOption,
		Effect.mapError(() => NotesError.make({message: 'The link names no post.'}))
	)
	const thread = yield* pipe(
		Schema.decodeEffect(Schema.fromJsonString(FxThread))(
			(yield* follow(new URL(`https://api.fxtwitter.com/2/thread/${id}`), readText, 0)).body
		),
		Effect.mapError(cause => NotesError.make({cause, message: 'The post is unreadable.'}))
	)
	const status = thread.status
	const quote = Option.fromNullishOr(status.quote)
	const media = Array.flatMap([status, ...Option.toArray(quote)], (post: FxPost) => post.media?.all ?? [])
	const followUps = Array.filter(
		thread.thread ?? [],
		post => post.author.id === status.author.id && post.id !== status.id
	)
	return Extraction.make({
		author: status.author.name,
		image: Option.map(Array.head(media), item => item.thumbnail_url ?? item.url),
		text: pipe(
			[
				plainText(status.text),
				...Array.map(followUps, post => plainText(post.text)),
				Option.match(quote, {
					onNone: () => '',
					onSome: post => `Quoting ${post.author.name} (@${post.author.screen_name}): ${plainText(post.text)}`
				})
			],
			Array.filter(String.isNonEmpty),
			Array.join('\n')
		),
		title: `${status.author.name} on X`,
		url: canonical(url),
		...pipe(
			Array.findFirst(media, item => item.type === 'video' || item.type === 'gif'),
			Option.match({onNone: () => ({}), onSome: item => ({video: item.url})})
		)
	})
})

function website(html: string, url: URL) {
	const $ = cheerio.load(html)
	$('script, style, noscript, iframe, svg, nav, header, footer, form, aside').remove()
	const description =
		$('meta[property="og:description"]').attr('content') ?? $('meta[name="description"]').attr('content')
	const body = pipe(
		[$('article').first().text(), $('main').first().text(), $('body').text()],
		Array.map(plainText),
		Array.findFirst(String.isNonEmpty),
		Option.getOrElse(() => '')
	)
	return Extraction.make({
		author: plainText($('meta[property="og:site_name"]').attr('content') ?? url.hostname),
		image: pipe(
			Option.fromNullishOr(
				$('meta[property="og:image"]').attr('content') ?? $('meta[name="twitter:image"]').attr('content')
			),
			Option.flatMap(Option.liftThrowable(image => new URL(image, url).href))
		),
		text: pipe([description ?? '', body], Array.map(plainText), Array.filter(String.isNonEmpty), Array.join('\n')),
		title: plainText($('meta[property="og:title"]').attr('content') ?? $('title').first().text()),
		url: canonical(url)
	})
}

const readPage = Effect.fnUntraced(function* (url: URL) {
	const page = yield* follow(url, readText, 0)
	if (!String.includes('text/html')(String.toLowerCase(page.type))) {
		return yield* NotesError.make({message: 'Only web pages can be read.'})
	}
	return website(page.body, page.url)
})

function timeLimit(message: string) {
	return Effect.timeoutOrElse({duration: '15 seconds', orElse: () => Effect.fail(NotesError.make({message}))})
}

export class Sources extends Context.Service<
	Sources,
	{
		readonly extract: (url: string) => Effect.Effect<Extraction, NotesError>
		readonly image: (url: string) => Effect.Effect<Image, NotesError>
		readonly resolve: (url: string) => Effect.Effect<string, NotesError>
	}
>()('@deslop/stash/services/notes/internal/extraction/Sources') {
	static readonly layer = Layer.succeed(
		this,
		this.of({
			extract: Effect.fn('Sources.extract')(function* (link) {
				const url = yield* resolve(new URL(link), 0)
				return yield* pipe(
					Match.value(sourceFor(url.href)),
					Match.when('TikTok', () =>
						fromOEmbed(
							'https://www.tiktok.com/oembed?url=',
							url,
							embed => `${embed.author_name ?? 'A video'} on TikTok`
						)
					),
					Match.when('X', () => Effect.catch(xThread(url), () => xOEmbed(url))),
					// YouTube answers a datacenter address with a bot check, but its oEmbed still answers.
					Match.when(
						() => isYouTube(url.href),
						() =>
							fromOEmbed('https://www.youtube.com/oembed?format=json&url=', url, embed =>
								plainText(embed.title ?? 'A YouTube video')
							)
					),
					Match.orElse(() => readPage(url))
				)
			}, timeLimit('Reading the link took too long.')),
			image: Effect.fn('Sources.image')(function* (link) {
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
			}, timeLimit('Loading the preview image took too long.')),
			resolve: Effect.fn('Sources.resolve')(function* (link) {
				return canonical(yield* resolve(new URL(link), 0))
			}, timeLimit('The short link took too long to answer.'))
		})
	)
}
