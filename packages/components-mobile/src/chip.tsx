import {Boolean} from 'effect'

import {Button} from '@expo/ui/swift-ui'
import {
	buttonBorderShape,
	buttonStyle,
	controlSize,
	fixedSize,
	foregroundStyle,
	labelStyle,
	lineLimit,
	tint
} from '@expo/ui/swift-ui/modifiers'
import type {ColorValue} from 'react-native'

import {colors, text} from './theme.ts'

export function Chip(props: {
	active: boolean
	label: string
	onPress: () => void
	systemImage?: Parameters<typeof Button>[0]['systemImage']
	tint: ColorValue
}) {
	const look = Boolean.match(props.active, {
		onFalse: () => ({foreground: colors.foreground, style: 'glass' as const, tint: colors.foreground}),
		onTrue: () => ({foreground: colors.primaryForeground, style: 'glassProminent' as const, tint: props.tint})
	})
	return (
		<Button
			label={props.label}
			systemImage={props.systemImage}
			onPress={props.onPress}
			modifiers={[
				buttonStyle(look.style),
				buttonBorderShape('capsule'),
				controlSize('regular'),
				tint(look.tint),
				foregroundStyle(look.foreground),
				labelStyle('titleAndIcon'),
				text.detail,
				lineLimit(1),
				fixedSize()
			]}
		/>
	)
}
