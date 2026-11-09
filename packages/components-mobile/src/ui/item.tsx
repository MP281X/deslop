import {Option} from 'effect'

import {HStack, List, Text, VStack} from '@expo/ui/swift-ui'
import {
	accessibilityElement,
	contentShape,
	foregroundStyle,
	frame,
	lineLimit,
	listRowBackground,
	listRowInsets,
	listRowSeparator,
	listRowSpacing,
	listSectionSpacing,
	listStyle,
	onTapGesture,
	scrollContentBackground,
	scrollEdgeEffectStyle,
	shapes
} from '@expo/ui/swift-ui/modifiers'
import type {ViewModifier} from '@expo/ui/swift-ui/modifiers'
import type {ReactNode} from 'react'

import {colors, space, text} from '#components/theme.ts'

// shadcn's Item on iOS by the same names; a caller's modifiers come first, so they win over the defaults like a className.

// Row modifiers for an ItemGroup: a translucent card per row, 8pt of ink between rows, no separator rule.
export const itemRow = [
	frame({minHeight: 56}),
	listRowBackground(colors.card),
	listRowSeparator('hidden'),
	listRowInsets({bottom: space[2], leading: space[3], top: space[2], trailing: space[3]})
]

export function ItemGroup(props: {children: ReactNode; modifiers?: ViewModifier[]}) {
	return (
		<List
			modifiers={[
				...(props.modifiers ?? []),
				scrollContentBackground('hidden'),
				scrollEdgeEffectStyle('soft'),
				listRowSpacing(space[2]),
				listSectionSpacing(space[4]),
				listStyle('insetGrouped')
			]}
		>
			{props.children}
		</List>
	)
}

export function Item(props: {
	alignment?: 'center' | 'top'
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
