import type {CommonViewModifierProps} from '@expo/ui/swift-ui'
import {requireNativeModule, requireNativeView} from 'expo'

// ios/Diagnostics.swift: the MetricKit reports iOS delivered since the last call, as JSON, each returned once.
export const OpmNative = requireNativeModule<{takeDiagnostics: () => string[]}>('OpmNative')

// ios/PageStripView.swift restores `start` once and extends the same pages when more arrive; `chapters` counts each chapter's pages, so a spread in a wide window never holds two.
export const PageStrip = requireNativeView<
	CommonViewModifierProps & {
		chapters: number[]
		pages: string[]
		onPage: (event: {nativeEvent: {index: number}}) => void
		start: number
	}
>('OpmNative', 'PageStripView')

// ios/CoverView.swift: a page as a thumbnail, sized and rounded by its modifiers.
export const Cover = requireNativeView<CommonViewModifierProps & {url: string}>('OpmNative', 'CoverView')
