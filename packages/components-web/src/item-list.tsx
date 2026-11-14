import {Array} from 'effect'

import {Item, ItemContent, ItemGroup} from '#components/ui/item.tsx'
import {Skeleton} from '#components/ui/skeleton.tsx'

// The stock rows a list will hold while it loads: each row's title and description lines at the list row's own size.
export function RowsSkeleton(props: {label: string; rows: number}) {
	return (
		<ItemGroup role="status" aria-busy="true" aria-label={props.label}>
			{Array.map(Array.range(1, props.rows), row => (
				<Item key={row} aria-hidden size="sm">
					<ItemContent>
						<Skeleton className="h-4 w-1/3" />
						<Skeleton className="h-4 w-1/2" />
					</ItemContent>
				</Item>
			))}
		</ItemGroup>
	)
}
