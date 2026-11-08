import {assert, it} from '@effect/vitest'

import {String} from 'effect'

import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

import {ItemListSkeleton} from '#components/item-list.tsx'

it('owns the loading status and shape of shared rows', () => {
	const html = renderToStaticMarkup(createElement(ItemListSkeleton, {label: 'People', media: true, rows: 3}))
	assert.include(html, 'aria-busy="true"')
	assert.include(html, 'aria-label="People"')
	assert.include(html, 'role="status"')
	assert.strictEqual(String.split(html, 'aria-hidden="true"').length - 1, 3)
	assert.include(html, 'h-14')
	assert.include(html, 'gap-3.5')
	assert.include(html, 'px-4')
	assert.include(html, 'shrink-0')
})

it('composes local row alignment and media size without conflicting utilities', () => {
	const html = renderToStaticMarkup(
		createElement(ItemListSkeleton, {
			label: 'Apps',
			media: true,
			mediaClassName: 'size-3.5',
			rowClassName: 'gap-2 px-3',
			rows: 8
		})
	)
	assert.strictEqual(String.split(html, 'aria-hidden="true"').length - 1, 8)
	assert.include(html, 'gap-2')
	assert.include(html, 'px-3')
	assert.include(html, 'h-14')
	assert.notInclude(html, 'gap-3.5')
	assert.notInclude(html, 'px-4')
	assert.include(html, 'size-3.5')
	assert.notInclude(html, 'size-9')
})
