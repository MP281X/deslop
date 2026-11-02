import {assert, it} from '@effect/vitest'

import {Array, Boolean, Order} from 'effect'

import {processTree, processUsage} from '#routes/(home)/-process-tree.ts'
import type {Process} from '#services/inventory/schema.ts'

it('collapses wrapper chains, groups leaf siblings and preserves every process exactly once', () => {
	const rows = Array.makeBy(20, index => ({
		cpu: 1,
		memory: index + 1,
		name: Boolean.match(index < 5, {onFalse: () => 'postgres', onTrue: () => 'bun.native'}),
		parent: Boolean.match(index === 0, {
			onFalse: () => Boolean.match(index < 5, {onFalse: () => 5, onTrue: () => index}),
			onTrue: () => 0
		}),
		pid: index + 1
	}))
	const tree = processTree(rows)
	assert.lengthOf(tree, 2)
	assert.strictEqual(tree[0]?.main, true)
	assert.strictEqual(tree[1]?.name, 'postgres ×15')
	assert.deepStrictEqual(
		Array.sort(
			Array.map(
				Array.flatMap(tree, row => row.members),
				row => row.pid
			),
			Order.Number
		),
		Array.map(rows, row => row.pid)
	)
	assert.deepStrictEqual(processUsage(Array.flatMap(tree, row => row.members)), {cpu: 20, memory: 210, partial: false})
})

it('bounds indentation, keeps unknown CPU unknown and terminates cyclic source relationships', () => {
	const rows: Process[] = [
		{memory: 1, name: 'node', parent: 2, pid: 1},
		{memory: 2, name: 'node', parent: 1, pid: 2}
	]
	const tree = processTree(rows)
	assert.lengthOf(tree, 1)
	assert.strictEqual(processUsage(tree[0]?.members ?? []).cpu, undefined)
	assert.isTrue(Array.every(tree, row => row.depth <= 2))
	assert.strictEqual(processUsage(rows).memory, 3)
	assert.deepStrictEqual(processUsage([...rows, {...rows[0], cpu: 5, memory: 1, name: 'bun', parent: 0, pid: 3}]), {
		cpu: 5,
		memory: 4,
		partial: true
	})
})
