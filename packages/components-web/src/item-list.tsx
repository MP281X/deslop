import {Array} from 'effect'

import {Skeleton} from '#components/ui/skeleton.tsx'
import {cn} from '#lib/utils.ts'

// The one-line rows a list will hold while its data loads, shaped like them: a mark when the real rows lead with one.
export function ItemListSkeleton(props: {label: string; media?: boolean; rowClassName?: string; rows: number}) {
	return (
		<div aria-busy="true" aria-label={props.label} role="status">
			{Array.map(Array.range(1, props.rows), row => (
				<div
					key={row}
					aria-hidden
					className={cn('list-row flex h-8 items-center gap-3 px-1 max-sm:h-11', props.rowClassName)}
				>
					{props.media === true && <Skeleton className="size-5 shrink-0" />}
					<Skeleton className="h-4 w-1/3" />
				</div>
			))}
		</div>
	)
}
