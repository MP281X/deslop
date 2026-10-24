import type {CommonViewModifierProps} from '@expo/ui/swift-ui'
import {requireNativeModule, requireNativeView} from 'expo'
import type {ColorValue} from 'react-native'

// ios/Diagnostics.swift: the MetricKit reports iOS delivered since the last call, as JSON, each returned once.
export const OpmNative = requireNativeModule<{takeDiagnostics: () => string[]}>('OpmNative')

// ios/PageStripView.swift restores `start` once and extends the same strip when more pages arrive.
export const PageStrip = requireNativeView<
	CommonViewModifierProps & {pages: string[]; onPage: (event: {nativeEvent: {index: number}}) => void; start: number}
>('OpmNative', 'PageStripView')

// ios/CoverView.swift: a page as a thumbnail, sized and rounded by its modifiers.
export const Cover = requireNativeView<CommonViewModifierProps & {url: string}>('OpmNative', 'CoverView')

// ios/ChapterProgressView.swift: a gray disc that fills with `accent` as `fraction` of the chapter is read and turns `read` once read, sized by its modifiers.
export const ChapterProgress = requireNativeView<
	CommonViewModifierProps & {accent: ColorValue; fraction: number; read: ColorValue}
>('OpmNative', 'ChapterProgressView')
