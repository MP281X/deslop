import {Array, Boolean} from 'effect'

import {CaretDownIcon, CaretRightIcon} from '@phosphor-icons/react'
import {useState} from 'react'
import type {CSSProperties, ReactNode} from 'react'

import {Button} from '#components/ui/button.tsx'
import {Item, ItemActions, ItemContent, ItemMedia} from '#components/ui/item.tsx'

// One row of a tree: what it shows and the rows nested below it; the row itself is a stock Item.
export type TreeRow = {
	actions?: ReactNode
	children?: readonly TreeRow[]
	content: ReactNode
	id: string
	label: string
	media: ReactNode
	onPointerEnter?: () => void
	onPointerLeave?: () => void
	title?: string
}

type TreeStyle = CSSProperties & {'--tree-depth': number}

// The fold control in the row's fixed 12px column at its left edge, above the row's own hit area.
function Caret(props: {expanded: boolean; label: string; onToggle: () => void}) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-xs"
			aria-expanded={props.expanded}
			aria-label={`${Boolean.match(props.expanded, {onFalse: () => 'Unfold', onTrue: () => 'Fold'})} ${props.label}`}
			className="absolute top-1/2 -left-4 z-20 size-3 -translate-y-1/2"
			onClick={event => {
				event.stopPropagation()
				props.onToggle()
			}}
		>
			{Boolean.match(props.expanded, {onFalse: () => <CaretRightIcon />, onTrue: () => <CaretDownIcon />})}
		</Button>
	)
}

// Each level indents 12px and its children sit in a block one step lighter, overdrawn while a parent pins itself.
function Branch(props: {depth: number; row: TreeRow; stickyParents: boolean}) {
	const children = props.row.children ?? []
	const [expanded, setExpanded] = useState(true)
	const hasChildren = Array.isArrayNonEmpty(children)
	const sticky = props.stickyParents && hasChildren
	const style: TreeStyle = {'--tree-depth': props.depth}
	return (
		<div className="relative" style={style}>
			<div className={Boolean.match(sticky, {onFalse: () => undefined, onTrue: () => 'tree-sticky'})}>
				<Item
					role="treeitem"
					aria-level={props.depth + 1}
					aria-expanded={Boolean.match(hasChildren, {onFalse: () => undefined, onTrue: () => expanded})}
					size="row"
					title={props.row.title}
					className="relative after:hidden"
					onPointerEnter={props.row.onPointerEnter}
					onPointerLeave={props.row.onPointerLeave}
				>
					{sticky && (
						<span
							aria-hidden="true"
							className="tree-sticky-bg group-hover/item:bg-muted/30 pointer-events-none absolute inset-0"
						/>
					)}
					<ItemMedia className="pointer-events-none relative z-10">
						{hasChildren && (
							<Caret expanded={expanded} label={props.row.label} onToggle={() => setExpanded(value => !value)} />
						)}
						{props.row.media}
					</ItemMedia>
					<ItemContent className="pointer-events-none relative z-10">{props.row.content}</ItemContent>
					{props.row.actions !== undefined && (
						<ItemActions className="relative z-10 shrink-0">{props.row.actions}</ItemActions>
					)}
				</Item>
			</div>
			{hasChildren && expanded && (
				<div role="group" className="tree-tint pl-3">
					{Array.map(children, child => (
						<Branch key={child.id} depth={props.depth + 1} row={child} stickyParents={props.stickyParents} />
					))}
				</div>
			)}
		</div>
	)
}

// A folding tree of stock Item rows: nested levels indent 12px inside a one-step tinted block, with no connector lines.
export function Tree(props: {rows: readonly TreeRow[]; stickyParents?: boolean}) {
	return (
		<div role="tree">
			{Array.map(props.rows, row => (
				<Branch key={row.id} depth={0} row={row} stickyParents={props.stickyParents === true} />
			))}
		</div>
	)
}
