import {assert, it} from '@effect/vitest'

import {Array} from 'effect'

import {TagName} from './contract.ts'
import {pathsOf, tagCounts, webLinksOnly} from './shared.ts'

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

it('keeps web links and turns any other destination into its text', () => {
	assert.strictEqual(
		webLinksOnly('- [Docs](https://example.com/a) and [call](tel:123), [app](shortcuts://run) <sms:1> <https://x.com>'),
		'- [Docs](https://example.com/a) and call, app sms:1 <https://x.com>'
	)
})

it('shows the cover until the pictures are counted, then the first picture as the cover', () => {
	assert.deepStrictEqual(pathsOf('n', true, 0), ['/api/images/n'])
	assert.deepStrictEqual(pathsOf('n', false, 0), [])
	assert.deepStrictEqual(pathsOf('n', true, 2), ['/api/images/n', '/api/notes/n/media/1'])
	assert.deepStrictEqual(pathsOf('n', false, 1), ['/api/notes/n/media/0'])
})
