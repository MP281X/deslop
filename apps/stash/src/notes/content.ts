import {Array, Effect, Filter, Number, Option, Redacted, Result, String, pipe} from 'effect'

import {Dns, NetAddress} from 'effect/net'

import {isPublicIp} from '@deslop/runtime/shared/net'

import {NotesError} from './contract.ts'
import type {Picture} from './contract.ts'
import {URL_PATTERN, isYouTube, sourceOf} from './shared.ts'

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

export const isVideo = String.startsWith('video/')
