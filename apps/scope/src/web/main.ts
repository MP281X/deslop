import './styles.css'

import {Router} from '@effect/ui'
import {BrowserHost, BrowserRouter} from '@effect/ui/html'

import {Effect, Layer, Predicate, pipe} from 'effect'

import {AtomRegistry} from 'effect/reactivity'

import {ScopeRoute} from '#web/routes.ts'
import {Retry} from '#web/telemetry/model.ts'
import {Scope} from '#web/telemetry/operations.ts'

const root = document.getElementById('root')
if (Predicate.isNull(root)) throw new TypeError('Missing application mount element with id "root"')

pipe(
	BrowserHost.mount(Scope, Router.props(ScopeRoute), root, {head: false}),
	Layer.provide(BrowserRouter.layer({routes: ScopeRoute})),
	Layer.provide(Retry.layer),
	Layer.provide(AtomRegistry.layerOptions({defaultIdleTTL: 400})),
	Layer.launch,
	// oxlint-disable-next-line eslint/no-restricted-properties -- The browser mounts one scoped Effect UI root for the lifetime of the page.
	Effect.runFork
)
