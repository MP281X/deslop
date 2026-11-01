import {assert, it} from '@effect/vitest'

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
	assert.strictEqual(built.terrain.positions.length, 16 * 6 * 3)
	assert.strictEqual(built.props.positions.length, 0)
	assert.deepStrictEqual(built.instances, [])
	assert.strictEqual(built.corners[0], world.tileAt(-92, 260).level)
	assert.deepStrictEqual(overviewChunk(world, -3, 8), built)
})
