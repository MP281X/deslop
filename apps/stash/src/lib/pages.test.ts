import {assert, it} from '@effect/vitest'

import {pagesOf} from '#lib/pages.ts'

it('shows the cover until the pictures are counted, then the first picture as the cover', () => {
	assert.deepStrictEqual(pagesOf(true, 'n', 0), [{kind: 'cover', path: 'n/cover'}])
	assert.deepStrictEqual(pagesOf(false, 'n', 0), [])
	assert.deepStrictEqual(pagesOf(true, 'n', 2), [
		{kind: 'cover', path: 'n/media/0'},
		{kind: 'image', path: 'n/media/1'}
	])
	assert.deepStrictEqual(pagesOf(false, 'n', 1), [{kind: 'image', path: 'n/media/0'}])
})
