import {assert, it} from '@effect/vitest'

import {String} from 'effect'

import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

import {ItemListSkeleton} from '#components/item-list.tsx'

it('announces one loading status over the rows it stands in for', () => {
	const html = renderToStaticMarkup(createElement(ItemListSkeleton, {label: 'People', media: true, rows: 3}))
	assert.include(html, 'aria-busy="true"')
	assert.include(html, 'aria-label="People"')
	assert.include(html, 'role="status"')
	assert.strictEqual(String.split(html, 'aria-hidden="true"').length - 1, 3)
})
