import {Option, String, pipe} from 'effect'

import {isYouTube} from '#services/notes/lib/utils.ts'
import type {Kind, NoteItem} from '#services/notes/schema.ts'

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
