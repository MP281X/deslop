import {assert, it} from '@effect/vitest'

import {Array, Order} from 'effect'

import {appUsage, processTree} from '#routes/(home)/-process-tree.ts'
import type {ProcessNode} from '#routes/(home)/-process-tree.ts'
import type {Process} from '#services/inventory/schema.ts'

function pids(nodes: readonly ProcessNode[]): number[] {
	return Array.flatMap(nodes, node => [...Array.filter([node.pid], pid => pid > 0), ...pids(node.children)])
}

it('nests children heaviest first and keeps every process exactly once', () => {
	const rows: Process[] = [
		{cpu: 1, memory: 100, name: 'node', parent: 0, pid: 1},
		{cpu: 4, memory: 300, name: 'claude', parent: 1, pid: 2},
		{cpu: 0, memory: 200, name: 'chrome', parent: 1, pid: 3},
		{cpu: 0, memory: 50, name: 'chrome', parent: 3, pid: 4}
	]
	const tree = processTree(rows)
	assert.lengthOf(tree, 1)
	assert.strictEqual(tree[0]?.memory, 650)
	assert.strictEqual(tree[0]?.cpu, 5)
	assert.deepStrictEqual(
		Array.map(tree[0]?.children ?? [], node => node.name),
		['claude', 'chrome']
	)
	assert.deepStrictEqual(Array.sort(pids(tree), Order.Number), [1, 2, 3, 4])
})

it('folds a parent that only wraps another parent into one line', () => {
	const tree = processTree([
		{memory: 10, name: 'bash', parent: 0, pid: 1},
		{memory: 20, name: 'node', parent: 1, pid: 2},
		{memory: 30, name: 'bun', parent: 2, pid: 3},
		{memory: 40, name: 'bun', parent: 2, pid: 4}
	])
	assert.strictEqual(tree[0]?.name, 'bash › node')
	assert.strictEqual(tree[0]?.memory, 100)
	assert.lengthOf(tree[0]?.children ?? [], 2)
})

it('mutes processes that barely use anything without folding them away', () => {
	const tree = processTree([
		{cpu: 2, memory: 1000, name: 'postgres', parent: 0, pid: 1},
		{cpu: 0, memory: 300, name: 'writer', parent: 1, pid: 2},
		...Array.makeBy(3, index => ({cpu: 0, memory: 1, name: 'worker', parent: 1, pid: index + 3}))
	])
	assert.deepStrictEqual(
		Array.map(tree[0]?.children ?? [], node => ({name: node.name, small: node.small})),
		[
			{name: 'writer', small: false},
			{name: 'worker', small: true},
			{name: 'worker', small: true},
			{name: 'worker', small: true}
		]
	)
})

it('keeps unknown CPU unknown and terminates cyclic source relationships', () => {
	const rows: Process[] = [
		{memory: 1, name: 'node', parent: 2, pid: 1},
		{memory: 2, name: 'node', parent: 1, pid: 2}
	]
	const tree = processTree(rows)
	assert.lengthOf(tree, 1)
	assert.strictEqual(tree[0]?.cpu, undefined)
	assert.deepStrictEqual(appUsage(rows), {cpu: undefined, memory: 3})
})
