import {assert, it} from '@effect/vitest'

import {Array, Number, Option} from 'effect'

import {squarify} from '#lib/treemap.ts'

const ITEMS = [
	{key: 'a', value: 5},
	{key: 'b', value: 3},
	{key: 'c', value: 2},
	{key: 'd', value: 1}
]

it('keeps every tile inside the box and disjoint', () => {
	const tiles = squarify(ITEMS, 300, 200)
	assert.lengthOf(tiles, 4)
	Array.forEach(tiles, tile => {
		assert.isAtLeast(tile.x, 0)
		assert.isAtLeast(tile.y, 0)
		assert.isAtMost(tile.x + tile.width, 300)
		assert.isAtMost(tile.y + tile.height, 200)
	})
	Array.forEach(tiles, (tile, index) =>
		Array.forEach(Array.drop(tiles, index + 1), other => {
			const width = Number.min(tile.x + tile.width, other.x + other.width) - Number.max(tile.x, other.x)
			const height = Number.min(tile.y + tile.height, other.y + other.height) - Number.max(tile.y, other.y)
			assert.isFalse(width > 0 && height > 0)
		})
	)
})

it('sizes tiles in proportion to their values', () => {
	const tiles = squarify(
		[
			{key: 'small', value: 1},
			{key: 'large', value: 3}
		],
		100,
		100
	)
	const large = Option.getOrThrow(Array.findFirst(tiles, tile => tile.key === 'large'))
	const small = Option.getOrThrow(Array.findFirst(tiles, tile => tile.key === 'small'))
	assert.closeTo(large.width * large.height, 7500, 0.001)
	assert.closeTo(small.width * small.height, 2500, 0.001)
})

it('drops empty values and boxes without area', () => {
	assert.deepStrictEqual(squarify([], 100, 100), [])
	assert.deepStrictEqual(
		squarify(
			[
				{key: 'zero', value: 0},
				{key: 'negative', value: -1}
			],
			100,
			100
		),
		[]
	)
	assert.deepStrictEqual(squarify(ITEMS, 0, 100), [])
})
