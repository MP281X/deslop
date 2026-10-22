import type {CommonViewModifierProps} from '@expo/ui/swift-ui'
import {requireNativeView} from 'expo'

import type {ChapterItem} from '#services/chapters/schema.ts'

// ios/PageStripView.swift reads `start` only for new chapters and counts `onPage` over their pages; modifiers pass through as Expo UI serializes them.
export const PageStrip = requireNativeView<
	CommonViewModifierProps & {
		chapters: Pick<ChapterItem, 'number' | 'pages'>[]
		onPage: (event: {nativeEvent: {index: number}}) => void
		start: number
	}
>('OpmNative', 'PageStripView')

// ios/CoverView.swift: a page as a thumbnail, sized and rounded by its modifiers.
export const Cover = requireNativeView<CommonViewModifierProps & {url: string}>('OpmNative', 'CoverView')
