import {useAtomValue} from '@effect/atom-react'

import {Option, String, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import {useColorScheme} from 'react-native'

import {assetAtom} from '#lib/utils.ts'
import type {NoteItem} from '#services/notes/schema.ts'
import {BrandImage, brands} from '@deslop/components/mobile/brand'

// The app a note's link opens in, when stash has its logo.
export function brandOf(note: NoteItem) {
	if (note.source === 'TikTok') return Option.some(brands.tiktok)
	if (note.source === 'X') return Option.some(brands.x)
	return pipe(
		Option.fromNullishOr(note.url),
		Option.flatMap(String.match(/^https?:\/\/(?:[\w-]+\.)*(?:youtube\.com|youtu\.be)\//u)),
		Option.map(() => brands.youtube)
	)
}

// The kinds of note the filter menu offers, in its order, with their symbols.
export const kinds = [
	{kind: 'tiktok', label: 'TikTok', symbol: 'play.rectangle'},
	{kind: 'x', label: 'X', symbol: 'xmark'},
	{kind: 'youtube', label: 'YouTube', symbol: 'play.tv'},
	{kind: 'web', label: 'Web', symbol: 'globe'},
	{kind: 'note', label: 'Notes', symbol: 'text.alignleft'},
	{kind: 'file', label: 'Photos and Videos', symbol: 'photo'}
] as const

export type Kind = (typeof kinds)[number]['kind']

export function kindOf(note: NoteItem): Kind {
	if (note.file !== undefined) return 'file'
	if (note.source === 'TikTok') return 'tiktok'
	if (note.source === 'X') return 'x'
	if (note.source === 'Note') return 'note'
	return Option.isSome(brandOf(note)) ? 'youtube' : 'web'
}

// The logo for the current appearance; nothing until its file is ready.
export function Brand(props: {brand: (typeof brands)[keyof typeof brands]; size: number}) {
	const uri = useAtomValue(assetAtom(useColorScheme() === 'dark' ? props.brand.dark : props.brand.light))
	if (!AsyncResult.isSuccess(uri)) return undefined
	return <BrandImage uri={uri.value} size={props.size} />
}
