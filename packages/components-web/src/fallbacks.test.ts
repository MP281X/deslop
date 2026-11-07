import {assert, it} from '@effect/vitest'

import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

import {Error} from '#components/fallbacks.tsx'

it('gives blocking failures a brief reason and a destructive Retry without exposing diagnostics', () => {
	const html = renderToStaticMarkup(
		createElement(Error, {error: new TypeError('PRIVATE DIAGNOSTIC'), reset: () => undefined})
	)
	assert.include(html, 'role="alert"')
	assert.include(html, 'Can’t load this view.')
	assert.include(html, 'Retry')
	assert.include(html, 'text-destructive')
	assert.notInclude(html, 'PRIVATE DIAGNOSTIC')
	assert.notInclude(html, '0s')
})

it('shows the safe reason supplied by the owning reader', () => {
	const html = renderToStaticMarkup(
		createElement(Error, {error: undefined, label: 'You don’t have access.', reset: () => undefined})
	)
	assert.include(html, 'You don’t have access.')
	assert.notInclude(html, 'Can’t load this view.')
})
