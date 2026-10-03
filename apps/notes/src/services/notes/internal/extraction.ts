// @effect-diagnostics-next-line nodeBuiltinImport:off -- A cancellable DNS resolver is needed to pin the public address before the Node HTTP adapter connects.
import {Resolver} from 'node:dns/promises'

import {NodeHttpClient} from '@effect/platform-node'

import {Array, Context, Effect, Layer, Option, Redacted, Result, Schema, Stream, String, pipe} from 'effect'

import * as cheerio from 'cheerio'
import {HttpClient} from 'effect/http'
import {NetAddress} from 'effect/net'

import {plainText, sourceFor} from '#services/notes/lib/utils.ts'
import {NotesError, OEmbed} from '#services/notes/schema.ts'

function publicAddress(address: string) {
	const parsed = pipe(NetAddress.ipv4FromString(address), Result.getOrUndefined)
	if (parsed === undefined) return false
	const octets = NetAddress.ipv4ToOctets(parsed)
	return (
		NetAddress.isUnicast(parsed) &&
		!NetAddress.isPrivate(parsed) &&
		!NetAddress.isLinkLocal(parsed) &&
		!NetAddress.isLoopback(parsed) &&
		octets[0] !== 0 &&
		octets[0] < 224 &&
		!(octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) &&
		!(octets[0] === 192 && octets[1] === 0 && (octets[2] === 0 || octets[2] === 2)) &&
		!(octets[0] === 192 && octets[1] === 88 && octets[2] === 99) &&
		!(octets[0] === 198 && (octets[1] === 18 || octets[1] === 19)) &&
		!(octets[0] === 198 && octets[1] === 51 && octets[2] === 100) &&
		!(octets[0] === 203 && octets[1] === 0 && octets[2] === 113)
	)
}

const validate = Effect.fnUntraced(function* (url: URL) {
	const host = url.hostname
	if (
		url.protocol !== 'https:' ||
		url.username !== '' ||
		url.password !== '' ||
		url.port !== '' ||
		!String.includes('.')(host) ||
		!/^[a-z\d.-]+$/iu.test(host) ||
		Result.isSuccess(NetAddress.ipFromString(host)) ||
		Array.some(['.localhost', '.local', '.internal', '.ts.net', '.home', '.lan'], suffix =>
			String.endsWith(suffix)(host)
		) ||
		host === 'metadata.google.internal' ||
		String.endsWith('.')(host)
	) {
		return yield* NotesError.make({message: 'This source URL is not a public HTTPS website.'})
	}
})

const fetchPublic = Effect.fnUntraced(
	function* (url: URL, readBody: boolean) {
		yield* validate(url)
		const host = url.hostname
		const addresses = yield* Effect.acquireUseRelease(
			Effect.sync(() => new Resolver()),
			resolver =>
				Effect.tryPromise({
					catch: cause =>
						NotesError.make({cause: Redacted.make(cause), message: 'The source hostname could not be resolved.'}),
					try: () => resolver.resolve4(host)
				}),
			resolver => Effect.sync(() => resolver.cancel())
		)
		if (Array.isReadonlyArrayEmpty(addresses) || !Array.every(addresses, publicAddress)) {
			return yield* NotesError.make({message: 'This source resolves to an unsafe network address.'})
		}
		const address = pipe(Array.head(addresses), Option.getOrThrow)
		// Node's scoped adapter owns socket cancellation, TLS host verification and bounded response streaming. Its fixed lookup prevents DNS rebinding.
		return yield* pipe(
			Effect.gen(function* () {
				const response = yield* HttpClient.get(url, {
					headers: {
						accept: 'text/html, application/json',
						'accept-encoding': 'identity',
						'user-agent': 'DeslopNotes/1.0'
					}
				})
				if (response.status >= 300 && response.status < 400) {
					return {
						body: '',
						location: response.headers['location'],
						status: response.status,
						type: response.headers['content-type'] ?? ''
					}
				}
				if (!readBody) {
					return {body: '', location: undefined, status: response.status, type: response.headers['content-type'] ?? ''}
				}
				if (response.status !== 200) {
					return yield* NotesError.make({message: 'The source is unavailable or requires a login.'})
				}
				const encoding = response.headers['content-encoding']
				if (encoding !== undefined && String.toLowerCase(encoding) !== 'identity') {
					return yield* NotesError.make({message: 'Compressed source content is not supported.'})
				}
				const body = yield* Stream.runFoldEffect(
					response.stream,
					() => ({chunks: Array.empty<Uint8Array>(), size: 0}),
					(current, chunk) => {
						const size = current.size + chunk.byteLength
						if (size > 262144) {
							return Effect.fail(NotesError.make({message: 'The source exceeds the 256 KiB extraction limit.'}))
						}
						return Effect.succeed({chunks: Array.append(current.chunks, chunk), size})
					}
				)
				return {
					// oxlint-disable-next-line @deslop/coding-standards/no-native-method-call -- Buffer.concat joins bounded binary HTTP chunks, not strings or native arrays.
					body: new TextDecoder().decode(Buffer.concat(body.chunks)),
					location: undefined,
					status: response.status,
					type: response.headers['content-type'] ?? ''
				}
			}),
			// @effect-diagnostics-next-line strictEffectProvide:off -- Each request owns a scoped agent pinned to its validated DNS address; sharing the application client would permit DNS rebinding.
			Effect.provide(
				pipe(
					NodeHttpClient.layerNodeHttpNoAgent,
					Layer.provide(
						NodeHttpClient.layerAgentOptions({
							autoSelectFamily: false,
							// oxlint-disable-next-line unicorn/no-null -- Node's lookup callback requires null on successful resolution.
							lookup: (_hostname, _options, callback) => callback(null, address, 4)
						})
					)
				)
			),
			// Source URLs and oEmbed queries contain private note data; do not put them or response cookies into HTTP spans.
			Effect.provideService(HttpClient.TracerDisabledWhen, () => true)
		)
	},
	Effect.mapError(cause =>
		NotesError.make({cause: Redacted.make(cause), message: 'The source could not be safely fetched.'})
	)
)

const follow = Effect.fnUntraced(function* (
	url: URL,
	hops: number,
	readBody: boolean,
	embed: boolean
): Effect.fn.Return<{body: string; url: URL; type: string}, NotesError> {
	if (
		embed &&
		(url.pathname !== '/oembed' ||
			!Array.contains(['www.tiktok.com', 'publish.twitter.com', 'publish.x.com'], url.hostname))
	) {
		return yield* NotesError.make({message: 'The embed endpoint redirected outside its official endpoints.'})
	}
	const response = yield* fetchPublic(url, readBody)
	if (response.status >= 300 && response.status < 400) {
		if (hops === 3 || response.location === undefined) {
			return yield* NotesError.make({message: 'The source has too many redirects or no redirect destination.'})
		}
		const next = yield* Effect.try({
			catch: () => NotesError.make({message: 'The source redirect URL is invalid.'}),
			try: () => new URL(response.location ?? '', url)
		})
		return yield* follow(next, hops + 1, readBody, embed)
	}
	return {...response, url}
})

export class Sources extends Context.Service<
	Sources,
	{readonly extract: (url: string) => Effect.Effect<string, NotesError>}
>()('@deslop/notes/services/notes/internal/extraction/Sources') {
	static readonly layer = Layer.succeed(
		this,
		this.of({
			extract: Effect.fn('Sources.extract')(
				function* (input) {
					const original = new URL(input)
					yield* validate(original)
					const short = Array.contains(['vm.tiktok.com', 'vt.tiktok.com', 't.co'], original.hostname)
					const url = short ? (yield* follow(original, 0, false, false)).url : original
					const source = sourceFor(url.href)
					if (short && source !== sourceFor(input)) {
						return yield* NotesError.make({message: 'The short link does not lead to its official source.'})
					}
					if (source === 'TikTok' || source === 'X') {
						const endpoint = new URL(
							source === 'TikTok' ? 'https://www.tiktok.com/oembed' : 'https://publish.twitter.com/oembed'
						)
						endpoint.searchParams.set('url', url.href)
						if (source === 'X') {
							endpoint.searchParams.set('omit_script', 'true')
							endpoint.searchParams.set('dnt', 'true')
						}
						const response = yield* follow(endpoint, 0, true, true)
						const embed = yield* Schema.decodeEffect(Schema.fromJsonString(OEmbed))(response.body)
						if (source === 'TikTok') return plainText(embed.title ?? '')
						const $ = cheerio.load(embed.html ?? '')
						$('script, style, iframe').remove()
						return plainText($('blockquote p').text())
					}
					const response = yield* follow(url, 0, true, false)
					if (!String.includes('text/html')(String.toLowerCase(response.type))) {
						return yield* NotesError.make({message: 'Only public HTML pages can be extracted.'})
					}
					const $ = cheerio.load(response.body)
					$('script, style, noscript, iframe, nav, footer, header, form').remove()
					const articleText = plainText($('article').first().text())
					const mainText = plainText($('main').first().text())
					const article = articleText === '' ? mainText : articleText
					const content = article === '' ? $('body').text() : article
					if (plainText(content) === '') return ''
					const title = $('meta[property="og:title"]').attr('content') ?? $('title').text()
					const description =
						$('meta[name="description"]').attr('content') ?? $('meta[property="og:description"]').attr('content') ?? ''
					return plainText(`${title}\n${description}\n${content}`)
				},
				Effect.timeout('10 seconds'),
				Effect.mapError(cause =>
					NotesError.make({
						cause: Redacted.make(cause),
						message: 'Source extraction is unavailable; the original was kept.'
					})
				)
			)
		})
	)
}
