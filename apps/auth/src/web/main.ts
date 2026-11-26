import './styles.css'

import {Router} from '@effect/ui'
import {BrowserHost, BrowserRouter} from '@effect/ui/html'

import {Effect, Layer, Predicate, pipe} from 'effect'

import {Auth} from '#web/auth/view.ts'
import {AuthRoute} from '#web/routes.ts'

const root = document.getElementById('root')
if (!Predicate.isNull(root)) {
	pipe(
		BrowserHost.mount(Auth, Router.props(AuthRoute), root),
		Layer.provide(BrowserRouter.layer({routes: AuthRoute})),
		Layer.launch,
		// oxlint-disable-next-line eslint/no-restricted-properties -- BrowserHost mounts one scoped root for the lifetime of the page.
		Effect.runFork
	)
}
