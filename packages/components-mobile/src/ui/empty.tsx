import {Image, Text, VStack} from '@expo/ui/swift-ui'
import type {ImageProps} from '@expo/ui/swift-ui'
import {
	accessibilityHidden,
	background,
	clipShape,
	font,
	foregroundStyle,
	frame,
	imageScale,
	multilineTextAlignment,
	padding,
	strokeBorder
} from '@expo/ui/swift-ui/modifiers'
import type {ViewModifier} from '@expo/ui/swift-ui/modifiers'
import type {ReactNode} from 'react'

import {colors, radius, space} from '#components/theme.ts'

// shadcn's Empty on iOS, by the same names, laid out as SwiftUI's ContentUnavailableView: centered symbol, title, description, actions.
export function Empty(props: {children: ReactNode; modifiers?: ViewModifier[]}) {
	return (
		<VStack
			spacing={space[4]}
			modifiers={[
				...(props.modifiers ?? []),
				padding({all: space[6]}),
				frame({maxHeight: Infinity, maxWidth: Infinity}),
				background(colors.card),
				clipShape('roundedRectangle', radius),
				strokeBorder({content: colors.border, cornerRadius: radius, shape: 'roundedRectangle', style: {lineWidth: 2}}),
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
