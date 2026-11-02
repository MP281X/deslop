import {Array} from 'effect'

import {Skeleton} from '#components/ui/skeleton.tsx'

// The one-line rows a list will hold while its data loads, shaped like them: a mark when the real rows lead with one.
export function ItemListSkeleton(props: {label: string; media?: boolean; rows: number}) {
	return (
		<div aria-busy="true" aria-label={props.label} role="status">
			{Array.map(Array.range(1, props.rows), row => (
				<div key={row} aria-hidden className="flex h-10 items-center gap-3 border-b px-1">
					{props.media === true && <Skeleton className="size-5" />}
					<Skeleton className="h-4 w-1/3" />
				</div>
			))}
		</div>
	)
}
