import {Array, HashMap, HashSet, Option, Order, Record, String, pipe} from 'effect'

import type {Note, NotesEvent} from '#services/notes/schema.ts'

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

function canonicalUrl(link: string) {
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

export function captureUrl(text: string) {
	return pipe(
		String.match(URL_PATTERN)(text),
		Option.flatMap(Array.head),
		Option.map(withoutTrailingPunctuation),
		Option.flatMap(Option.liftThrowable(canonicalUrl)),
		Option.getOrUndefined
	)
}

export function sourceFor(url: string) {
	const host = new URL(url).hostname
	if (Array.contains(X_HOSTS, host) || host === 't.co') return 'X'
	if (host === 'tiktok.com' || String.endsWith('.tiktok.com')(host)) return 'TikTok'
	return 'Website'
}

export function isYouTube(url: string) {
	return Option.isSome(String.match(/(?:^|\.)(?:youtube\.com|youtu\.be)$/u)(new URL(url).hostname))
}

export function hasVideo(url: string) {
	const link = new URL(url)
	if (sourceFor(url) === 'TikTok') return !String.includes('/photo/')(link.pathname)
	return (
		sourceFor(url) === 'X' || isYouTube(url) || Option.isSome(String.match(/(?:^|\.)instagram\.com$/u)(link.hostname))
	)
}

export function commentFor(text: string) {
	return pipe(text, String.replace(new RegExp(URL_PATTERN.source, 'giu'), ''), plainText)
}

export function plainText(text: string) {
	return pipe(text, String.replace(/\s+/gu, ' '), String.trim)
}

export function normalizeTags(tags: Note['tags']) {
	return pipe(
		tags,
		Array.map(tag => pipe(tag, String.toLowerCase, plainText, String.replace(/^#+/u, ''), String.replace(/ /gu, '-'))),
		Array.filter(String.isNonEmpty),
		Array.dedupe
	)
}

export function tagCounts(notes: NotesEvent['upserted']) {
	return pipe(
		Array.flatMap(notes, note => note.tags),
		Array.groupBy(tag => tag),
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

export function diff(previous: Note[], next: Note[]) {
	const before = HashMap.fromIterable(Array.map(previous, note => [note.id, note] as const))
	const ids = HashSet.fromIterable(Array.map(next, note => note.id))
	return {
		removed: Array.filter(
			Array.map(previous, note => note.id),
			id => !HashSet.has(ids, id)
		),
		upserted: Array.filter(next, note => !Option.exists(HashMap.get(before, note.id), old => old === note))
	}
}

export function findNotes(notes: Note[], query: string) {
	const words = pipe(query, String.toLowerCase, String.split(/\s+/u), Array.filter(String.isNonEmpty))
	const tags = pipe(
		words,
		Array.filter(String.startsWith('#')),
		Array.map(String.slice(1)),
		Array.filter(String.isNonEmpty)
	)
	const terms = Array.filter(words, word => !String.startsWith('#')(word))
	if (Array.isReadonlyArrayEmpty(words)) return notes
	return Array.filter(notes, note => {
		if (!Array.every(tags, tag => Array.contains(note.tags, tag))) return false
		const haystack = pipe(
			[
				note.title,
				note.summary,
				note.author,
				note.text,
				note.content,
				note.topics ?? '',
				note.body ?? '',
				note.screenText ?? '',
				note.transcript ?? '',
				note.url ?? '',
				...note.tags
			],
			Array.join(' '),
			String.toLowerCase
		)
		return Array.every(terms, term => String.includes(term)(haystack))
	})
}
