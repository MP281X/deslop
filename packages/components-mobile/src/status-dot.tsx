import {Match, Option, pipe} from 'effect'

import {Circle} from '@expo/ui/swift-ui'
import {
	accessibilityHidden,
	accessibilityLabel,
	foregroundStyle,
	frame,
	strokeBorder
} from '@expo/ui/swift-ui/modifiers'
import type {ColorValue} from 'react-native'

import {colors} from '#components/theme.ts'

// The status dot, as the web's StatusDot: live in the app's hue, quiet muted, off hollow, warning and error in theirs.
export function StatusDot(props: {
	label?: string
	status: 'error' | 'live' | 'off' | 'quiet' | 'warning'
	tint: ColorValue
}) {
	return (
		<Circle
			modifiers={[
				pipe(
					Match.value(props.status),
					Match.when('live', () => foregroundStyle(props.tint)),
					Match.when('error', () => foregroundStyle(colors.destructive)),
					Match.when('warning', () => foregroundStyle(colors.warning)),
					Match.when('off', () =>
						strokeBorder({content: colors.mutedForeground, shape: 'circle', style: {lineWidth: 1}})
					),
					Match.orElse(() => foregroundStyle(colors.mutedForeground))
				),
				frame({height: 7, width: 7}),
				...Option.match(Option.fromUndefinedOr(props.label), {
					onNone: () => [accessibilityHidden(true)],
					onSome: label => [accessibilityLabel(label)]
				})
			]}
		/>
	)
}
