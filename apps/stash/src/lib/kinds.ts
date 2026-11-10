import type {Record} from 'effect'
import {Option, Schema, String, pipe} from 'effect'

import {brands} from '#lib/icons.tsx'
import {isYouTube} from '#services/notes/lib/utils.ts'
import type {Kind, NoteItem} from '#services/notes/schema.ts'
import {Brand} from '#services/notes/schema.ts'

export const kinds = {
	file: {label: 'Photos and Videos', symbol: 'photo'},
	note: {label: 'Notes', symbol: 'text.alignleft'},
	tiktok: {label: 'TikTok', logo: brands.tiktok},
	web: {label: 'Web', symbol: 'globe'},
	x: {label: 'X', logo: brands.x},
	youtube: {label: 'YouTube', logo: brands.youtube}
} as const satisfies Record<Kind, unknown>

export function kindOf(note: NoteItem) {
	if (note.file !== undefined) return 'file'
	if (note.source === 'TikTok') return 'tiktok'
	if (note.source === 'X') return 'x'
	if (note.source === 'Note') return 'note'
	if (Option.exists(Option.fromNullishOr(note.url), isYouTube)) return 'youtube'
	return 'web'
}

export function siteOf(note: NoteItem) {
	return pipe(
		Option.fromNullishOr(note.url),
		Option.filter(() => kindOf(note) === 'web'),
		Option.flatMap(url => Option.liftThrowable(() => new URL(url).hostname)()),
		Option.map(String.replace(/^www\./u, ''))
	)
}

export function brandOf(note: NoteItem) {
	return Option.liftPredicate(kindOf(note), Schema.is(Brand))
}

export function appOf(note: NoteItem) {
	return Option.map(brandOf(note), brand => kinds[brand].label)
}
