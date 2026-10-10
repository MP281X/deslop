import {Image} from '@expo/ui/swift-ui'
import {frame, resizable} from '@expo/ui/swift-ui/modifiers'

import tiktokDark from './icons/tiktok-dark.png'
import tiktokLight from './icons/tiktok-light.png'
import xDark from './icons/x-dark.png'
import xLight from './icons/x-light.png'
import youtube from './icons/youtube.png'

// svgl's brand logos (https://svgl.app), kept as SVG and as 60-pixel PNGs, because SwiftUI images read bitmap files.
// Regenerate a PNG from apps/stash, where sharp is installed:
// node --input-type=module -e "import sharp from 'sharp'; await sharp('<svg>').resize(60, 60, {fit: 'contain',
// background: '#00000000'}).png().toFile('<png>')"
// Each brand has a logo for light and one for dark backgrounds; Metro turns each import into an asset module id.
export const brands = {
	tiktok: {dark: tiktokDark, light: tiktokLight},
	x: {dark: xDark, light: xLight},
	youtube: {dark: youtube, light: youtube}
}

// A logo at a fixed square size; the app resolves the asset module id to a local file first.
export function BrandImage(props: {size: number; uri: string}) {
	return <Image uiImage={props.uri} modifiers={[resizable(), frame({height: props.size, width: props.size})]} />
}
