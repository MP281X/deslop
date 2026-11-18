import {Array, Function, Option, pipe} from 'effect'

import {Fragment} from 'react'

import {RowLead} from '@deslop/components-web/blocks/rows'
import {cn} from '@deslop/components-web/lib/utils'
import {Table, TableBody, TableCell, TableRow} from '@deslop/components-web/ui/table'
import {bytesOf, percentOf} from '@deslop/runtime/shared/format'

import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import type {ProcessNode} from '#services/inventory/lib/utils.ts'

// One process and the processes under it: each level indents 12px under its parent's mark, with no connector lines, tints or fold carets; small ones read muted. Memory and CPU close the row; their units name them without a header.
function ProcessRows(props: {depth: number; nodes: readonly ProcessNode[]}) {
	return Array.map(props.nodes, node => (
		<Fragment key={node.pid}>
			<TableRow aria-level={props.depth + 1}>
				<RowLead
					title={pipe(node.command, Option.getOrElse(Array.empty), Array.join(' '))}
					depth={props.depth}
					mark={<ApplicationIcon name={node.label.name} process={Option.none()} />}
					detail={node.label.detail}
				>
					<span className={cn(node.small && 'text-muted-foreground')}>{node.label.name}</span>
				</RowLead>
				<TableCell className="text-right">
					<span className="tabular-nums">{bytesOf(node.memory)}</span>
				</TableCell>
				<TableCell className="text-right">
					<span className="text-muted-foreground tabular-nums">
						{Option.match(node.cpu, {onNone: Function.constant('—'), onSome: percentOf})}
					</span>
				</TableCell>
			</TableRow>
			<ProcessRows depth={props.depth + 1} nodes={node.children} />
		</Fragment>
	))
}

// Every process is shown, as one tree of ruled rows.
export function Processes(props: {tree: readonly ProcessNode[]}) {
	return (
		<Table role="treegrid" aria-label="Processes">
			<TableBody>
				<ProcessRows depth={0} nodes={props.tree} />
			</TableBody>
		</Table>
	)
}
