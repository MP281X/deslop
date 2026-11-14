import {Option, Schema} from 'effect'

import {HStack, List, Text, VStack} from '@expo/ui/swift-ui'
import {
	accessibilityElement,
	contentShape,
	foregroundStyle,
	frame,
	lineLimit,
	listRowInsets,
	listRowSeparator,
	listStyle,
	onTapGesture,
	scrollEdgeEffectStyle,
	shapes
} from '@expo/ui/swift-ui/modifiers'
import type {ViewModifier} from '@expo/ui/swift-ui/modifiers'
import type {ReactNode} from 'react'

import {colors, space, text} from '#components/theme.ts'

export type ItemAlignment = typeof ItemAlignment.Type
const ItemAlignment = Schema.Literals(['center', 'top'])

// A caller's modifiers come first, so they win over the defaults like a className.

// Row modifiers for an ItemGroup, put on the row's outermost view such as its SwipeActions.
export const itemRow = [
	frame({minHeight: 48}),
	listRowInsets({bottom: space[3], leading: space[4], top: space[3], trailing: space[4]}),
	listRowSeparator('hidden')
]

export function ItemGroup(props: {children: ReactNode; modifiers?: ViewModifier[]}) {
	return (
		<List modifiers={[...(props.modifiers ?? []), scrollEdgeEffectStyle('soft'), listStyle('plain')]}>
			{props.children}
		</List>
	)
}

export function Item(props: {
	alignment?: ItemAlignment
	children: ReactNode
	modifiers?: ViewModifier[]
	onPress?: () => void
}) {
	return (
		<HStack
			alignment={props.alignment ?? 'center'}
			spacing={space[3]}
			modifiers={[
				...(props.modifiers ?? []),
				frame({alignment: 'leading', maxWidth: Infinity}),
				contentShape(shapes.rectangle()),
				...Option.match(Option.fromUndefinedOr(props.onPress), {
					onNone: () => [],
					onSome: press => [onTapGesture(press)]
				}),
				accessibilityElement('combine')
			]}
		>
			{props.children}
		</HStack>
	)
}

export function ItemMedia(props: {children: ReactNode}) {
	return <VStack>{props.children}</VStack>
}

export function ItemContent(props: {children: ReactNode; modifiers?: ViewModifier[]}) {
	return (
		<VStack
			alignment="leading"
			spacing={space[1]}
			modifiers={[...(props.modifiers ?? []), frame({alignment: 'leading', maxWidth: Infinity})]}
		>
			{props.children}
		</VStack>
	)
}

export function ItemTitle(props: {children: string; modifiers?: ViewModifier[]}) {
	return (
		<Text modifiers={[...(props.modifiers ?? []), text.row, foregroundStyle(colors.foreground), lineLimit(2)]}>
			{props.children}
		</Text>
	)
}

export function ItemDescription(props: {children: string; modifiers?: ViewModifier[]}) {
	return (
		<Text modifiers={[...(props.modifiers ?? []), text.detail, foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
			{props.children}
		</Text>
	)
}

export function ItemActions(props: {children: ReactNode}) {
	return <HStack spacing={space[2]}>{props.children}</HStack>
}
