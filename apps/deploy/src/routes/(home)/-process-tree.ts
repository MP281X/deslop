import {Array, Boolean, Function, MutableHashSet, Number, Option, Order, pipe} from 'effect'

import type {Process, ProcessLabel} from '#services/inventory/schema.ts'

// A process with everything below it: `memory`, `cpu` and `count` cover the subtree; `cpu` stays unknown while no member reports one.
export type ProcessNode = {
	children: readonly ProcessNode[]
	command?: readonly string[]
	count: number
	cpu?: number
	label: ProcessLabel
	memory: number
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

function sameLabel(first: ProcessLabel, second: ProcessLabel) {
	return first.name === second.name && first.detail === second.detail
}

// A child that says the same thing as its parent is the same row: hide it, keep its descendants, and leave its usage in the parent's total.
function absorb(label: ProcessLabel, children: readonly ProcessNode[]): readonly ProcessNode[] {
	const matching = Array.filter(children, child => sameLabel(child.label, label))
	if (Array.isArrayEmpty(matching)) return children
	return [
		...Array.filter(children, child => !sameLabel(child.label, label)),
		...absorb(
			label,
			Array.flatMap(matching, child => child.children)
		)
	]
}

function fold(node: ProcessNode): ProcessNode {
	return {...node, children: absorb(node.label, Array.map(node.children, fold))}
}

// The app's processes as a tree: a child with its parent's label folds into it, and each process appears once.
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
			label: row.label,
			memory: row.memory,
			pid: row.pid,
			small: false
		}
		return {...self, ...usage([self, ...below]), children: below}
	}
	const roots = pipe(
		Array.filter(rows, row => !MutableHashSet.has(pids, row.parent)),
		// A malformed source whose parents form a cycle has no root, so its first process starts the tree.
		Array.match({onEmpty: () => Array.take(rows, 1), onNonEmpty: Function.identity}),
		Array.map(node => fold(build(node)))
	)
	const appMemory = usage(roots).memory
	function place(node: ProcessNode): ProcessNode {
		return {...node, children: settle(Array.map(node.children, place), appMemory)}
	}
	return settle(Array.map(roots, place), appMemory)
}

export function appUsage(rows: readonly Process[]) {
	return {
		cpu: Array.match(Array.getSomes(Array.map(rows, row => Option.fromUndefinedOr(row.cpu))), {
			onEmpty: () => undefined,
			onNonEmpty: values => Number.round(Number.sumAll(values), 2)
		}),
		memory: Number.sumAll(Array.map(rows, row => row.memory))
	}
}
