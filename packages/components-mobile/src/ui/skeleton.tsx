import {Array} from 'effect'

import {Rectangle} from '@expo/ui/swift-ui'
import {accessibilityLabel, border, foregroundStyle, lineLimit, redacted} from '@expo/ui/swift-ui/modifiers'
import type {ViewModifier} from '@expo/ui/swift-ui/modifiers'
import type {ReactNode} from 'react'

import {colors} from '#components/theme.ts'
import {Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle, itemRow} from '#components/ui/item.tsx'

// shadcn's Skeleton on iOS: a square block the caller sizes with frame, standing in for content that is loading.
export function Skeleton(props: {modifiers?: ViewModifier[]}) {
	return (
		<Rectangle
			modifiers={[...(props.modifiers ?? []), border({content: colors.border, width: 2}), foregroundStyle(colors.card)]}
		/>
	)
}

// A list's rows while its data loads, as SwiftUI's own placeholder redaction draws them.
export function ItemGroupSkeleton(props: {descriptionLines?: number; media?: ReactNode; rows: number}) {
	return (
		<ItemGroup modifiers={[redacted('placeholder'), accessibilityLabel('Loading')]}>
			{Array.map(Array.range(1, props.rows), row => (
				<Item key={row} alignment="top" modifiers={itemRow}>
					{props.media !== undefined && <ItemMedia>{props.media}</ItemMedia>}
					<ItemContent>
						<ItemTitle modifiers={[lineLimit(1)]}>Placeholder row title</ItemTitle>
						{Array.map(Array.range(1, props.descriptionLines ?? 1), line => (
							<ItemDescription key={line}>Placeholder detail line</ItemDescription>
						))}
					</ItemContent>
				</Item>
			))}
		</ItemGroup>
	)
}
