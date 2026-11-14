import {Array} from 'effect'

import {accessibilityLabel, redacted} from '@expo/ui/swift-ui/modifiers'
import type {ReactNode} from 'react'

import {Item, ItemContent, ItemDescription, ItemGroup, ItemTitle, itemRow} from '#components/ui/item.tsx'

// The rows of an ItemGroup while it loads: the real row's shape, redacted, with the caller's media.
export function ItemGroupSkeleton(props: {descriptionLines?: number; media?: ReactNode; rows: number}) {
	return (
		<ItemGroup modifiers={[redacted('placeholder'), accessibilityLabel('Loading')]}>
			{Array.map(Array.range(1, props.rows), row => (
				<Item key={row} alignment="top" modifiers={itemRow}>
					{props.media}
					<ItemContent>
						<ItemTitle>Placeholder row title</ItemTitle>
						{Array.map(Array.range(1, props.descriptionLines ?? 1), line => (
							<ItemDescription key={line}>Placeholder detail line</ItemDescription>
						))}
					</ItemContent>
				</Item>
			))}
		</ItemGroup>
	)
}
