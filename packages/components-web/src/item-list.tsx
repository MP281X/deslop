import {Array} from 'effect'

import {Fragment} from 'react'
import type {ReactElement} from 'react'

import {ItemContent, ItemGroup, ItemMedia, ItemSeparator, Item} from '#components/ui/item.tsx'
import {Skeleton} from '#components/ui/skeleton.tsx'

// DESIGN.md's rows: Items with a hairline between each and no gap, as shadcn's ItemGroup and ItemSeparator compose them.
export function ItemList(props: {children: ReactElement[]; label: string}) {
	return (
		<ItemGroup aria-label={props.label} className="gap-0">
			{Array.map(props.children, (child, index) => (
				<Fragment key={child.key ?? index}>
					{child}
					<ItemSeparator className="my-0" />
				</Fragment>
			))}
		</ItemGroup>
	)
}

// The rows a list will hold while its data loads, shaped like them: a media square when the real rows have one.
export function ItemListSkeleton(props: {label: string; media?: boolean; rows: number}) {
	return (
		<div aria-busy="true" aria-label={props.label} role="status">
			<ItemList label={props.label}>
				{Array.map(Array.range(1, props.rows), row => (
					<Item key={row} role="listitem" size="sm" aria-hidden>
						{props.media === true && (
							<ItemMedia>
								<Skeleton className="size-8" />
							</ItemMedia>
						)}
						<ItemContent>
							<Skeleton className="h-4 w-1/3" />
							<Skeleton className="h-3 w-1/2" />
						</ItemContent>
					</Item>
				))}
			</ItemList>
		</div>
	)
}
