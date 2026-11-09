import {assert, it} from '@effect/vitest'

import {Array, Order} from 'effect'

import {appUsage, processTree} from '#routes/(home)/-process-tree.ts'
import type {ProcessNode} from '#routes/(home)/-process-tree.ts'
import type {Process} from '#services/inventory/schema.ts'

function label(name: string, detail = '') {
	return {detail, name}
}

function pids(nodes: readonly ProcessNode[]): number[] {
	return Array.flatMap(nodes, node => [...Array.filter([node.pid], pid => pid > 0), ...pids(node.children)])
}

it('nests children heaviest first and keeps every process exactly once', () => {
	const rows: Process[] = [
		{cpu: 1, label: label('node'), memory: 100, name: 'node', parent: 0, pid: 1},
		{cpu: 4, label: label('claude', 'opus'), memory: 300, name: 'claude', parent: 1, pid: 2},
		{cpu: 0, label: label('chrome'), memory: 200, name: 'chrome', parent: 1, pid: 3},
		{cpu: 0, label: label('chrome', 'gpu'), memory: 50, name: 'chrome', parent: 3, pid: 4}
	]
	const tree = processTree(rows)
	assert.lengthOf(tree, 1)
	assert.strictEqual(tree[0]?.memory, 650)
	assert.strictEqual(tree[0]?.cpu, 5)
	assert.deepStrictEqual(
		Array.map(tree[0]?.children ?? [], node => node.label.name),
		['claude', 'chrome']
	)
	assert.deepStrictEqual(Array.sort(pids(tree), Order.Number), [1, 2, 3, 4])
})

it('folds a child with its parent’s label, keeping its usage and descendants', () => {
	const tree = processTree([
		{cpu: 1, label: label('claude', 'opus'), memory: 10, name: 'sh', parent: 0, pid: 1},
		{cpu: 2, label: label('claude', 'opus'), memory: 20, name: 'claude', parent: 1, pid: 2},
		{cpu: 3, label: label('tool'), memory: 30, name: 'tool', parent: 2, pid: 3}
	])
	assert.strictEqual(tree[0]?.pid, 1)
	assert.deepStrictEqual(tree[0]?.label, label('claude', 'opus'))
	assert.strictEqual(tree[0]?.memory, 60)
	assert.strictEqual(tree[0]?.cpu, 6)
	assert.deepStrictEqual(
		Array.map(tree[0]?.children ?? [], node => node.label.name),
		['tool']
	)
	assert.deepStrictEqual(Array.sort(pids(tree), Order.Number), [1, 3])
})

it('mutes processes that barely use anything without folding them away', () => {
	const tree = processTree([
		{cpu: 2, label: label('postgres'), memory: 1000, name: 'postgres', parent: 0, pid: 1},
		{cpu: 0, label: label('writer'), memory: 300, name: 'writer', parent: 1, pid: 2},
		...Array.makeBy(3, index => ({
			cpu: 0,
			label: label('worker'),
			memory: 1,
			name: 'worker',
			parent: 1,
			pid: index + 3
		}))
	])
	assert.deepStrictEqual(
		Array.map(tree[0]?.children ?? [], node => ({name: node.label.name, small: node.small})),
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
		{label: label('node'), memory: 1, name: 'node', parent: 2, pid: 1},
		{label: label('node', 'worker'), memory: 2, name: 'node', parent: 1, pid: 2}
	]
	const tree = processTree(rows)
	assert.lengthOf(tree, 1)
	assert.strictEqual(tree[0]?.cpu, undefined)
	assert.deepStrictEqual(appUsage(rows), {cpu: undefined, memory: 3})
})
