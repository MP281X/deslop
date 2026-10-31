import {Boolean} from 'effect'

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

// shadcn's ToggleGroup on iOS, by the same names: one choice among glass capsules, scrolling sideways when they overflow.
export function ToggleGroup(props: {
	children: ReactNode
	modifiers?: ViewModifier[]
	onValueChange: (value: string) => void
	tint: ColorValue
	value: string
}) {
	return (
		<ScrollView axes="horizontal" showsIndicators={false} modifiers={props.modifiers}>
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
	const look = Boolean.match(group.value === props.value, {
		onFalse: () => ({foreground: colors.foreground, style: 'glass' as const, tint: colors.foreground}),
		onTrue: () => ({foreground: colors.primaryForeground, style: 'glassProminent' as const, tint: group.tint})
	})
	return (
		<Button
			label={props.children}
			systemImage={props.systemImage}
			onPress={() => group.onValueChange(props.value)}
			modifiers={[
				buttonStyle(look.style),
				buttonBorderShape('capsule'),
				controlSize('regular'),
				tint(look.tint),
				foregroundStyle(look.foreground),
				labelStyle('titleAndIcon'),
				text.detail,
				lineLimit(1),
				fixedSize()
			]}
		/>
	)
}
