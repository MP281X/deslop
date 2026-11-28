import {Array, Boolean, DateTime, Duration, Effect, Function, Option, Order, Record, Schema, String, pipe} from 'effect'

import {ageOf, dayOf} from '@deslop/runtime/shared/format'

import {NotesError} from './contract.ts'
import type {Kind, NoteItem, TagName} from './contract.ts'

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

export const URL_PATTERN = /https?:\/\/[^\s<>"]+/iu

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

export const kinds = {
	file: 'Photos and Videos',
	note: 'Notes',
	tiktok: 'TikTok',
	web: 'Web',
	x: 'X',
	youtube: 'YouTube'
} as const satisfies Record<Kind, string>

export function kindOf(note: NoteItem): Kind {
	if (Option.isSome(note.file)) return 'file'
	if (note.source === 'TikTok') return 'tiktok'
	if (note.source === 'X') return 'x'
	if (note.source === 'Note') return 'note'
	if (Option.exists(note.url, isYouTube)) return 'youtube'
	return 'web'
}

export function sourceLabelOf(note: NoteItem) {
	const kind = kindOf(note)
	return pipe(
		note.author,
		Option.orElse(() =>
			pipe(
				note.url,
				Option.filter(() => kind === 'web'),
				Option.map(url => String.replace(/^www\./u, '')(new URL(url).hostname))
			)
		),
		Option.getOrElse(() => kinds[kind])
	)
}

export function subjectOf(note: NoteItem) {
	if (Option.contains(note.file, 'image/jpeg')) return 'photo'
	if (Option.isSome(note.file)) return 'video'
	if (note.source === 'Note') return 'note'
	return 'link'
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

type Page = typeof Page.Type
// A page's path is its place in the pager and, for pictures, the server's route for it.
const Page = Schema.Struct({kind: Schema.Literals(['cover', 'image']), path: Schema.String})

// The pager's pages: the stored cover alone until the post's pictures are counted, then one page per picture. The cover is the post's first picture, so it stands for it and the phone downloads one fewer.
function pagesOf(cover: boolean, id: string, count: number) {
	if (count === 0) {
		if (!cover) return []
		return [Page.make({kind: 'cover', path: `${id}/cover`})]
	}
	return Array.makeBy(count, index => {
		const path = `${id}/media/${index}`
		if (cover && index === 0) return Page.make({kind: 'cover', path})
		return Page.make({kind: 'image', path})
	})
}

// A note's Markdown opens only web links, as the page reader keeps only http(s) anchors; a link to any other scheme, such as a phone number or an app, shows only its text.
export function webLinksOnly(line: string) {
	return pipe(
		line,
		String.replaceAll(/\[([^\]]*)\]\((?!https?:\/\/)[^)]*\)/giu, '$1'),
		String.replaceAll(/<(?!https?:\/\/)([a-z][\d+.a-z-]*:[^\s>]*)>/giu, '$1')
	)
}

export function savedOf(note: NoteItem, now: DateTime.Utc) {
	if (pipe(note.createdAt, DateTime.distance(now), Duration.isLessThan(Duration.days(1)))) {
		return ageOf(note.createdAt, now)
	}
	return dayOf(note.createdAt, now)
}

export function issueOf(note: NoteItem) {
	return Option.getOrElse(note.issue, () => `Couldn’t read this ${subjectOf(note)}`)
}

export function rowOf(note: NoteItem, now: DateTime.Utc) {
	return {
		id: note.id,
		line: Boolean.match(note.status === 'organizing', {
			onFalse: () => pipe([sourceLabelOf(note), note.summary], Array.filter(String.isNonEmpty), Array.join(' · ')),
			onTrue: () => `Reading this ${subjectOf(note)}`
		}),
		...Boolean.match(note.status === 'failed', {
			onFalse: () => ({}),
			onTrue: () => ({problem: {reason: issueOf(note), status: 'error' as const}})
		}),
		title: note.title,
		trailing: savedOf(note, now)
	}
}

export function pathsOf(id: string, cover: boolean, count: number) {
	return Array.map(pagesOf(cover, id, count), page => {
		if (page.kind === 'cover') return `/api/images/${id}`
		return `/api/notes/${page.path}`
	})
}

export function isWebLink(url: string) {
	return Option.isSome(String.match(/^https?:\/\//iu)(url))
}

// The link a copied text holds, with the scheme it may lack, or why none can be saved.
export const copiedLink = Effect.fnUntraced(function* (copy: string) {
	const text = String.trim(copy)
	if (String.isEmpty(text)) return yield* NotesError.make({message: 'Copy a link or image first.'})
	if (captureUrl(text) !== undefined) return text
	if (
		Option.isSome(String.match(/^[^\s/]+\.[^\s/]+(?:\/\S*)?$/u)(text)) &&
		captureUrl(`https://${text}`) !== undefined
	) {
		return `https://${text}`
	}
	return yield* NotesError.make({message: 'The copied text holds no link.'})
})
