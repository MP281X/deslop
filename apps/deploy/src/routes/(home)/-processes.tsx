import {Array, Boolean, Option, String} from 'effect'

import {ChevronRight} from 'lucide-react'
import {useState} from 'react'

import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@deslop/components-web/ui/collapsible'
import {cn} from '@deslop/components-web/utils'

import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import type {ProcessNode} from '#routes/(home)/-process-tree.ts'

const mib = new Intl.NumberFormat(undefined, {maximumFractionDigits: 0})

// One process: its mark, name and what it holds of the app's memory as a bar; small ones read muted.
function Line(props: {depth: number; node: ProcessNode; open?: boolean}) {
	return (
		<span
			className={cn(
				'flex h-7 min-w-0 items-center gap-2 pl-(--indent) text-xs',
				props.node.small && 'text-muted-foreground'
			)}
			style={{'--indent': `calc(var(--spacing) * ${props.depth * 4})`}}
			title={`${mib.format(props.node.memory / 1024 ** 2)} MiB${Boolean.match(props.node.cpu === undefined, {onFalse: () => ` · ${props.node.cpu?.toFixed(1)}% CPU`, onTrue: () => ''})}`}
		>
			{Boolean.match(Array.isArrayNonEmpty(props.node.children), {
				onFalse: () => <span className="size-3.5 shrink-0" />,
				onTrue: () => (
					<ChevronRight
						className={cn(
							'text-muted-foreground size-3.5 shrink-0 transition-transform',
							props.open === true && 'rotate-90'
						)}
					/>
				)
			})}
			<ApplicationIcon name={props.node.name} small />
			<span className="max-w-1/3 shrink-0 truncate font-mono">{props.node.name}</span>
			{Array.isArrayNonEmpty(props.node.children) && (
				<span className="text-muted-foreground shrink-0 font-mono">{props.node.children.length}</span>
			)}
			<span
				className="text-muted-foreground min-w-0 flex-1 truncate font-mono"
				title={Array.join(props.node.command ?? [], ' ')}
			>
				{/* The arguments that tell a process apart: no executable, no variable assignments, and paths cut to their last part; hovering shows them whole. */}
				{Array.join(
					Array.map(
						Array.filter(Array.drop(props.node.command ?? [], 1), arg =>
							Option.isNone(String.match(/^[A-Z_][A-Z0-9_]*=/u)(arg))
						),
						String.replaceAll(/(^|=)(?:\/[^/\s=]+)+\/([^/\s]+)/gu, '$1$2')
					),
					' '
				)}
			</span>
			<span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
				{mib.format(props.node.memory / 1024 ** 2)} MiB
			</span>
		</span>
	)
}

// A parent opens on its own, as a small accordion; the first level starts open, deeper ones closed.
function Node(props: {depth: number; node: ProcessNode}) {
	const [open, setOpen] = useState(props.depth === 0 && !props.node.small)
	if (Array.isArrayEmpty(props.node.children)) {
		return <Line depth={props.depth} node={props.node} />
	}
	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger className="w-full cursor-pointer text-left" aria-label={`${props.node.name} processes`}>
				<Line depth={props.depth} node={props.node} open={open} />
			</CollapsibleTrigger>
			<CollapsibleContent>
				{Array.map(props.node.children, child => (
					<Node key={`${child.pid}:${child.name}`} depth={props.depth + 1} node={child} />
				))}
			</CollapsibleContent>
		</Collapsible>
	)
}

export function Processes(props: {tree: readonly ProcessNode[]}) {
	return (
		<div className="pb-2 pl-7">
			{Array.map(props.tree, node => (
				<Node key={`${node.pid}:${node.name}`} depth={0} node={node} />
			))}
		</div>
	)
}
