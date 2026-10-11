import {Image} from '@expo/ui/swift-ui'
import {frame, resizable} from '@expo/ui/swift-ui/modifiers'

import tiktokMenu from './icons/menu/tiktok.png'
import xMenu from './icons/menu/x.png'
import youtubeMenu from './icons/menu/youtube.png'
import tiktokDark from './icons/tiktok-dark.png'
import tiktokLight from './icons/tiktok-light.png'
import xDark from './icons/x-dark.png'
import xLight from './icons/x-light.png'
import youtube from './icons/youtube.png'

// svgl's brand logos (https://svgl.app), kept as SVG and as 60-pixel PNGs, because SwiftUI images read bitmap files.
// Regenerate a PNG from apps/stash, where sharp is installed:
// node --input-type=module -e "import sharp from 'sharp'; await sharp('<svg>').resize(60, 60, {fit: 'contain',
// background: '#00000000'}).png().toFile('<png>')"
// Each brand has a logo for light and one for dark backgrounds; Metro turns each import into an asset module id. The
// menu shape is the logo's outline as a 54-pixel image for 18 points, which menus draw in the text color like a symbol.
export const brands = {
	tiktok: {dark: tiktokDark, light: tiktokLight, menu: tiktokMenu},
	x: {dark: xDark, light: xLight, menu: xMenu},
	youtube: {dark: youtube, light: youtube, menu: youtubeMenu}
}

// A logo at a fixed square size; the app resolves the asset module id to a local file first.
export function BrandImage(props: {size: number; uri: string}) {
	return <Image uiImage={props.uri} modifiers={[resizable(), frame({height: props.size, width: props.size})]} />
}
