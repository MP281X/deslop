import {Image, Text, VStack} from '@expo/ui/swift-ui'
import type {ImageProps} from '@expo/ui/swift-ui'
import {font, foregroundStyle, frame, multilineTextAlignment, padding} from '@expo/ui/swift-ui/modifiers'
import type {ViewModifier} from '@expo/ui/swift-ui/modifiers'
import type {ReactNode} from 'react'

import {colors, space} from '#components/theme.ts'

// shadcn's Empty on iOS, by the same names, laid out as SwiftUI's ContentUnavailableView: centered symbol, title, description, actions.
export function Empty(props: {children: ReactNode; modifiers?: ViewModifier[]}) {
	return (
		<VStack
			spacing={space[4]}
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

export function EmptyHeader(props: {children: ReactNode}) {
	return <VStack spacing={space[2]}>{props.children}</VStack>
}

export function EmptyMedia(props: {systemImage: ImageProps['systemName']}) {
	return (
		<Image
			systemName={props.systemImage}
			size={44}
			modifiers={[foregroundStyle(colors.mutedForeground), padding({bottom: space[2]})]}
		/>
	)
}

export function EmptyTitle(props: {children: string}) {
	return (
		<Text modifiers={[font({textStyle: 'title2', weight: 'bold'}), foregroundStyle(colors.foreground)]}>
			{props.children}
		</Text>
	)
}

export function EmptyDescription(props: {children: string}) {
	return (
		<Text
			modifiers={[font({textStyle: 'body'}), foregroundStyle(colors.mutedForeground), multilineTextAlignment('center')]}
		>
			{props.children}
		</Text>
	)
}

export function EmptyContent(props: {children: ReactNode}) {
	return <VStack spacing={space[2]}>{props.children}</VStack>
}
