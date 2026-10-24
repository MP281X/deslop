import {Boolean, Option} from 'effect'

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

import {colors, mono} from './theme.ts'

export function Chip(props: {
	active: boolean
	label: string
	onPress: () => void
	systemImage?: Parameters<typeof Button>[0]['systemImage']
}) {
	const look = Boolean.match(props.active, {
		onFalse: () => ({foreground: colors.foreground, style: 'glass' as const, tint: colors.foreground}),
		onTrue: () => ({foreground: colors.primaryForeground, style: 'glassProminent' as const, tint: colors.primary})
	})
	return (
		<Button
			label={props.label}
			{...Option.match(Option.fromUndefinedOr(props.systemImage), {
				onNone: () => ({}),
				onSome: systemImage => ({systemImage})
			})}
			onPress={props.onPress}
			modifiers={[
				buttonStyle(look.style),
				buttonBorderShape('capsule'),
				controlSize('regular'),
				tint(look.tint),
				foregroundStyle(look.foreground),
				labelStyle('titleAndIcon'),
				mono('caption', 13),
				lineLimit(1),
				fixedSize()
			]}
		/>
	)
}
