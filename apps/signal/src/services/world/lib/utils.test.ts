import {assert, it} from '@effect/vitest'

import {Array, Option} from 'effect'

import {MOVERS, crossable, makeWorld, tileGround} from '#services/world/lib/utils.ts'
import type {Edit} from '#services/world/schema.ts'

it('generates the same chunks whatever order they are asked in', () => {
	const first = makeWorld(7)
	const second = makeWorld(7)
	const ahead = second.chunk(1, 0)
	assert.deepStrictEqual(first.chunk(0, 0), second.chunk(0, 0))
	assert.deepStrictEqual(first.chunk(1, 0), ahead)
})

it('opens three far-apart starts, each with the same start fields round its base', () => {
	for (const seed of [1, 42, 9001]) {
		const world = makeWorld(seed)
		const spawns = world.spawns()
		assert.strictEqual(spawns.length, 3)
		assert.deepStrictEqual(
			Array.map(spawns, spawn =>
				Array.map(spawn.fields, id => {
					const field = Option.getOrThrow(world.field(id))
					assert.isAbove(field.total, 0)
					assert.isAtMost(Math.hypot(field.x - spawn.x, field.z - spawn.z), spawn.radius)
					return field.material
				})
			),
			Array.replicate(['stone', 'iron', 'copper', 'coal'], 3)
		)
		for (const pair of Array.zip(spawns, [...Array.drop(spawns, 1), ...Array.take(spawns, 1)])) {
			assert.isAbove(Math.hypot(pair[0].x - pair[1].x, pair[0].z - pair[1].z), 350)
		}
	}
})

it('lets wheels up a one-level step only once a ramp is built', () => {
	const chunk = makeWorld(7).chunk(0, 0)
	// Corners in chunk order: north-west, north-east, south-west, south-east; the ramp rises to the east.
	const edit: Edit = {_tag: 'Ramp', corners: [0, 1, 0, 1]}
	const low = {...tileGround(chunk, 0, Option.none()), corners: [0, 0, 0, 0], liquid: 0}
	const high = {...low, corners: [1, 1, 1, 1]}
	const ramp = {...tileGround(chunk, 0, Option.some(edit)), liquid: 0}
	assert.isFalse(crossable(MOVERS.wheels, low, high, 1, 0))
	assert.isTrue(crossable(MOVERS.wheels, ramp, high, 1, 0))
	assert.isTrue(crossable(MOVERS.wheels, high, ramp, -1, 0))
})
