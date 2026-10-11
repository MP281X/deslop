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

import {colors, mono} from '@deslop/components/mobile/theme'

// A capsule in the system's glass style, like the category chips of iOS Mail: clear when off, filled with the accent when
// on. Every chip keeps its
// label, so selecting one never shifts the row.
export function Chip(props: {
	active: boolean
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
				buttonStyle(props.active ? 'glassProminent' : 'glass'),
				buttonBorderShape('capsule'),
				controlSize('large'),
				tint(props.active ? colors.primary : colors.foreground),
				foregroundStyle(props.active ? colors.primaryForeground : colors.foreground),
				labelStyle('titleAndIcon'),
				mono('caption', 13),
				lineLimit(1),
				fixedSize()
			]}
		/>
	)
}
