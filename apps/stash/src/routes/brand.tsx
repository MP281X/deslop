import {useAtomValue} from '@effect/atom-react'

import {Option, String, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import {useColorScheme} from 'react-native'

import {assetAtom} from '#lib/utils.ts'
import type {Note} from '#services/notes/schema.ts'
import {BrandImage, brands} from '@deslop/components/mobile/brand'

// The app a note's link opens in, when stash has its logo.
export function brandOf(note: Note) {
	if (note.source === 'TikTok') return Option.some(brands.tiktok)
	if (note.source === 'X') return Option.some(brands.x)
	return pipe(
		Option.fromNullishOr(note.url),
		Option.flatMap(String.match(/^https?:\/\/(?:[\w-]+\.)*(?:youtube\.com|youtu\.be)\//u)),
		Option.map(() => brands.youtube)
	)
}

// The logo for the current appearance; nothing until its file is ready.
export function Brand(props: {brand: (typeof brands)[keyof typeof brands]; size: number}) {
	const uri = useAtomValue(assetAtom(useColorScheme() === 'dark' ? props.brand.dark : props.brand.light))
	if (!AsyncResult.isSuccess(uri)) return undefined
	return <BrandImage uri={uri.value} size={props.size} />
}
