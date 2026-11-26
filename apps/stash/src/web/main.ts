import './notes/styles.css'

import {Router} from '@effect/ui'
import {BrowserHost, BrowserRouter} from '@effect/ui/html'

import {Effect, Layer, pipe} from 'effect'

import '@deslop/ui/theme.css'

import {Stash} from '#web/notes/stash.ts'
import {StashRoute} from '#web/routes.ts'

const root = document.getElementById('root')
if (root !== null) {
	pipe(
		BrowserHost.mount(Stash, Router.props(StashRoute), root, {head: false}),
		Layer.provide(BrowserRouter.layer({routes: StashRoute})),
		Layer.launch,
		// oxlint-disable-next-line eslint/no-restricted-properties -- BrowserHost owns the mounted app for the page lifetime.
		Effect.runFork
	)
}
