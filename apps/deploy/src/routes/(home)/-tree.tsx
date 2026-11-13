import {Array, Boolean, Function} from 'effect'

import type {CSSProperties, ReactNode} from 'react'

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

type TreeStyle = CSSProperties & {'--tree-depth': number}

// Each level indents 12px, and a parent's row is overdrawn while it pins itself above the rows scrolling under it.
function Branch(props: {depth: number; row: TreeRow}) {
	const children = props.row.children ?? []
	const hasChildren = Array.isReadonlyArrayNonEmpty(children)
	const style: TreeStyle = {'--tree-depth': props.depth}
	return (
		<div className="relative" style={style}>
			<div
				className={Boolean.match(hasChildren, {
					onFalse: Function.constUndefined,
					onTrue: Function.constant('tree-sticky')
				})}
			>
				<Item
					role="treeitem"
					aria-level={props.depth + 1}
					size="row"
					title={props.row.title}
					className="relative after:hidden"
				>
					{hasChildren && (
						<span
							aria-hidden="true"
							className="bg-background group-hover/item:tree-sticky-hover pointer-events-none absolute inset-0"
						/>
					)}
					<ItemMedia className="pointer-events-none relative z-10">{props.row.media}</ItemMedia>
					<ItemContent className="pointer-events-none relative z-10">{props.row.content}</ItemContent>
					{props.row.actions !== undefined && (
						<ItemActions className="relative z-10 shrink-0">{props.row.actions}</ItemActions>
					)}
				</Item>
			</div>
			{hasChildren && (
				<div role="group" className="pl-3">
					{Array.map(children, child => (
						<Branch key={child.id} depth={props.depth + 1} row={child} />
					))}
				</div>
			)}
		</div>
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
