import {Array, Boolean, Function, Schema} from 'effect'

import {HStack, ScrollView} from '@expo/ui/swift-ui'
import {fixedSize, foregroundStyle, lineLimit} from '@expo/ui/swift-ui/modifiers'
import type {ViewModifier} from '@expo/ui/swift-ui/modifiers'
import {createContext, useContext} from 'react'
import type {ReactNode} from 'react'

import {colors, space, text} from '#components/theme.ts'
import {Button} from '#components/ui/button.tsx'

// The web's `bg-muted` when pressed is a glass button on a plain one; the outline variant raises a pressed item to the app's tint.
const TOGGLE_VARIANTS = {default: {off: 'ghost', on: 'outline'}, outline: {off: 'outline', on: 'default'}} as const

export type ToggleGroupSize = typeof ToggleGroupSize.Type
const ToggleGroupSize = Schema.Literals(['default', 'sm', 'lg'])

export type ToggleGroupVariant = typeof ToggleGroupVariant.Type
const ToggleGroupVariant = Schema.Literals(['default', 'outline'])

const ToggleGroupContext = createContext<{
	onValueChange: (value: string[]) => void
	size: ToggleGroupSize
	value: readonly string[]
	variant: ToggleGroupVariant
}>({onValueChange: Function.constUndefined, size: 'default', value: [], variant: 'default'})

// Single selection, as the web's group: pressing the pressed item clears the value.
export function ToggleGroup(props: {
	children: ReactNode
	modifiers?: ViewModifier[]
	onValueChange: (value: string[]) => void
	size?: ToggleGroupSize
	value: readonly string[]
	variant?: ToggleGroupVariant
}) {
	return (
		<ScrollView axes="horizontal" showsIndicators={false} modifiers={props.modifiers}>
			<HStack spacing={space[2]}>
				<ToggleGroupContext
					value={{
						onValueChange: props.onValueChange,
						size: props.size ?? 'default',
						value: props.value,
						variant: props.variant ?? 'default'
					}}
				>
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
	const pressed = Array.contains(group.value, props.value)
	return (
		<Button
			systemImage={props.systemImage}
			size={group.size}
			variant={Boolean.match(pressed, {
				onFalse: () => TOGGLE_VARIANTS[group.variant].off,
				onTrue: () => TOGGLE_VARIANTS[group.variant].on
			})}
			onPress={() => group.onValueChange(Boolean.match(pressed, {onFalse: () => [props.value], onTrue: () => []}))}
			modifiers={[
				...Boolean.match(pressed && group.variant === 'outline', {
					onFalse: () => [],
					onTrue: () => [foregroundStyle(colors.primaryForeground)]
				}),
				text.detail,
				lineLimit(1),
				fixedSize()
			]}
		>
			{props.children}
		</Button>
	)
}
