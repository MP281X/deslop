import {Array, Boolean, Function, MutableHashSet, Number, Option, Order, String, pipe} from 'effect'

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
		count: Array.reduce(nodes, 0, (sum, node) => sum + node.count),
		memory: Array.reduce(nodes, 0, (sum, node) => sum + node.memory)
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
		cpu: Boolean.match(
			Array.some(rows, row => row.cpu !== undefined),
			{
				onFalse: () => undefined,
				onTrue: () =>
					Number.round(
						Array.reduce(rows, 0, (sum, row) => sum + (row.cpu ?? 0)),
						2
					)
			}
		),
		memory: Array.reduce(rows, 0, (sum, row) => sum + row.memory)
	}
}
