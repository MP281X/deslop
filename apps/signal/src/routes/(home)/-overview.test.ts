import {assert, it} from '@effect/vitest'

import {Array, Boolean, Schema} from 'effect'

import {overviewChunk} from './-overview.ts'

import {makeWorld} from '#services/world/lib/utils.ts'

it('builds bounded terrain LOD from the real seed without generating detailed chunks', () => {
	const world = makeWorld(898_004_791)
	const built = overviewChunk(
		{
			...world,
			chunk: () => {
				assert.fail('Detailed terrain must not be built at overview scale.')
			}
		},
		-3,
		8
	)
	assert.isAtLeast(built.terrain.positions.length, 64 * 6 * 3)
	assert.isAtMost(built.terrain.positions.length, 64 * 5 * 6 * 3)
	assert.strictEqual(built.props.positions.length, 0)
	assert.deepStrictEqual(built.instances, [])
	assert.strictEqual(built.corners[0], world.tileAt(-94, 258).level)
	assert.deepStrictEqual(overviewChunk(world, -3, 8), built)
})

it('builds flat terraces and vertical walls with no gap or duplicate wall across a chunk boundary', () => {
	const world = makeWorld(898_004_791)
	const stepped = {
		...world,
		terrainAt: (x: number, z: number) => ({
			...world.tileAt(x, z),
			level: Boolean.match(x < 0, {onFalse: () => 0, onTrue: () => 4})
		})
	}
	const left = overviewChunk(stepped, -1, 0)
	const right = overviewChunk(stepped, 0, 0)
	assert.strictEqual(left.terrain.positions.length, (64 + 8) * 6 * 3)
	assert.strictEqual(right.terrain.positions.length, 64 * 6 * 3)
	for (const face of Array.chunksOf(Array.fromIterable(left.terrain.positions), 18)) {
		assert.strictEqual(
			Array.countBy(
				[0, 1, 2],
				axis => Array.dedupe(Array.map(Array.chunksOf(face, 3), vertex => vertex[axis])).length === 1
			),
			1
		)
	}
})

it('resolves ruin stairs to finite terrace geometry without generating detailed chunks', () => {
	const world = makeWorld(898_004_791)
	for (const cz of [21, 22]) {
		const built = overviewChunk(world, -29, cz)
		assert.isTrue(Array.every(Array.fromIterable(built.terrain.positions), Schema.is(Schema.Finite)))
		assert.isTrue(Array.every(Array.fromIterable(built.corners), Schema.is(Schema.Finite)))
	}
})
