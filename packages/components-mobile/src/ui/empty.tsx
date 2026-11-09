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

import {colors, space} from '#components/theme.ts'

export function Empty(props: {children: ReactNode; modifiers?: ViewModifier[]}) {
	return (
		<VStack
			spacing={space[4]}
			modifiers={[
				...(props.modifiers ?? []),
				padding({all: space[8]}),
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
		<Text modifiers={[font({textStyle: 'title2', weight: 'semibold'}), foregroundStyle(colors.foreground)]}>
			{props.children}
		</Text>
	)
}

export function EmptyDescription(props: {children: string}) {
	return <Text modifiers={[font({textStyle: 'body'}), foregroundStyle(colors.mutedForeground)]}>{props.children}</Text>
}

export function EmptyContent(props: {children: ReactNode}) {
	return <VStack spacing={space[3]}>{props.children}</VStack>
}
