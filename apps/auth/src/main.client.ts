import './routes/styles.css'

import {Router} from '@effect/ui'
import {BrowserHost, BrowserRouter} from '@effect/ui/html'

import {Effect, Layer, Predicate, pipe} from 'effect'

import {AuthRoute} from '#routes/(home)/-model.ts'
import {Auth} from '#routes/(home)/index.ts'

const root = document.getElementById('root')
if (!Predicate.isNull(root)) {
	pipe(
		BrowserHost.mount(Auth, Router.props(AuthRoute), root),
		Layer.provide(BrowserRouter.layer({routes: AuthRoute})),
		Layer.launch,
		// oxlint-disable-next-line eslint/no-restricted-properties -- BrowserHost is a scoped browser entry point, not a Node or React runtime.
		Effect.runFork
	)
}
