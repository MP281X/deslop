import {Array, Boolean, HashSet, MutableHashSet, MutableList, Number, Order, Record, String} from 'effect'

import type {Process} from '#services/inventory/schema.ts'

const processName = String.replace(/-MainThread$|\.native$/u, '')

export function processUsage(rows: readonly Process[]) {
	return {
		cpu: Boolean.match(
			Array.some(rows, row => row.cpu !== undefined),
			{onFalse: () => undefined, onTrue: () => Array.reduce(rows, 0, (sum, row) => sum + (row.cpu ?? 0))}
		),
		memory: Boolean.match(Array.isReadonlyArrayNonEmpty(rows), {
			onFalse: () => undefined,
			onTrue: () => Array.reduce(rows, 0, (sum, row) => sum + row.memory)
		}),
		partial: Array.some(rows, row => row.cpu === undefined)
	}
}

// Each group owns disjoint members; wrappers never inflate the totals.
export function processTree(rows: readonly Process[]) {
	const ids = HashSet.fromIterable(Array.map(rows, row => row.pid))
	const children = Array.groupBy(rows, row => `${row.parent}`)
	const visited = MutableHashSet.empty<number>()
	const groups = MutableList.make<{depth: number; main: boolean; members: Process[]; name: string; path: string}>()
	function chain(row: Process, members: MutableList.MutableList<Process>): Process {
		MutableHashSet.add(visited, row.pid)
		MutableList.append(members, row)
		const next = children[`${row.pid}`] ?? []
		if (next.length === 1 && next[0] !== undefined && !MutableHashSet.has(visited, next[0].pid)) {
			return chain(next[0], members)
		}
		return row
	}
	function visit(first: Process, depth: number, main: boolean) {
		if (MutableHashSet.has(visited, first.pid)) return
		const collected = MutableList.make<Process>()
		const last = chain(first, collected)
		const members = MutableList.toArray(collected)
		const heaviest = Array.sortWith(members, row => row.memory, Order.flip(Order.Number))[0] ?? first
		MutableList.append(groups, {
			depth: Number.min(depth, 2),
			main,
			members,
			name: processName(heaviest.name),
			path: Array.join(
				Array.map(members, row => processName(row.name)),
				' › '
			)
		})
		const descendants = Array.filter(children[`${last.pid}`] ?? [], row => !MutableHashSet.has(visited, row.pid))
		const leaves = Array.groupBy(
			Array.filter(descendants, row => Array.isReadonlyArrayEmpty(children[`${row.pid}`] ?? [])),
			row => processName(row.name)
		)
		for (const siblings of Record.values(leaves)) {
			const leaf = siblings[0]
			if (leaf !== undefined) {
				for (const sibling of siblings) MutableHashSet.add(visited, sibling.pid)
				MutableList.append(groups, {
					depth: Number.min(depth + 1, 2),
					main: false,
					members: siblings,
					name: `${processName(leaf.name)}${Boolean.match(siblings.length > 1, {onFalse: () => '', onTrue: () => ` ×${siblings.length}`})}`,
					path: processName(leaf.name)
				})
			}
		}
		for (const child of descendants) visit(child, depth + 1, false)
	}
	const roots = Array.sortWith(
		Array.filter(rows, row => !HashSet.has(ids, row.parent)),
		(row: Process) => row.memory,
		Order.flip(Order.Number)
	)
	for (const root of roots) visit(root, 1, roots.length === 1)
	// A malformed source must not hide processes or recurse forever.
	for (const row of rows) visit(row, 1, false)
	return MutableList.toArray(groups)
}
