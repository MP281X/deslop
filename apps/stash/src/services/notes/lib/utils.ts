import {Array, Effect, Filter, Function, Number, Option, Order, Record, Redacted, Result, String, pipe} from 'effect'

import {Dns, NetAddress} from 'effect/net'

import {isPublicIp} from '@deslop/runtime/shared/net'

import type {NoteItem, Picture, TagName} from '#services/notes/schema.ts'
import {NotesError} from '#services/notes/schema.ts'

const URL_PATTERN = /https?:\/\/[^\s<>"]+/iu

const X_HOSTS = ['twitter.com', 'www.twitter.com', 'mobile.twitter.com', 'x.com', 'www.x.com', 'mobile.x.com']

const TRACKING_PARAMETERS = [
	'fbclid',
	'gclid',
	'igsh',
	'igshid',
	'mc_cid',
	'mc_eid',
	'si',
	'utm_campaign',
	'utm_content',
	'utm_id',
	'utm_medium',
	'utm_source',
	'utm_term'
]

function withoutTrailingPunctuation(link: string): string {
	const trimmed = String.replace(/[.,;:!?\]]+$/u, '')(link)
	if (String.endsWith(')')(trimmed) && String.split(trimmed, ')').length > String.split(trimmed, '(').length) {
		return withoutTrailingPunctuation(String.slice(0, -1)(trimmed))
	}
	return trimmed
}

// youtu.be, Shorts, live and embed links and the mobile site all name one video by its id.
function youTubeId(url: URL) {
	if (url.hostname === 'youtu.be') {
		return pipe(url.pathname, String.split('/'), Array.findFirst(String.isNonEmpty))
	}
	if (Option.isNone(String.match(/(?:^|\.)youtube\.com$/u)(url.hostname))) return Option.none<string>()
	return Option.orElse(Option.fromNullishOr(url.searchParams.get('v')), () =>
		Option.flatMap(String.match(/^\/(?:shorts|live|embed)\/([\w-]+)/u)(url.pathname), match => Array.get(match, 1))
	)
}

export function sourceOf(url: string) {
	const host = new URL(url).hostname
	if (Array.contains(X_HOSTS, host) || host === 't.co') return 'X'
	if (host === 'tiktok.com' || String.endsWith('.tiktok.com')(host)) return 'TikTok'
	return 'Website'
}

function withoutTracking(link: string) {
	const url = new URL(link)
	if (Array.contains(X_HOSTS, url.hostname)) url.hostname = 'x.com'
	if (sourceOf(url.href) === 'Website') {
		for (const key of TRACKING_PARAMETERS) url.searchParams.delete(key)
	} else {
		url.search = ''
	}
	url.hash = ''
	return url.href
}

function canonicalUrl(link: string) {
	return Option.match(youTubeId(new URL(link)), {
		onNone: () => withoutTracking(link),
		onSome: id => `https://www.youtube.com/watch?v=${id}`
	})
}

export function captureUrl(text: string) {
	return pipe(
		String.match(URL_PATTERN)(text),
		Option.flatMap(Array.head),
		Option.map(withoutTrailingPunctuation),
		Option.flatMap(Option.liftThrowable(canonicalUrl)),
		Option.getOrUndefined
	)
}

export function canonical(url: URL) {
	return captureUrl(url.href) ?? url.href
}

export function isYouTube(url: string) {
	return Option.isSome(String.match(/(?:^|\.)(?:youtube\.com|youtu\.be)$/u)(new URL(url).hostname))
}

export function hasVideo(url: string) {
	const link = new URL(url)
	if (sourceOf(url) === 'TikTok') return !String.includes('/photo/')(link.pathname)
	return sourceOf(url) === 'X' || isYouTube(url)
}

export function plainText(text: string) {
	return pipe(text, String.replaceAll(/\s+/gu, ' '), String.trim)
}

export function commentOf(text: string) {
	return pipe(text, String.replaceAll(new RegExp(URL_PATTERN.source, 'giu'), ''), plainText)
}

export function tagCounts(notes: readonly Pick<NoteItem, 'tags'>[]) {
	return pipe(
		Array.flatMap(notes, note => note.tags),
		Array.groupBy(Function.identity),
		Record.toEntries,
		Array.map(entry => ({count: entry[1].length, tag: Array.headNonEmpty(entry[1])})),
		Array.sort(
			pipe(
				Order.flip(Order.Number),
				Order.mapInput((entry: {count: number; tag: TagName}) => entry.count),
				Order.combine(Order.mapInput(Order.String, (entry: {count: number; tag: TagName}) => entry.tag))
			)
		)
	)
}

// The text search indexes and reads, so both sides spell a word alike: compatibility and decomposed forms folded, a language name such as c++ or c# one word of its own, and each character of Chinese and Japanese, written without spaces, a word, so a phrase of them matches inside a longer run.
export function searchable(text: string) {
	return pipe(
		text,
		String.normalize('NFKC'),
		String.replaceAll(/(\p{L})\+\+(?![\p{L}\p{N}+])/gu, '$1plusplus'),
		String.replaceAll(/(\p{L})#(?![\p{L}\p{N}#])/gu, '$1sharp'),
		String.replaceAll(/([\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}])/gu, ' $1 '),
		plainText
	)
}

// A query's lowercase words: a `#word` names a tag every result carries, any other word is text every result contains; a word search cannot index, such as lone punctuation, asks for nothing.
// judge-ignore no-contradicted-promise -- Effect v4 Array.partition returns passes first, so the # predicate places tags in the first array.
export function queryWords(query: string) {
	const [tags, terms] = Array.partition(
		pipe(query, String.toLowerCase, String.split(/\s+/u), Array.filter(String.isNonEmpty)),
		Filter.fromPredicate(String.startsWith('#'))
	)
	return {
		tags: pipe(tags, Array.map(String.slice(1)), Array.filter(String.isNonEmpty)),
		terms: pipe(
			terms,
			Array.map(searchable),
			Array.filter(term => Option.isSome(String.match(/[\p{L}\p{N}]/u)(term)))
		)
	}
}

function tokensOf(text: string) {
	const other = String.length(text) - String.length(String.replaceAll(/[\u0080-\u{10ffff}]/gu, '')(text))
	return (String.length(text) - other) / 4 + other
}

function cut(text: string, tokens: number) {
	const estimate = tokensOf(text)
	if (estimate <= tokens) return text
	return `${String.slice(0, Math.floor((String.length(text) * tokens) / estimate))(text)}\n[cut here]`
}

// The content and the transcript share one budget of about 100,000 tokens, so with the pictures, the prompt and 32,000 output tokens one request stays inside the model's window; a short one leaves its share to the other.
export function fitText(content: string, transcript: string) {
	const budget = 100_000
	const half = budget / 2
	return {
		content: cut(content, Number.max(half, budget - tokensOf(transcript))),
		transcript: cut(transcript, Number.max(half, budget - tokensOf(content)))
	}
}

// Pictures travel as base64 inside Gateway's 10 MiB request: they share 6 MiB in the order given, which puts the preview and the post's own images before video stills, and Anthropic takes at most 5 MB and 100 of them.
export function fitPictures(images: readonly Picture[]) {
	return pipe(
		images,
		Array.mapAccum({bytes: 0, count: 0}, (used, image) => {
			const bytes = used.bytes + image.bytes.byteLength
			if (image.bytes.byteLength > 5_000_000 || bytes > 6 * 1024 * 1024 || used.count >= 100) {
				return [used, Option.none<Picture>()]
			}
			return [{bytes, count: used.count + 1}, Option.some(image)]
		}),
		result => Array.getSomes(result[1])
	)
}

export function sticky(proxy: Redacted.Redacted, session: string) {
	return Redacted.make(String.replaceAll('{session}', session)(Redacted.value(proxy)))
}

// A source is read only from a named web host whose every IPv4 address is public; the media tools fetch only links that pass it too.
export const publicAddress = Effect.fnUntraced(function* (url: URL) {
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
	return Array.headNonEmpty(addresses)
})
