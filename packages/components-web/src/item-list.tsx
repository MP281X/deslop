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
				<div key={row} aria-hidden className={cn('list-row flex h-14 items-center gap-3 px-4', props.rowClassName)}>
					{props.media === true && <Skeleton className={cn('size-9 shrink-0', props.mediaClassName)} />}
					<div className="flex min-w-0 flex-1 flex-col gap-2">
						<Skeleton className="h-3.5 w-1/3" />
						<Skeleton className="h-3 w-2/5" />
					</div>
				</div>
			))}
		</div>
	)
}
