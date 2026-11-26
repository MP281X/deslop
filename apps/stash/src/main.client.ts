import './routes/styles.css'

import {Router} from '@effect/ui'
import {BrowserHost, BrowserRouter} from '@effect/ui/html'

import {Effect, Layer, pipe} from 'effect'

import '@deslop/ui/theme.css'

import {StashRoute} from '#routes/model.ts'
import {Stash} from '#routes/stash.ts'

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
