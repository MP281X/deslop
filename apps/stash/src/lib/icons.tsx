import {useAtomValue} from '@effect/atom-react'

import {Boolean} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import {useColorScheme} from 'react-native'

import {assetAtom} from '@deslop/components-mobile/lib/images'
import tiktokDark from '@deslop/components-mobile/ui/svgs/tiktok-icon-dark.svg'
import tiktokLight from '@deslop/components-mobile/ui/svgs/tiktok-icon-light.svg'
import xLight from '@deslop/components-mobile/ui/svgs/x.svg'
import xDark from '@deslop/components-mobile/ui/svgs/x_dark.svg'
import youtube from '@deslop/components-mobile/ui/svgs/youtube.svg'

import {Logo} from '#modules/native/index.ts'

export type BrandArtwork = {dark: string; light: string}

export const brands = {
	tiktok: {dark: tiktokDark, light: tiktokLight},
	x: {dark: xDark, light: xLight},
	youtube: {dark: youtube, light: youtube}
} satisfies Record<string, BrandArtwork>

export function BrandLogo(props: {brand: BrandArtwork; size: number}) {
	const uri = useAtomValue(
		assetAtom(
			Boolean.match(useColorScheme() === 'dark', {onFalse: () => props.brand.light, onTrue: () => props.brand.dark})
		)
	)
	if (!AsyncResult.isSuccess(uri)) return undefined
	return <Logo uri={uri.value} size={props.size} />
}

// Menus draw icons in the text color, so they take the light logo's shape.
export function BrandIcon(props: {brand: BrandArtwork}) {
	const uri = useAtomValue(assetAtom(props.brand.light))
	if (!AsyncResult.isSuccess(uri)) return undefined
	return <Logo uri={uri.value} size={18} template />
}
