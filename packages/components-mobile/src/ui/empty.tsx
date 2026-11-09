import {Image, Text, VStack} from '@expo/ui/swift-ui'
import type {ImageProps} from '@expo/ui/swift-ui'
import {
	accessibilityHidden,
	background,
	border,
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

// shadcn's Empty on iOS, by the same names, laid out as a hard-edged block: symbol, title, description, actions.
export function Empty(props: {children: ReactNode; modifiers?: ViewModifier[]}) {
	return (
		<VStack
			spacing={space[4]}
			modifiers={[
				...(props.modifiers ?? []),
				padding({all: space[8]}),
				frame({maxHeight: Infinity, maxWidth: Infinity}),
				background(colors.card),
				border({content: colors.border, width: 2}),
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
				font({textStyle: 'largeTitle'}),
				imageScale('large'),
				foregroundStyle(colors.mutedForeground),
				accessibilityHidden(true)
			]}
		/>
	)
}

export function EmptyTitle(props: {children: string}) {
	return (
		<Text modifiers={[font({textStyle: 'title2', weight: 'black'}), foregroundStyle(colors.foreground)]}>
			{props.children}
		</Text>
	)
}

export function EmptyDescription(props: {children: string}) {
	return <Text modifiers={[text.data, foregroundStyle(colors.mutedForeground)]}>{props.children}</Text>
}

export function EmptyContent(props: {children: ReactNode}) {
	return <VStack spacing={space[3]}>{props.children}</VStack>
}
