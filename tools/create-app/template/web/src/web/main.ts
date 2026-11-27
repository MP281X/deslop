import './styles.css'

import {Router} from '@effect/ui'
import {BrowserHost, BrowserRouter} from '@effect/ui/html'

import {Effect, Layer, Predicate, pipe} from 'effect'

import {AtomRegistry} from 'effect/reactivity'

import {App} from '#web/app/home.ts'
import {AppRoute} from '#web/routes.ts'

const root = document.getElementById('root')
if (Predicate.isNull(root)) throw new TypeError('Missing application mount element with id "root"')

pipe(
	BrowserHost.mount(App, Router.props(AppRoute), root),
	Layer.provide(BrowserRouter.layer({routes: AppRoute})),
	Layer.provide(AtomRegistry.layer),
	Layer.launch,
	// oxlint-disable-next-line eslint/no-restricted-properties -- The browser mounts one scoped Effect UI root for the lifetime of the page.
	Effect.runFork
)
