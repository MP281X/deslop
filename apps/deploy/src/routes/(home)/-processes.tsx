import {Array, Boolean, Function, MutableHashSet, Number, Option, Order, String, pipe} from 'effect'

import {CaretRightIcon} from '@phosphor-icons/react'

import {Button} from '@deslop/components-web/ui/button'
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@deslop/components-web/ui/collapsible'
import {Item, ItemActions, ItemContent, ItemMedia} from '@deslop/components-web/ui/item'
import {cn} from '@deslop/components-web/utils'

import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import type {Process} from '#services/inventory/schema.ts'

const processName = String.replace(/-MainThread$|\.native$/u, '')

// A process with everything below it: `memory`, `cpu` and `count` cover the subtree; `cpu` stays unknown while no member reports one.
export type ProcessNode = {
	children: ProcessNode[]
	command?: readonly string[]
	count: number
	cpu?: number
	memory: number
	name: string
	pid: number
	small: boolean
}

function usage(nodes: readonly ProcessNode[]) {
	const cpus = Array.getSomes(Array.map(nodes, node => Option.fromUndefinedOr(node.cpu)))
	return {
		...Boolean.match(Array.isReadonlyArrayNonEmpty(cpus), {
			onFalse: () => ({}),
			onTrue: () => ({cpu: Number.sumAll(cpus)})
		}),
		count: Number.sumAll(Array.map(nodes, node => node.count)),
		memory: Number.sumAll(Array.map(nodes, node => node.memory))
	}
}

const byUsage = Order.combine(
	Order.mapInput(Order.flip(Order.Number), (node: ProcessNode) => node.memory),
	Order.mapInput(Order.flip(Order.Number), (node: ProcessNode) => node.cpu ?? 0)
)

// Children heaviest first; below 2% of the app's memory and half a percent of the machine's CPU a process barely moves the usage, so it reads muted.
function settle(children: readonly ProcessNode[], appMemory: number) {
	return Array.map(Array.sort(children, byUsage), node => ({
		...node,
		small: node.memory < appMemory * 0.02 && (node.cpu ?? 0) < 0.5
	}))
}

// The app's processes as a tree: a parent that only wraps one parent shows as `parent › child`, and each process appears once.
export function processTree(rows: readonly Process[]) {
	const pids = MutableHashSet.fromIterable(Array.map(rows, row => row.pid))
	const children = Array.groupBy(rows, row => `${row.parent}`)
	const visited = MutableHashSet.empty<number>()
	function build(row: Process): ProcessNode {
		MutableHashSet.add(visited, row.pid)
		const below = Array.map(
			Array.filter(children[`${row.pid}`] ?? [], child => !MutableHashSet.has(visited, child.pid)),
			build
		)
		const self: ProcessNode = {
			children: [],
			count: 1,
			...Option.match(Option.fromUndefinedOr(row.command), {onNone: () => ({}), onSome: command => ({command})}),
			...Option.match(Option.fromUndefinedOr(row.cpu), {onNone: () => ({}), onSome: cpu => ({cpu})}),
			memory: row.memory,
			name: processName(row.name),
			pid: row.pid,
			small: false
		}
		const total = usage([self, ...below])
		const only = below[0]
		if (below.length === 1 && only !== undefined && Array.isArrayNonEmpty(only.children)) {
			return {...only, ...total, name: `${self.name} › ${only.name}`}
		}
		return {...self, ...total, children: below}
	}
	const roots = pipe(
		Array.filter(rows, row => !MutableHashSet.has(pids, row.parent)),
		// A malformed source whose parents form a cycle has no root, so its first process starts the tree.
		Array.match({onEmpty: () => Array.take(rows, 1), onNonEmpty: Function.identity}),
		Array.map(build)
	)
	const appMemory = usage(roots).memory
	function place(node: ProcessNode): ProcessNode {
		return {...node, children: settle(Array.map(node.children, place), appMemory)}
	}
	return settle(Array.map(roots, place), appMemory)
}

// An app's current memory and CPU over its processes; CPU stays unknown while none reports one.
export function appUsage(rows: readonly Process[]) {
	return {
		cpu: Array.match(Array.getSomes(Array.map(rows, row => Option.fromUndefinedOr(row.cpu))), {
			onEmpty: () => undefined,
			onNonEmpty: values => Number.round(Number.sumAll(values), 2)
		}),
		memory: Number.sumAll(Array.map(rows, row => row.memory))
	}
}

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
