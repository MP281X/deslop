import type {CommonViewModifierProps} from '@expo/ui/swift-ui'
import {requireNativeView} from 'expo'

// ios/PageStripView.swift reads `start` only for a new set of pages; its event-free modifiers pass through as Expo UI serializes them.
export const PageStrip = requireNativeView<
	CommonViewModifierProps & {onPage: (event: {nativeEvent: {index: number}}) => void; pages: string[]; start: number}
>('OpmNative', 'PageStripView')
