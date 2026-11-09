import {assert, it} from '@effect/vitest'

import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

import {Denied, Error} from '#components/fallbacks.tsx'

it('names a blocking failure on the one button that retries it, without exposing diagnostics', () => {
	const html = renderToStaticMarkup(
		createElement(Error, {error: new TypeError('PRIVATE DIAGNOSTIC'), reset: () => undefined})
	)
	assert.include(html, 'role="alert"')
	assert.match(html, /<button[^>]*>.*Can’t load this view<\/button>/u)
	assert.notInclude(html, 'PRIVATE DIAGNOSTIC')
})

it('shows the safe reason supplied by the owning reader', () => {
	const html = renderToStaticMarkup(
		createElement(Error, {error: undefined, label: 'Can’t reach desktop', reset: () => undefined})
	)
	assert.match(html, /<button[^>]*>.*Can’t reach desktop<\/button>/u)
	assert.notInclude(html, 'Can’t load this view')
})

it('offers nothing to retry when access is denied', () => {
	const html = renderToStaticMarkup(createElement(Denied))
	assert.include(html, 'aria-label="Access denied"')
	assert.notInclude(html, '<button')
})
