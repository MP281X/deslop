import {Array, Number, Option} from 'effect'

import {Tree} from '@deslop/components-web/tree'
import type {TreeRow} from '@deslop/components-web/tree'
import {cn} from '@deslop/components-web/utils'

import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import type {ProcessNode} from '#routes/(home)/-process-tree.ts'

const mib = new Intl.NumberFormat(undefined, {maximumFractionDigits: 0})
const percent = new Intl.NumberFormat(undefined, {maximumFractionDigits: 1})

// One 48×6px meter; its exact figure is what hovering reads and what the row announces.
function Meter(props: {color: string; label: string; share: number}) {
	return (
		<span
			role="img"
			aria-label={props.label}
			title={props.label}
			className="bg-input h-1.5 w-12 shrink-0 overflow-hidden"
		>
			<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="size-full">
				<rect width={Number.clamp(props.share, {maximum: 100, minimum: 0})} height="100" fill={props.color} />
			</svg>
		</span>
	)
}

// A process ends with its memory share of the app in the app's band hue, then its CPU share of the machine in cyan.
function Meters(props: {appMemory: number; hue: string; node: ProcessNode}) {
	const memory = mib.format(props.node.memory / 1024 ** 2)
	const cpu = Option.fromUndefinedOr(props.node.cpu)
	return (
		<span className="flex shrink-0 items-center gap-1.5">
			<Meter
				color={props.hue}
				label={`${memory} MiB`}
				share={(props.node.memory / Number.max(1, props.appMemory)) * 100}
			/>
			<Meter
				color="var(--cyan)"
				label={Option.match(cpu, {onNone: () => 'CPU not recorded', onSome: value => `${percent.format(value)}% CPU`})}
				share={Option.getOrElse(cpu, () => 0)}
			/>
		</span>
	)
}

// One process row: its mark, the command label and its two meters; small ones read muted.
function rowOf(props: {appMemory: number; hue: string; node: ProcessNode}): TreeRow {
	const row: TreeRow = {
		actions: <Meters appMemory={props.appMemory} hue={props.hue} node={props.node} />,
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
		id: `${props.node.pid}`,
		media: <ApplicationIcon name={props.node.label.name} small />,
		title: Array.join(props.node.command ?? [], ' ')
	}
	return Array.match(props.node.children, {
		onEmpty: () => row,
		onNonEmpty: children => ({...row, children: Array.map(children, child => rowOf({...props, node: child}))})
	})
}

// Every process is shown; nesting indents plainly, and a parent's row stays pinned under its ancestors.
export function Processes(props: {hue: string; tree: readonly ProcessNode[]}) {
	const appMemory = Number.sumAll(Array.map(props.tree, node => node.memory))
	return (
		// Its own stacking context keeps the pinned parents under the pane's scrollbar.
		<div className="isolate min-w-0">
			<Tree rows={Array.map(props.tree, node => rowOf({appMemory, hue: props.hue, node}))} stickyParents />
		</div>
	)
}
