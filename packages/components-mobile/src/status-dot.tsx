import {Boolean, Schema} from 'effect'

import {Circle} from '@expo/ui/swift-ui'
import {accessibilityHidden, foregroundStyle, frame} from '@expo/ui/swift-ui/modifiers'

import {colors} from '#components/theme.ts'

export type ProblemStatus = typeof ProblemStatus.Type
export const ProblemStatus = Schema.Literals(['error', 'warning'])

// The status dot marks a problem, never healthy state: error in red, warning in amber.
export function StatusDot(props: {status: ProblemStatus}) {
	return (
		<Circle
			modifiers={[
				foregroundStyle(
					Boolean.match(props.status === 'error', {onFalse: () => colors.warning, onTrue: () => colors.destructive})
				),
				frame({height: 7, width: 7}),
				accessibilityHidden(true)
			]}
		/>
	)
}
