import './routes/styles.css'

import {Router} from '@effect/ui'
import {BrowserHost, BrowserRouter} from '@effect/ui/html'

import {Effect, Layer, pipe} from 'effect'

import {DeployRoute} from '#routes/(home)/-model.ts'
import {Deploy} from '#routes/(home)/index.ts'

const root = document.getElementById('root')
if (root !== null) {
	pipe(
		BrowserHost.mount(Deploy, Router.props(DeployRoute), root, {head: false}),
		Layer.provide(BrowserRouter.layer({routes: DeployRoute})),
		Layer.launch,
		// oxlint-disable-next-line eslint/no-restricted-properties -- BrowserHost is the browser entry point and owns the mounted app for the page lifetime.
		Effect.runFork
	)
}
