import {Array, Function, HashMap, HashSet, Option, Order, Predicate, Record, String, pipe} from 'effect'

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

// youtu.be, Shorts, live and embed links and the mobile site all name one video by its id.
function youTubeId(url: URL) {
	if (url.hostname === 'youtu.be') return Array.get(Array.filter(String.split(url.pathname, '/'), String.isNonEmpty), 0)
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

export function plainText(text: string) {
	return pipe(text, String.replaceAll(/\s+/gu, ' '), String.trim)
}

export function commentFor(text: string) {
	return pipe(text, String.replaceAll(new RegExp(URL_PATTERN.source, 'giu'), ''), plainText)
}

export function normalizeTags(tags: Note['tags']) {
	return pipe(
		tags,
		Array.map(tag => pipe(tag, String.toLowerCase, plainText, String.replace(/^#+/u, ''), String.replaceAll(' ', '-'))),
		Array.filter(String.isNonEmpty),
		Array.dedupe
	)
}

// `+` and `#` name languages (c, c++, c#), and a word of three letters or fewer keeps its s (ios, aws).
function tagKey(tag: string) {
	return pipe(tag, String.replaceAll(/[^a-z0-9+#]/gu, ''), String.replace(/^(.{2,}[^s])s$/u, '$1'))
}

// A plural, hyphen or spacing variant of a tag in use is that tag.
export function reuseTags(tags: Note['tags'], existing: Note['tags']) {
	return Array.dedupe(
		Array.map(tags, tag =>
			pipe(
				Array.findFirst(existing, known => tagKey(known) === tagKey(tag)),
				Option.getOrElse(() => tag)
			)
		)
	)
}

export function tagCounts(notes: NotesEvent['upserted']) {
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
				note.topics,
				note.body,
				note.screenText,
				note.transcript,
				note.url,
				...note.tags
			],
			Array.filter(Predicate.isNotUndefined),
			Array.join(' '),
			String.toLowerCase
		)
		return Array.every(terms, term => String.includes(term)(haystack))
	})
}
