import {Array, Function, Option, Order, Record, String, pipe} from 'effect'

import type {NoteItem} from '#services/notes/schema.ts'

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
	if (url.hostname === 'youtu.be') return Array.findFirst(String.split(url.pathname, '/'), String.isNonEmpty)
	if (Option.isNone(String.match(/(?:^|\.)youtube\.com$/u)(url.hostname))) return Option.none<string>()
	return pipe(
		Option.fromNullishOr(url.searchParams.get('v')),
		Option.orElse(() =>
			pipe(
				String.match(/^\/(?:shorts|live|embed)\/([\w-]+)/u)(url.pathname),
				Option.flatMap(match => Array.get(match, 1))
			)
		)
	)
}

export function sourceFor(url: string) {
	const host = new URL(url).hostname
	if (Array.contains(X_HOSTS, host) || host === 't.co') return 'X'
	if (host === 'tiktok.com' || String.endsWith('.tiktok.com')(host)) return 'TikTok'
	return 'Website'
}

function withoutTracking(link: string) {
	const url = new URL(link)
	if (Array.contains(X_HOSTS, url.hostname)) url.hostname = 'x.com'
	if (sourceFor(url.href) === 'Website') {
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
	if (sourceFor(url) === 'TikTok') return !String.includes('/photo/')(link.pathname)
	return sourceFor(url) === 'X' || isYouTube(url)
}

export function plainText(text: string) {
	return pipe(text, String.replaceAll(/\s+/gu, ' '), String.trim)
}

export function commentFor(text: string) {
	return pipe(text, String.replaceAll(new RegExp(URL_PATTERN.source, 'giu'), ''), plainText)
}

export function tagCounts(notes: readonly Pick<NoteItem, 'tags'>[]) {
	return pipe(
		Array.flatMap(notes, note => note.tags),
		Array.groupBy(Function.identity),
		Record.toEntries,
		Array.map(entry => ({count: entry[1].length, tag: entry[0]})),
		Array.sort(
			Order.combine(
				Order.mapInput(Order.flip(Order.Number), (entry: {count: number; tag: string}) => entry.count),
				Order.mapInput(Order.String, (entry: {count: number; tag: string}) => entry.tag)
			)
		)
	)
}

// A query's lowercase words: a `#word` names a tag every result carries, any other word is text every result contains.
export function queryWords(query: string) {
	const words = pipe(query, String.toLowerCase, String.split(/\s+/u), Array.filter(String.isNonEmpty))
	return {
		tags: pipe(
			words,
			Array.filter(String.startsWith('#')),
			Array.map(String.slice(1)),
			Array.filter(String.isNonEmpty)
		),
		terms: Array.filter(words, word => !String.startsWith('#')(word))
	}
}
