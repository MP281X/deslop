import {Boolean, Record, Option} from 'effect'

import {Button, HStack, ScrollView} from '@expo/ui/swift-ui'
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
import type {ViewModifier} from '@expo/ui/swift-ui/modifiers'
import {createContext, useContext} from 'react'
import type {ReactNode} from 'react'
import type {ColorValue} from 'react-native'

import {colors, space, text} from '#components/theme.ts'

const ToggleGroupContext = createContext<{onValueChange: (value: string) => void; tint: ColorValue; value: string}>({
	onValueChange: () => undefined,
	tint: colors.foreground,
	value: ''
})

export function ToggleGroup(props: {
	children: ReactNode
	modifiers?: ViewModifier[]
	onValueChange: (value: string) => void
	tint: ColorValue
	value: string
}) {
	return (
		<ScrollView
			axes="horizontal"
			showsIndicators={false}
			{...Record.getSomes({modifiers: Option.fromUndefinedOr(props.modifiers)})}
		>
			<HStack spacing={space[2]}>
				<ToggleGroupContext value={{onValueChange: props.onValueChange, tint: props.tint, value: props.value}}>
					{props.children}
				</ToggleGroupContext>
			</HStack>
		</ScrollView>
	)
}

export function ToggleGroupItem(props: {
	children: string
	systemImage?: Parameters<typeof Button>[0]['systemImage']
	value: string
}) {
	const group = useContext(ToggleGroupContext)
	const selected = group.value === props.value
	return (
		<Button
			label={props.children}
			{...Record.getSomes({systemImage: Option.fromUndefinedOr(props.systemImage)})}
			onPress={() => group.onValueChange(props.value)}
			{...Record.getSomes({
				modifiers: Option.fromUndefinedOr([
					buttonStyle(
						Boolean.match(selected, {onFalse: () => 'glass' as const, onTrue: () => 'glassProminent' as const})
					),
					buttonBorderShape('capsule'),
					controlSize('regular'),
					...Boolean.match(selected, {
						onFalse: () => [],
						onTrue: () => [tint(group.tint), foregroundStyle(colors.primaryForeground)]
					}),
					labelStyle('titleAndIcon'),
					text.detail,
					lineLimit(1),
					fixedSize()
				])
			})}
		/>
	)
}
