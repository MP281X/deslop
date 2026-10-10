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

// A capsule like the category chips of iOS Mail: gray when off, filled with the accent when on. A chip with a symbol
// shows only the symbol while off.
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
				buttonStyle(props.active ? 'borderedProminent' : 'bordered'),
				buttonBorderShape('capsule'),
				controlSize('regular'),
				tint(props.active ? colors.primary : colors.foreground),
				foregroundStyle(props.active ? colors.primaryForeground : colors.foreground),
				labelStyle(props.systemImage !== undefined && !props.active ? 'iconOnly' : 'titleAndIcon'),
				mono('caption', 13),
				lineLimit(1),
				fixedSize()
			]}
		/>
	)
}
