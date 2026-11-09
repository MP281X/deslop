import {Array} from 'effect'

import {Item, ItemContent, ItemMedia} from '#components/ui/item.tsx'
import {Skeleton} from '#components/ui/skeleton.tsx'

// The rows a list will hold while its data loads, on the same row as the real ones: a mark when the real rows lead with one.
export function ItemListSkeleton(props: {label: string; media?: boolean; rows: number}) {
	return (
		<div aria-busy="true" aria-label={props.label} role="status">
			{Array.map(Array.range(1, props.rows), row => (
				<Item key={row} aria-hidden size="row">
					{props.media === true && (
						<ItemMedia>
							<Skeleton className="size-5" />
						</ItemMedia>
					)}
					<ItemContent>
						<Skeleton className="h-3 w-2/5" />
					</ItemContent>
				</Item>
			))}
		</div>
	)
}
