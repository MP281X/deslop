import {assert, it} from '@effect/vitest'

import {Array} from 'effect'

import {couplingOf} from '#lib/coupling.ts'
import {FileChange, PullRequest} from '#services/changes/schema.ts'

function prOf(number: number, paths: readonly string[]) {
	return PullRequest.make({
		additions: 0,
		author: 'dev',
		base: 'main',
		checks: 'none',
		comments: 0,
		createdAt: '2026-11-01T00:00:00.000Z',
		deletions: 0,
		files: Array.map(paths, path => FileChange.make({additions: 1, deletions: 0, path, state: 'modified'})),
		head: 'feature',
		number,
		repoId: 'github.com/MP281X/deslop',
		review: 'none',
		state: 'open',
		title: 'Change',
		updatedAt: '2026-11-01T00:00:00.000Z',
		url: `https://github.com/MP281X/deslop/pull/${number}`
	})
}

it('scores an area pair by how often its areas share a pull request', () => {
	const matrix = couplingOf([prOf(1, ['apps/a/x.ts', 'apps/b/y.ts']), prOf(2, ['apps/a/x.ts'])], 10)
	assert.deepStrictEqual(matrix.areas, ['apps/a', 'apps/b'])
	assert.deepStrictEqual(matrix.cells, [{a: 'apps/a', b: 'apps/b', count: 1, score: 1}])
	assert.strictEqual(matrix.maxCount, 1)
	assert.strictEqual(matrix.maxScore, 1)
})

it('ranks areas by pull request count, then name', () => {
	const matrix = couplingOf(
		[prOf(1, ['apps/a/x.ts', 'apps/b/y.ts']), prOf(2, ['apps/a/x.ts']), prOf(3, ['apps/a/x.ts', 'packages/z/y.ts'])],
		10
	)
	assert.deepStrictEqual(matrix.areas, ['apps/a', 'apps/b', 'packages/z'])
})

it('keeps only the limited areas and their cells', () => {
	const matrix = couplingOf(
		[prOf(1, ['apps/a/x.ts', 'apps/b/y.ts']), prOf(2, ['apps/a/x.ts']), prOf(3, ['apps/a/x.ts', 'packages/z/y.ts'])],
		2
	)
	assert.deepStrictEqual(matrix.areas, ['apps/a', 'apps/b'])
	assert.deepStrictEqual(matrix.cells, [{a: 'apps/a', b: 'apps/b', count: 1, score: 1}])
})

it('never pairs an area with itself', () => {
	const matrix = couplingOf([prOf(1, ['apps/a/x.ts', 'apps/a/y.ts'])], 10)
	assert.deepStrictEqual(matrix.areas, ['apps/a'])
	assert.deepStrictEqual(matrix.cells, [])
	assert.strictEqual(matrix.maxCount, 0)
	assert.strictEqual(matrix.maxScore, 0)
})
