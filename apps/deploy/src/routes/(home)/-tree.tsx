import {Array} from 'effect'

import type {ReactNode} from 'react'

import {Item, ItemActions, ItemContent, ItemMedia} from '@deslop/components-web/ui/item'

import type {ProcessId} from '#services/inventory/schema.ts'

// One row of a tree: what it shows and the rows nested below it; the row itself is a stock Item.
export type TreeRow = {
	actions?: ReactNode
	children?: readonly TreeRow[]
	content: ReactNode
	id: ProcessId
	media: ReactNode
	title?: string
}

// Each level indents 12px under its parent's row.
function Branch(props: {depth: number; row: TreeRow}) {
	const children = props.row.children ?? []
	return (
		<>
			<Item role="treeitem" aria-level={props.depth + 1} size="sm" title={props.row.title}>
				<ItemMedia variant="icon">{props.row.media}</ItemMedia>
				<ItemContent>{props.row.content}</ItemContent>
				{props.row.actions !== undefined && <ItemActions>{props.row.actions}</ItemActions>}
			</Item>
			{Array.isReadonlyArrayNonEmpty(children) && (
				<div role="group" className="pl-3">
					{Array.map(children, child => (
						<Branch key={child.id} depth={props.depth + 1} row={child} />
					))}
				</div>
			)}
		</>
	)
}

// A tree of stock Item rows: nested levels indent 12px with no connector lines, tints or fold carets.
export function Tree(props: {rows: readonly TreeRow[]}) {
	return (
		<div role="tree">
			{Array.map(props.rows, row => (
				<Branch key={row.id} depth={0} row={row} />
			))}
		</div>
	)
}
