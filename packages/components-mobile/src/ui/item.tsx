import {Option, Schema} from 'effect'

import {HStack, List, Text, VStack, ZStack} from '@expo/ui/swift-ui'
import {
	accessibilityElement,
	background,
	border,
	clipShape,
	contentShape,
	foregroundStyle,
	frame,
	lineLimit,
	listRowInsets,
	listRowSeparator,
	listStyle,
	onTapGesture,
	padding,
	scrollEdgeEffectStyle,
	shapes
} from '@expo/ui/swift-ui/modifiers'
import type {ViewModifier} from '@expo/ui/swift-ui/modifiers'
import {createContext, useContext} from 'react'
import type {ReactNode} from 'react'

import {colors, radius, space, text} from '#components/theme.ts'

export type ItemAlignment = typeof ItemAlignment.Type
const ItemAlignment = Schema.Literals(['center', 'top'])

export type ItemSize = typeof ItemSize.Type
const ItemSize = Schema.Literals(['default', 'sm', 'xs'])

export type ItemVariant = typeof ItemVariant.Type
const ItemVariant = Schema.Literals(['default', 'outline', 'muted'])

export type ItemMediaVariant = typeof ItemMediaVariant.Type
const ItemMediaVariant = Schema.Literals(['default', 'image'])

// The web's gaps, vertical padding and image side per size; `default` and `sm` differ only in their image.
const itemSizes = {
	default: {content: space[1], gap: space[3], image: 40, vertical: space[3]},
	sm: {content: space[1], gap: space[3], image: 32, vertical: space[3]},
	xs: {content: 0, gap: space[2], image: 24, vertical: space[2]}
}

const itemVariants = {
	default: [],
	muted: [background(colors.card)],
	outline: [border({content: colors.mutedForeground})]
}

const ItemSizeContext = createContext<ItemSize>('default')

// A caller's modifiers come first, so they win over the defaults like a className.

// The list row's own modifiers, put on the row's outermost view such as its SwipeActions; the Item pads itself.
export const itemRow = [listRowInsets({bottom: 0, leading: 0, top: 0, trailing: 0}), listRowSeparator('hidden')]

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
	size?: ItemSize
	variant?: ItemVariant
}) {
	const size = props.size ?? 'default'
	return (
		<ItemSizeContext value={size}>
			<HStack
				alignment={props.alignment ?? 'center'}
				spacing={itemSizes[size].gap}
				modifiers={[
					...(props.modifiers ?? []),
					padding({horizontal: space[4], vertical: itemSizes[size].vertical}),
					...itemVariants[props.variant ?? 'default'],
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
		</ItemSizeContext>
	)
}

// `image` is a tile in the Item's size that clips its children, which stack: a placeholder mark under a picture.
export function ItemMedia(props: {children?: ReactNode; modifiers?: ViewModifier[]; variant?: ItemMediaVariant}) {
	const side = itemSizes[useContext(ItemSizeContext)].image
	if (props.variant !== 'image') return <VStack modifiers={props.modifiers}>{props.children}</VStack>
	return (
		<ZStack
			modifiers={[
				...(props.modifiers ?? []),
				frame({height: side, width: side}),
				background(colors.card),
				clipShape('roundedRectangle', radius)
			]}
		>
			{props.children}
		</ZStack>
	)
}

export function ItemContent(props: {children: ReactNode; modifiers?: ViewModifier[]}) {
	return (
		<VStack
			alignment="leading"
			spacing={itemSizes[useContext(ItemSizeContext)].content}
			modifiers={[...(props.modifiers ?? []), frame({alignment: 'leading', maxWidth: Infinity})]}
		>
			{props.children}
		</VStack>
	)
}

export function ItemTitle(props: {children: string; modifiers?: ViewModifier[]}) {
	return (
		<Text modifiers={[...(props.modifiers ?? []), text.row, foregroundStyle(colors.foreground), lineLimit(1)]}>
			{props.children}
		</Text>
	)
}

export function ItemDescription(props: {children: string; modifiers?: ViewModifier[]}) {
	return (
		<Text modifiers={[...(props.modifiers ?? []), text.detail, foregroundStyle(colors.mutedForeground), lineLimit(2)]}>
			{props.children}
		</Text>
	)
}

export function ItemActions(props: {children: ReactNode}) {
	return <HStack spacing={space[2]}>{props.children}</HStack>
}
