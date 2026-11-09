import {Image, Text, VStack} from '@expo/ui/swift-ui'
import type {ImageProps} from '@expo/ui/swift-ui'
import {
	accessibilityHidden,
	font,
	foregroundStyle,
	frame,
	imageScale,
	multilineTextAlignment,
	padding
} from '@expo/ui/swift-ui/modifiers'
import type {ViewModifier} from '@expo/ui/swift-ui/modifiers'
import type {ReactNode} from 'react'

import {colors, space, text} from '#components/theme.ts'

// shadcn's Empty on iOS, by the same names, laid out as SwiftUI's ContentUnavailableView: centered symbol, title, description, actions.
export function Empty(props: {children: ReactNode; modifiers?: ViewModifier[]}) {
	return (
		<VStack
			spacing={space[4]}
			modifiers={[
				...(props.modifiers ?? []),
				padding({all: space[6]}),
				frame({maxHeight: Infinity, maxWidth: Infinity}),
				multilineTextAlignment('center')
			]}
		>
			{props.children}
		</VStack>
	)
}

export function EmptyHeader(props: {children: ReactNode}) {
	return <VStack spacing={space[2]}>{props.children}</VStack>
}

export function EmptyMedia(props: {systemImage: ImageProps['systemName']}) {
	return (
		<Image
			systemName={props.systemImage}
			modifiers={[
				font({textStyle: 'title2'}),
				imageScale('medium'),
				foregroundStyle(colors.primary),
				accessibilityHidden(true)
			]}
		/>
	)
}

export function EmptyTitle(props: {children: string}) {
	return (
		<Text modifiers={[font({textStyle: 'title3', weight: 'semibold'}), foregroundStyle(colors.foreground)]}>
			{props.children}
		</Text>
	)
}

export function EmptyDescription(props: {children: string}) {
	return (
		<Text modifiers={[text.detail, foregroundStyle(colors.mutedForeground), multilineTextAlignment('center')]}>
			{props.children}
		</Text>
	)
}

export function EmptyContent(props: {children: ReactNode}) {
	return <VStack spacing={space[3]}>{props.children}</VStack>
}
