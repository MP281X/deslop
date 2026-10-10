import {Array, Option, Order, Record, String, pipe} from 'effect'

import type {Note, NotesState, Source} from '#services/notes/schema.ts'

const urlPattern = /https?:\/\/[^\s<>"]+/iu

const xHosts = ['twitter.com', 'www.twitter.com', 'mobile.twitter.com', 'x.com', 'www.x.com', 'mobile.x.com']

const trackingParameters = [
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

// TikTok and X links name the post in their path, so their whole query is share tracking.
function canonicalUrl(link: string) {
	const url = new URL(link)
	if (Array.contains(xHosts, url.hostname)) url.hostname = 'x.com'
	if (sourceFor(url.href) === 'Website') {
		for (const key of trackingParameters) url.searchParams.delete(key)
	} else {
		url.search = ''
	}
	url.hash = ''
	return url.href
}

// The first link in the text without tracking data, so the same post shared twice maps to one note.
export function captureUrl(text: string) {
	return pipe(
		String.match(urlPattern)(text),
		Option.flatMap(Array.head),
		Option.map(String.replace(/[.,;:!?)\]]+$/u, '')),
		Option.flatMap(Option.liftThrowable(canonicalUrl)),
		Option.getOrNull
	)
}

export function sourceFor(url: string | null): Source {
	if (url === null) return 'Note'
	const host = new URL(url).hostname
	if (Array.contains(xHosts, host) || host === 't.co') return 'X'
	if (host === 'tiktok.com' || String.endsWith('.tiktok.com')(host)) return 'TikTok'
	return 'Website'
}

// The text the user wrote around the link.
export function commentFor(text: string) {
	return pipe(text, String.replace(new RegExp(urlPattern.source, 'giu'), ''), plainText)
}

export function plainText(text: string) {
	return pipe(text, String.replace(/\s+/gu, ' '), String.trim)
}

export function normalizeTags(tags: Note['tags']) {
	return pipe(
		tags,
		// A tag is one token, so a space becomes a hyphen and `#web design` cannot read as two tags.
		Array.map(tag =>
			pipe(
				tag,
				String.toLowerCase,
				plainText,
				String.replace(/^#+/u, ''),
				String.replace(/ /gu, '-'),
				String.slice(0, 40)
			)
		),
		Array.filter(String.isNonEmpty),
		Array.dedupe
	)
}

// Tags ordered by how many notes use them, then by name.
export function tagCounts(notes: NotesState['notes']) {
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

// Every word must appear in the note; a word written as #tag must equal one of its tags.
export function findNotes(notes: NotesState['notes'], query: string) {
	const words = pipe(query, String.toLowerCase, String.split(/\s+/u), Array.filter(String.isNonEmpty))
	const tags = pipe(
		words,
		Array.filter(String.startsWith('#')),
		Array.map(String.slice(1)),
		Array.filter(String.isNonEmpty)
	)
	const terms = Array.filter(words, word => !String.startsWith('#')(word))
	return Array.filter(notes, note => {
		if (!Array.every(tags, tag => Array.contains(note.tags, tag))) return false
		const haystack = pipe(
			[
				note.title,
				note.summary,
				note.author,
				note.text,
				note.content,
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
