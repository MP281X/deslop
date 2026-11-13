import {Array, Option, pipe} from 'effect'

import {cn} from '@deslop/components-web/classes'
import {countOf, percentOf} from '@deslop/runtime/shared/format'

import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import {Tree} from '#routes/(home)/-tree.tsx'
import type {TreeRow} from '#routes/(home)/-tree.tsx'
import type {ProcessNode} from '#services/inventory/lib/utils.ts'

// A process ends with its memory and CPU in fixed, right-aligned columns; their units name them without a header.
function Figures(props: {node: ProcessNode}) {
	return (
		<span className="flex shrink-0 items-center gap-2 font-mono text-xs tabular-nums">
			<span className="w-14 text-right whitespace-nowrap">{`${countOf(props.node.memory / 1024 ** 2)} MiB`}</span>
			<span className="text-muted-foreground w-11 text-right whitespace-nowrap">
				{Option.match(props.node.cpu, {onNone: () => '—', onSome: percentOf})}
			</span>
		</span>
	)
}

// One process row: its mark, the command label and its two figures; small ones read muted.
function rowOf(props: {node: ProcessNode}): TreeRow {
	const row: TreeRow = {
		actions: <Figures node={props.node} />,
		content: (
			<div
				className={cn(
					'flex min-w-0 flex-1 items-baseline gap-2 text-left',
					props.node.small && 'text-muted-foreground'
				)}
			>
				<span className="max-w-full min-w-0 shrink truncate font-mono text-xs tracking-normal normal-case">
					{props.node.label.name}
				</span>
				<span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs tracking-normal normal-case">
					{props.node.label.detail}
				</span>
			</div>
		),
		id: props.node.pid,
		media: <ApplicationIcon name={props.node.label.name} small />,
		title: pipe(props.node.command, Option.getOrElse(Array.empty), Array.join(' '))
	}
	return Array.match(props.node.children, {
		onEmpty: () => row,
		onNonEmpty: children => ({...row, children: Array.map(children, child => rowOf({node: child}))})
	})
}

// Every process is shown; nesting indents plainly, and a parent's row stays pinned under its ancestors.
export function Processes(props: {tree: readonly ProcessNode[]}) {
	return (
		// Its own stacking context keeps the pinned parents under the pane's scrollbar.
		<div className="isolate min-w-0">
			<Tree rows={Array.map(props.tree, node => rowOf({node}))} />
		</div>
	)
}
