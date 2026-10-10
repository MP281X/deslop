import {Hash} from 'effect'

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

import {chart, colors, mono} from '@deslop/components/mobile/theme'

// A stable color for a tag from the theme's chart colors, so a tag looks the same on every screen.
export function tagColor(name: string) {
	return (
		chart[((Hash.string(name) % chart.length) + chart.length) % chart.length] ?? {
			fill: colors.foreground,
			text: colors.background
		}
	)
}

// A capsule like the category chips of iOS Mail: gray when off, filled with its color when on. A chip with a symbol
// shows only the symbol while off.
export function Chip(props: {
	active: boolean
	color: {fill: Parameters<typeof tint>[0]; text: Parameters<typeof foregroundStyle>[0]}
	label: string
	onPress: () => void
	systemImage?: Parameters<typeof Button>[0]['systemImage']
}) {
	return (
		<Button
			label={props.label}
			systemImage={props.systemImage}
			onPress={props.onPress}
			modifiers={[
				buttonStyle(props.active ? 'borderedProminent' : 'bordered'),
				buttonBorderShape('capsule'),
				controlSize('regular'),
				tint(props.active ? props.color.fill : colors.mutedForeground),
				foregroundStyle(props.active ? props.color.text : colors.foreground),
				labelStyle(props.systemImage !== undefined && !props.active ? 'iconOnly' : 'titleAndIcon'),
				mono('caption', 13),
				lineLimit(1),
				fixedSize()
			]}
		/>
	)
}
