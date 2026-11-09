import {Array} from 'effect'

import {Skeleton} from '#components/ui/skeleton.tsx'
import {cn} from '#lib/utils.ts'

// The one-line rows a list will hold while its data loads, shaped like them: a mark when the real rows lead with one.
export function ItemListSkeleton(props: {
	label: string
	media?: boolean
	mediaClassName?: string
	rowClassName?: string
	rows: number
}) {
	return (
		<div aria-busy="true" aria-label={props.label} role="status">
			{Array.map(Array.range(1, props.rows), row => (
				<div
					key={row}
					aria-hidden
					className={cn('list-row flex h-10 items-center gap-3 px-3 max-sm:h-12', props.rowClassName)}
				>
					{props.media === true && <Skeleton className={cn('size-8 shrink-0', props.mediaClassName)} />}
					<div className="flex min-w-0 flex-1 flex-col gap-1.5">
						<Skeleton className="h-3 w-1/3" />
						<Skeleton className="h-2.5 w-2/5" />
					</div>
				</div>
			))}
		</div>
	)
}
