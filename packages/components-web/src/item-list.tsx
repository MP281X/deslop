import {Array} from 'effect'

import type {ReactNode} from 'react'

import {Item} from '#components/ui/item.tsx'

// The stock rows a group will hold while it loads: the real row frame, with each caller's own column template inside.
export function RowsSkeleton(props: {children: ReactNode; label: string; rows: number}) {
	return (
		<div aria-busy="true" aria-label={props.label} role="status">
			{Array.map(Array.range(1, props.rows), row => (
				<Item key={row} aria-hidden size="row">
					{props.children}
				</Item>
			))}
		</div>
	)
}

// A quiet heading over a group of rows, such as the processes or the scheduled jobs: a row's height, with its 16px icon in the marks' column so its text lines up with the names.
export function ItemListHeading(props: {children: ReactNode; icon: ReactNode}) {
	return (
		<div
			role="presentation"
			className="list-row text-muted-foreground flex h-8 items-center gap-3 px-4 text-xs max-sm:h-11 [&_svg]:size-4 [&_svg]:shrink-0"
		>
			{props.icon}
			<span className="min-w-0 truncate">{props.children}</span>
		</div>
	)
}
