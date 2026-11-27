import {Array, Function, Option, Order, Record, String, pipe} from 'effect'

import {isYouTube} from '#contracts'
import type {Kind, NoteItem, TagName} from '#contracts'

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
