import type {Router} from '@effect/ui'
import {BrowserRouter} from '@effect/ui/html'

import {Effect, Layer, Predicate, pipe} from 'effect'

export function mountPage(
	routes: Router.Routes,
	mount: (root: HTMLElement) => Layer.Layer<never, never, Router.Services>
) {
	const root = document.getElementById('root')
	if (Predicate.isNull(root)) throw new TypeError('Missing application mount element with id "root"')

	pipe(
		mount(root),
		Layer.provide(BrowserRouter.layer({routes})),
		Layer.launch,
		// oxlint-disable-next-line eslint/no-restricted-properties -- The browser owns this root for the life of the page.
		Effect.runFork
	)
}
