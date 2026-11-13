import {Option, Record} from 'effect'

import {Button, Image, VStack} from '@expo/ui/swift-ui'
import type {ImageProps} from '@expo/ui/swift-ui'
import {
	accessibilityLabel,
	buttonBorderShape,
	buttonStyle,
	controlSize,
	font,
	foregroundStyle,
	frame,
	imageScale,
	padding,
	tint
} from '@expo/ui/swift-ui/modifiers'
import type {ViewModifier} from '@expo/ui/swift-ui/modifiers'
import type {ReactNode} from 'react'
import type {ColorValue} from 'react-native'

import {colors, space} from '#components/theme.ts'

// SwiftUI's ContentUnavailableView without words: one centred symbol, or a first run's one action. The label carries the words for VoiceOver.
export function Empty(props: {
	children?: ReactNode
	label?: string
	modifiers?: ViewModifier[]
	systemImage?: ImageProps['systemName']
}) {
	return (
		<VStack
			spacing={space[6]}
			modifiers={[
				...(props.modifiers ?? []),
				padding({all: space[8]}),
				frame({maxHeight: Infinity, maxWidth: Infinity})
			]}
		>
			{props.systemImage !== undefined && (
				<Image
					{...Record.getSomes({systemName: Option.fromUndefinedOr(props.systemImage)})}
					modifiers={[
						font({textStyle: 'largeTitle'}),
						imageScale('large'),
						foregroundStyle(colors.mutedForeground),
						...Option.match(Option.fromUndefinedOr(props.label), {
							onNone: () => [],
							onSome: label => [accessibilityLabel(label)]
						})
					]}
				/>
			)}
			{props.children}
		</VStack>
	)
}

// A first run's one action, in the app's hue.
export function EmptyAction(props: {
	label: string
	onPress: () => void
	systemImage?: ImageProps['systemName']
	tint: ColorValue
}) {
	return (
		<Button
			label={props.label}
			systemImage={props.systemImage}
			onPress={props.onPress}
			modifiers={[buttonStyle('glassProminent'), buttonBorderShape('capsule'), controlSize('large'), tint(props.tint)]}
		/>
	)
}
