import './routes/styles.css'

import {Router} from '@effect/ui'
import {BrowserHost, BrowserRouter} from '@effect/ui/html'

import {Effect, Layer, Predicate, pipe} from 'effect'

import {TripsRoute} from '#routes/(home)/-model.ts'
import {Trips} from '#routes/(home)/index.ts'

const root = document.getElementById('root')
if (Predicate.isNotNull(root)) {
	pipe(
		BrowserHost.mount(Trips, Router.props(TripsRoute), root, {head: false}),
		Layer.provide(BrowserRouter.layer({routes: TripsRoute})),
		Layer.launch,
		// oxlint-disable-next-line eslint/no-restricted-properties -- BrowserHost is the browser entry point and owns the mounted app for the page lifetime.
		Effect.runFork
	)
}
