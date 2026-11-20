import {Array, Function, Option, String, pipe} from 'effect'

import {Fragment} from 'react'

import {RowLead} from '@deslop/components-web/blocks/rows'
import {StatusDot} from '@deslop/components-web/blocks/status-dot'
import {cn} from '@deslop/components-web/lib/utils'
import {Table, TableBody, TableCell, TableRow} from '@deslop/components-web/ui/table'
import {bytesOf, percentOf} from '@deslop/runtime/shared/format'

import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import {host} from '#routes/(home)/-rows.ts'
import {reasonOf} from '#services/inventory/lib/utils.ts'
import type {ProcessNode, Row} from '#services/inventory/lib/utils.ts'

// One process and the processes under it: each level indents 12px under its parent's mark, with no connector lines, tints or fold carets; small ones read muted. Memory and CPU close the row; their units name them without a header.
function ProcessRows(props: {depth: number; nodes: readonly ProcessNode[]}) {
	return Array.map(props.nodes, node => (
		<Fragment key={node.pid}>
			<TableRow aria-level={props.depth + 1}>
				<RowLead
					title={pipe([node.label.name, node.label.detail], Array.filter(String.isNonEmpty), Array.join(' '))}
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

// Why the opened row needs a look, in full: its own reason, then each held site's address and reason. The table cuts a reason to one line and a chip shows only its dot, so a phone reads them here; a healthy row shows nothing.
export function Reasons(props: {row: Row}) {
	// A saved site with no app is its own row and its own exposure: it shows once.
	const held = Array.filter(
		[props.row.item, ...Array.filter(props.row.exposures, exposure => exposure.id !== props.row.item.id)],
		item => item.health !== 'quiet'
	)
	if (Array.isReadonlyArrayEmpty(held)) return undefined
	return (
		<ul className="flex flex-col gap-1 border-b p-2 text-sm">
			{Array.map(held, item => (
				<li key={item.id} className="flex gap-2">
					<span className="flex h-5 w-6 shrink-0 items-center justify-center">
						{item.health !== 'quiet' && <StatusDot status={item.health} label={item.health} />}
					</span>
					<p className="min-w-0 break-words">
						{item.kind === 'exposure' && (
							<span className="text-muted-foreground">
								{Option.match(item.url, {onNone: () => Option.getOrUndefined(item.port), onSome: host})}{' '}
							</span>
						)}
						{reasonOf(item)}
					</p>
				</li>
			))}
		</ul>
	)
}
