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
