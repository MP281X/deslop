import {assert, it} from '@effect/vitest'

import {Array} from 'effect'

import {TagName} from '#contracts'

import {tagCounts} from '#web/notes/kinds.ts'

it('orders tags by how many notes use them, then by name', () => {
	assert.deepStrictEqual(
		tagCounts([
			{tags: Array.map(['cooking', 'quick meals'], tag => TagName.make(tag))},
			{tags: Array.map(['cooking', 'history'], tag => TagName.make(tag))}
		]),
		[
			{count: 2, tag: 'cooking'},
			{count: 1, tag: 'history'},
			{count: 1, tag: 'quick meals'}
		]
	)
})
