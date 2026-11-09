import {Boolean} from 'effect'

import {Image, Text, VStack} from '@expo/ui/swift-ui'
import type {ImageProps} from '@expo/ui/swift-ui'
import {
	accessibilityHidden,
	background,
	border,
	clipShape,
	font,
	foregroundStyle,
	frame,
	imageScale,
	multilineTextAlignment,
	padding
} from '@expo/ui/swift-ui/modifiers'
import type {ViewModifier} from '@expo/ui/swift-ui/modifiers'
import type {ReactNode} from 'react'

import {colors, radius, space} from '#components/theme.ts'

// shadcn's Empty on iOS: standalone it is one translucent slab; inside a list section the row is the surface, so `surface` goes false.
export function Empty(props: {children: ReactNode; modifiers?: ViewModifier[]; surface?: boolean}) {
	return (
		<VStack
			spacing={space[4]}
			modifiers={[
				...(props.modifiers ?? []),
				...Boolean.match(props.surface === false, {
					onFalse: () => [
						background(colors.card),
						border({content: colors.border}),
						clipShape('roundedRectangle', radius)
					],
					onTrue: () => []
				}),
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
