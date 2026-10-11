import {useAtomValue} from '@effect/atom-react'

import {AsyncResult} from 'effect/reactivity'
import {requireNativeView} from 'expo'
import {useColorScheme} from 'react-native'

import tiktokDark from './svgs/tiktok-icon-dark.svg'
import tiktokLight from './svgs/tiktok-icon-light.svg'
import xLight from './svgs/x.svg'
import xDark from './svgs/x_dark.svg'
import youtube from './svgs/youtube.svg'

import {assetAtom} from '#lib/utils.ts'

const Logo = requireNativeView<{size: number; template?: boolean; uri: string}>('DeslopComponents', 'Logo')

export const brands = {
	tiktok: {dark: tiktokDark, light: tiktokLight},
	x: {dark: xDark, light: xLight},
	youtube: {dark: youtube, light: youtube}
}

export type Brand = (typeof brands)[keyof typeof brands]

export function BrandLogo(props: {brand: Brand; size: number}) {
	const uri = useAtomValue(assetAtom(useColorScheme() === 'dark' ? props.brand.dark : props.brand.light))
	if (!AsyncResult.isSuccess(uri)) return undefined
	return <Logo uri={uri.value} size={props.size} />
}

// Menus draw icons in the text color, so they take the light logo's shape.
export function BrandIcon(props: {brand: Brand}) {
	const uri = useAtomValue(assetAtom(props.brand.light))
	if (!AsyncResult.isSuccess(uri)) return undefined
	return <Logo uri={uri.value} size={18} template />
}
