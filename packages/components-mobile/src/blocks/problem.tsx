import {useAtomValue} from '@effect/atom-react'

import {Boolean, Function} from 'effect'

import {Button, HStack, Image, Menu, Section, Text} from '@expo/ui/swift-ui'
import {accessibilityLabel, buttonStyle, foregroundStyle, frame, menuIndicator} from '@expo/ui/swift-ui/modifiers'
import type {AsyncResult, Atom} from 'effect/reactivity'

import {StatusDot} from '#components/blocks/status-dot.tsx'
import {problemAgeAtom} from '#components/lib/problem.ts'
import {colors, space, text} from '#components/theme.ts'

export function Problem(props: {
	label: string
	onRetry: () => void
	saved?: boolean
	source: Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>
}) {
	const age = useAtomValue(problemAgeAtom(props.source))
	return (
		<Menu
			modifiers={[buttonStyle('plain'), menuIndicator('hidden')]}
			label={
				<HStack spacing={space[1]} modifiers={[frame({minHeight: 44, minWidth: 44}), accessibilityLabel(props.label)]}>
					{Boolean.match(props.saved === true, {
						onFalse: () => <StatusDot status="error" />,
						onTrue: () => (
							<Image systemName="externaldrive.badge.checkmark" modifiers={[foregroundStyle(colors.mutedForeground)]} />
						)
					})}
					<Text modifiers={[text.data, foregroundStyle(colors.mutedForeground)]}>
						{Boolean.match(props.saved === true, {onFalse: () => age, onTrue: Function.constant('Saved copy')})}
					</Text>
				</HStack>
			}
		>
			<Section title={props.label}>
				<Button label="Try Again" systemImage="arrow.clockwise" onPress={props.onRetry} />
			</Section>
		</Menu>
	)
}
