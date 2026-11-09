import {Match, pipe} from 'effect'

import {Circle} from '@expo/ui/swift-ui'
import {accessibilityHidden, foregroundStyle, frame, strokeBorder} from '@expo/ui/swift-ui/modifiers'

import {colors} from '#components/theme.ts'

// The status dot marks a problem, never healthy state: error in red, warning in amber, off hollow, quiet muted.
export function StatusDot(props: {status: 'error' | 'off' | 'quiet' | 'warning'}) {
	return (
		<Circle
			modifiers={[
				pipe(
					Match.value(props.status),
					Match.when('error', () => foregroundStyle(colors.destructive)),
					Match.when('warning', () => foregroundStyle(colors.warning)),
					Match.when('off', () =>
						strokeBorder({content: colors.mutedForeground, shape: 'circle', style: {lineWidth: 1}})
					),
					Match.orElse(() => foregroundStyle(colors.mutedForeground))
				),
				frame({height: 7, width: 7}),
				accessibilityHidden(true)
			]}
		/>
	)
}
