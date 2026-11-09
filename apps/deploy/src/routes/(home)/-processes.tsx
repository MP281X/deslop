import {Array, Boolean, Option, String} from 'effect'

import {CaretRightIcon} from '@phosphor-icons/react'
import {useState} from 'react'
import type {ReactNode} from 'react'

import {Button} from '@deslop/components-web/ui/button'
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@deslop/components-web/ui/collapsible'
import {Item, ItemActions, ItemContent, ItemMedia} from '@deslop/components-web/ui/item'
import {cn} from '@deslop/components-web/utils'

import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import type {ProcessNode} from '#routes/(home)/-process-tree.ts'

const mib = new Intl.NumberFormat(undefined, {maximumFractionDigits: 0})

// One process: its mark, name and what it holds of the app's memory; small ones read muted. The column is MiB, named on hover rather than in every row.
function Line(props: {depth: number; node: ProcessNode; open?: boolean; trigger?: ReactNode}) {
	const memory = mib.format(props.node.memory / 1024 ** 2)
	return (
		<Item
			size="row"
			className="relative"
			style={{'--indent': `calc(var(--spacing) * ${props.depth * 4})`}}
			title={`Memory includes child processes${Boolean.match(props.node.cpu === undefined, {onFalse: () => ` · ${props.node.cpu?.toFixed(1)}% CPU`, onTrue: () => ''})}`}
		>
			{props.trigger}
			<ItemMedia className="pointer-events-none relative z-10 ml-(--indent)">
				<ApplicationIcon name={props.node.name} small />
			</ItemMedia>
			<ItemContent className="pointer-events-none relative z-10">
				<div className={cn('flex min-w-0 items-baseline gap-2 text-left', props.node.small && 'text-muted-foreground')}>
					<span className="max-w-2/5 shrink-0 truncate font-mono text-xs tracking-normal normal-case max-sm:max-w-3/5">
						{props.node.name}
					</span>
					<span
						className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs tracking-normal normal-case"
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
			<ItemActions className="pointer-events-none relative z-10 shrink-0">
				{Array.isArrayNonEmpty(props.node.children) && (
					<span className="text-muted-foreground w-6 shrink-0 text-right font-mono text-xs tracking-normal normal-case max-sm:hidden">
						+{props.node.children.length}
					</span>
				)}
				<span
					aria-label={`${memory} MiB`}
					title="MiB"
					className="text-muted-foreground w-12 shrink-0 text-right font-mono text-xs tracking-normal normal-case tabular-nums"
				>
					{memory}
				</span>
				{Boolean.match(Array.isArrayNonEmpty(props.node.children), {
					onFalse: () => <span className="size-3.5 shrink-0" />,
					onTrue: () => (
						<CaretRightIcon
							className={cn(
								'text-muted-foreground size-3.5 shrink-0 transition-transform',
								props.open === true && 'rotate-90'
							)}
						/>
					)
				})}
			</ItemActions>
		</Item>
	)
}

function Node(props: {depth: number; node: ProcessNode}) {
	const [open, setOpen] = useState(props.depth === 0 && !props.node.small)
	if (Array.isArrayEmpty(props.node.children)) {
		return <Line depth={props.depth} node={props.node} />
	}
	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<Line
				depth={props.depth}
				node={props.node}
				open={open}
				trigger={
					<CollapsibleTrigger
						render={
							<Button
								variant="ghost"
								className="absolute inset-0 z-0 size-full"
								aria-label={`${props.node.name} processes`}
							/>
						}
					/>
				}
			/>
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
		<div className="min-w-0">
			{Array.map(props.tree, node => (
				<Node key={`${node.pid}:${node.name}`} depth={0} node={node} />
			))}
		</div>
	)
}
