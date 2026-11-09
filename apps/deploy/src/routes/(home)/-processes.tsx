import {Array, Boolean, Option, String} from 'effect'

import {Item, ItemActions, ItemContent, ItemMedia} from '@deslop/components-web/ui/item'
import {cn} from '@deslop/components-web/utils'

import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import type {ProcessNode} from '#routes/(home)/-process-tree.ts'

const mib = new Intl.NumberFormat(undefined, {maximumFractionDigits: 0})

// One process: its mark, name and what it holds of the app's memory; small ones read muted. The column is MiB, named on hover rather than in every row.
function Line(props: {band?: string; depth: number; node: ProcessNode; onHover: (id?: string) => void}) {
	const memory = mib.format(props.node.memory / 1024 ** 2)
	const parent = Array.isReadonlyArrayNonEmpty(props.node.children)
	return (
		<Item
			size="row"
			className={cn(
				'after:hidden',
				Boolean.match(parent, {
					onFalse: () => 'relative',
					onTrue: () =>
						'sticky z-(--sticky-z) top-[calc(var(--sticky-depth)*2rem)] max-sm:top-[calc(var(--sticky-depth)*2.75rem)]'
				})
			)}
			style={{
				'--indent': `calc(var(--spacing) * ${props.depth * 4})`,
				'--sticky-depth': `${props.depth}`,
				'--sticky-z': `${100 - props.depth}`
			}}
			onPointerEnter={() => props.onHover(props.band)}
			onPointerLeave={() => props.onHover()}
		>
			{/* A pinned parent covers the rows sliding under it with the pane's own background. */}
			{parent && (
				<span
					aria-hidden="true"
					className="bg-background group-hover/item:bg-muted/30 pointer-events-none absolute inset-0"
				/>
			)}
			<ItemMedia className="pointer-events-none relative z-10 ml-(--indent)">
				<ApplicationIcon name={props.node.name} small />
			</ItemMedia>
			<ItemContent className="pointer-events-none relative z-10">
				<div
					className={cn(
						'flex min-w-0 flex-1 items-baseline gap-2 text-left',
						props.node.small && 'text-muted-foreground'
					)}
				>
					<span className="max-w-full min-w-0 shrink truncate font-mono text-xs tracking-normal normal-case">
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
				<span
					aria-label={`${memory} MiB`}
					title="MiB"
					className="text-muted-foreground w-12 shrink-0 text-right font-mono text-xs tracking-normal normal-case tabular-nums"
				>
					{memory}
				</span>
			</ItemActions>
		</Item>
	)
}

// Every process stays open; nesting is its indentation. A parent's row sticks within its own subtree, so the chain to the rows on screen stays visible.
function Node(props: {band?: string; depth: number; node: ProcessNode; onHover: (id?: string) => void}) {
	if (Array.isArrayEmpty(props.node.children)) {
		return <Line band={props.band} depth={props.depth} node={props.node} onHover={props.onHover} />
	}
	return (
		<div>
			<Line band={props.band} depth={props.depth} node={props.node} onHover={props.onHover} />
			{Array.map(props.node.children, child => (
				<Node
					key={`${child.pid}:${child.name}`}
					band={props.band}
					depth={props.depth + 1}
					node={child}
					onHover={props.onHover}
				/>
			))}
		</div>
	)
}

export function Processes(props: {band?: string; onHover: (id?: string) => void; tree: readonly ProcessNode[]}) {
	return (
		<div className="min-w-0">
			{Array.map(props.tree, node => (
				<Node key={`${node.pid}:${node.name}`} band={props.band} depth={0} node={node} onHover={props.onHover} />
			))}
		</div>
	)
}
