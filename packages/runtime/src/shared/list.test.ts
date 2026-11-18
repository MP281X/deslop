import {assert, it} from '@effect/vitest'

import {Array, Order} from 'effect'

import {listReducer} from './list.ts'

type Item = {readonly at: number; readonly id: string}

const apply = listReducer(
	Order.mapInput(Order.Number, (item: Item) => item.at),
	item => item.id
)

it('keeps items that tie on the order in key order after one is replaced', () => {
	const listed = apply([], {
		removed: [],
		reset: true,
		upserted: [
			{at: 1, id: 'b'},
			{at: 1, id: 'a'}
		]
	})
	const replaced = apply(listed, {removed: [], reset: false, upserted: [{at: 1, id: 'a'}]})
	assert.deepStrictEqual(
		[Array.map(listed, item => item.id), Array.map(replaced, item => item.id)],
		[
			['a', 'b'],
			['a', 'b']
		]
	)
})
