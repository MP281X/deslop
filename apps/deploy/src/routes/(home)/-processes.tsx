import {Array, Function, Option, pipe} from 'effect'

import {cn} from '@deslop/components-web/classes'
import {ItemTitle} from '@deslop/components-web/ui/item'
import {countOf, percentOf} from '@deslop/runtime/shared/format'

import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import {Tree} from '#routes/(home)/-tree.tsx'
import type {TreeRow} from '#routes/(home)/-tree.tsx'
import type {ProcessNode} from '#services/inventory/lib/utils.ts'

// A process ends with its memory and CPU; their units name them without a header.
function Figures(props: {node: ProcessNode}) {
	return (
		<>
			<span className="tabular-nums">{`${countOf(props.node.memory / 1024 ** 2)} MiB`}</span>
			<span className="text-muted-foreground tabular-nums">
				{Option.match(props.node.cpu, {onNone: Function.constant('—'), onSome: percentOf})}
			</span>
		</>
	)
}

// One process row: its mark, the command label and its two figures; small ones read muted.
function rowOf(props: {node: ProcessNode}): TreeRow {
	const row: TreeRow = {
		actions: <Figures node={props.node} />,
		content: (
			<ItemTitle>
				<span className={cn(props.node.small && 'text-muted-foreground')}>{props.node.label.name}</span>
				<span className="text-muted-foreground">{props.node.label.detail}</span>
			</ItemTitle>
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

// Every process is shown; nesting indents plainly.
export function Processes(props: {tree: readonly ProcessNode[]}) {
	return <Tree rows={Array.map(props.tree, node => rowOf({node}))} />
}
