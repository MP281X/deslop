import {useAtomValue} from '@effect/atom-react'

import {Boolean, DateTime, Effect, Option, Stream} from 'effect'

import {Button, HStack, Image, Menu, Section, Text} from '@expo/ui/swift-ui'
import {accessibilityLabel, buttonStyle, foregroundStyle, frame, menuIndicator} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult, Atom} from 'effect/reactivity'
import {useId} from 'react'

import {StatusDot} from '#components/status-dot.tsx'
import {colors, space, text} from '#components/theme.ts'
import {ageOf} from '#lib/format.ts'

const ageAtom = Atom.family((_id: string) =>
	Atom.withLabel(
		Atom.make(
			Stream.unwrap(
				Effect.gen(function* () {
					const since = yield* DateTime.now
					return Stream.mapEffect(Stream.tick('1 minute'), () => Effect.map(DateTime.now, now => ageOf(since, now)))
				})
			)
		),
		'problem-age'
	)
)

// Native menus own presentation and touch recovery; a saved copy stays quiet instead of becoming an error card.
export function Problem(props: {label: string; onRetry: () => void; saved?: boolean}) {
	const age = useAtomValue(ageAtom(useId()))
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
						{Boolean.match(props.saved === true, {
							onFalse: () => Option.getOrElse(AsyncResult.value(age), () => 'now'),
							onTrue: () => 'Saved copy'
						})}
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
