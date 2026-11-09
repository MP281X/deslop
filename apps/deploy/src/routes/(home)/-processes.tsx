import {Array, Boolean, Option, String} from 'effect'

import {CaretRightIcon} from '@phosphor-icons/react'

import {Button} from '@deslop/components-web/ui/button'
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@deslop/components-web/ui/collapsible'
import {Item, ItemActions, ItemContent, ItemMedia} from '@deslop/components-web/ui/item'
import {cn} from '@deslop/components-web/utils'

import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import type {ProcessNode} from '#routes/(home)/-process-tree.ts'

const mib = new Intl.NumberFormat(undefined, {maximumFractionDigits: 0})

// One process: its mark, name and what it holds of the app's memory; small ones read muted.
function Line(props: {depth: number; node: ProcessNode; padded?: boolean}) {
	return (
		<div className={cn('console-row flex h-8 w-full min-w-0 max-sm:h-11', props.padded === true && 'pr-2')}>
			{/* The tree is drawn, not typed: one hairline per level plus this row's stub. */}
			<span aria-hidden className="relative h-full w-2 shrink-0">
				{props.depth > 0 && <span className="bg-border absolute top-1/2 left-0 h-px w-2" />}
			</span>
			<Item
				size="xs"
				className="h-full min-w-0 flex-1"
				title={`Memory includes child processes${Boolean.match(props.node.cpu === undefined, {onFalse: () => ` · ${props.node.cpu?.toFixed(1)}% CPU`, onTrue: () => ''})}`}
			>
				<ItemMedia variant="icon">
					<ApplicationIcon name={props.node.name} small />
				</ItemMedia>
				<ItemContent className="min-w-0">
					<div
						className={cn('flex min-w-0 items-baseline gap-2 text-left', props.node.small && 'text-muted-foreground')}
					>
						<span className="max-w-2/5 shrink-0 truncate font-mono text-xs max-sm:max-w-3/5">{props.node.name}</span>
						<span
							className="text-muted-foreground text-2xs min-w-0 flex-1 truncate font-mono"
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
					</div>
				</ItemContent>
				<ItemActions className="shrink-0">
					{Array.isArrayNonEmpty(props.node.children) && (
						<span className="text-muted-foreground text-2xs w-5 shrink-0 text-right font-mono max-sm:hidden">
							+{props.node.children.length}
						</span>
					)}
					<span className="text-muted-foreground text-2xs shrink-0 font-mono tabular-nums">
						{mib.format(props.node.memory / 1024 ** 2)} MiB
					</span>
					{Boolean.match(Array.isArrayNonEmpty(props.node.children), {
						onFalse: () => <span className="size-3.5 shrink-0" />,
						onTrue: () => (
							<CaretRightIcon className="text-muted-foreground size-3.5 shrink-0 transition-transform duration-75 group-aria-expanded/button:rotate-90 motion-reduce:transition-none" />
						)
					})}
				</ItemActions>
			</Item>
		</div>
	)
}

// A parent opens on its own, as a small accordion; the first level starts open, deeper ones closed.
function Node(props: {depth: number; node: ProcessNode}) {
	if (Array.isArrayEmpty(props.node.children)) {
		return <Line depth={props.depth} node={props.node} padded />
	}
	return (
		<Collapsible defaultOpen={props.depth === 0 && !props.node.small}>
			<CollapsibleTrigger
				render={<Button variant="ghost" size="sm" className="h-full w-full" />}
				aria-label={`${props.node.name} processes`}
			>
				<Line depth={props.depth} node={props.node} />
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className="border-border ml-2 border-l pl-1">
					{Array.map(props.node.children, child => (
						<Node key={`${child.pid}:${child.name}`} depth={props.depth + 1} node={child} />
					))}
				</div>
			</CollapsibleContent>
		</Collapsible>
	)
}

export function Processes(props: {tree: readonly ProcessNode[]}) {
	return (
		<div className="min-w-0 pb-2">
			{Array.map(props.tree, node => (
				<Node key={`${node.pid}:${node.name}`} depth={0} node={node} />
			))}
		</div>
	)
}
