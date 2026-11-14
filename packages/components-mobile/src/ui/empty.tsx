import {VStack} from '@expo/ui/swift-ui'
import {font, foregroundStyle, frame, imageScale, padding} from '@expo/ui/swift-ui/modifiers'
import type {ViewModifier} from '@expo/ui/swift-ui/modifiers'
import type {ReactNode} from 'react'

import {colors, space} from '#components/theme.ts'

// SwiftUI's ContentUnavailableView without words: a centred symbol, or a first run's one action. The symbol's accessibility label carries the words.
export function Empty(props: {children: ReactNode; modifiers?: ViewModifier[]}) {
	return (
		<VStack
			spacing={space[6]}
			modifiers={[
				...(props.modifiers ?? []),
				padding({all: space[8]}),
				frame({maxHeight: Infinity, maxWidth: Infinity})
			]}
		>
			{props.children}
		</VStack>
	)
}

// An Image child takes the large symbol size and the muted colour.
export function EmptyMedia(props: {children: ReactNode}) {
	return (
		<VStack modifiers={[font({textStyle: 'largeTitle'}), imageScale('large'), foregroundStyle(colors.mutedForeground)]}>
			{props.children}
		</VStack>
	)
}

export function EmptyContent(props: {children: ReactNode}) {
	return <VStack spacing={space[3]}>{props.children}</VStack>
}
