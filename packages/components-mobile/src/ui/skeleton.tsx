import {Array} from 'effect'

import {RoundedRectangle} from '@expo/ui/swift-ui'
import {foregroundStyle, redacted} from '@expo/ui/swift-ui/modifiers'
import type {ViewModifier} from '@expo/ui/swift-ui/modifiers'

import {colors} from '#components/theme.ts'
import {Item, ItemContent, ItemDescription, ItemGroup, ItemTitle, itemRow} from '#components/ui/item.tsx'

// shadcn's Skeleton on iOS: a muted block the caller sizes with frame, standing in for content that is loading.
export function Skeleton(props: {modifiers?: ViewModifier[]}) {
	return <RoundedRectangle cornerRadius={6} modifiers={[...(props.modifiers ?? []), foregroundStyle(colors.card)]} />
}

// A list's rows while its data loads, as SwiftUI's own placeholder redaction draws them.
export function ItemGroupSkeleton(props: {rows: number}) {
	return (
		<ItemGroup modifiers={[redacted('placeholder')]}>
			{Array.map(Array.range(1, props.rows), row => (
				<Item key={row} modifiers={itemRow}>
					<ItemContent>
						<ItemTitle>Placeholder row title</ItemTitle>
						<ItemDescription>Placeholder detail line</ItemDescription>
					</ItemContent>
				</Item>
			))}
		</ItemGroup>
	)
}
