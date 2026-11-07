import {assert, it} from '@effect/vitest'

import {Array, Option} from 'effect'

import {route} from '#services/game/lib/path.ts'

it('returns every tile of a long corridor in walking order without exhausting the call stack', () => {
	assert.deepStrictEqual(
		route(
			(x, z, dx, dz) => {
				if (z === 0 && dz === 0 && x + dx >= 0) return 1
				return Infinity
			},
			{x: 0, z: 0},
			{x: 5000, z: 0},
			{budget: 6000, near: 0}
		),
		Option.some(Array.map(Array.range(1, 5000), x => ({x: x + 0.5, z: 0.5})))
	)
})
