import './styles.css'

import {Router} from '@effect/ui'
import {BrowserHost, BrowserRouter, Html} from '@effect/ui/html'

import {Effect, Function, Layer, Predicate, Schema, pipe} from 'effect'

import {AtomRegistry} from 'effect/reactivity'

import {signInUrl} from '@deslop/runtime/shared/auth'
import {accountAtom, addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'

import {DeployView} from '#screens/deploy.ts'
import {Authenticate, DeployReads, Execute, OpenEndpoint, Refresh} from '#screens/reads.ts'
import {DeployRoute} from '#screens/routes.ts'
import {Workspace} from '#web/view.ts'

const App = Html.component({
	message: Schema.Never,
	model: Schema.Null,
	name: 'App',
	props: Schema.Struct({route: DeployRoute})
}).make({
	init: Function.constNull,
	update: Function.constNull,
	view: h => DeployView(h, {...h.props, autoSignIn: true}, screen => Workspace(h, screen))
})

const root = document.getElementById('root')
if (Predicate.isNull(root)) throw new TypeError('Missing application mount element with id "root"')

addPageTelemetry('@deslop/deploy')
const reads = Layer.merge(DeployReads.layer(layerPageProtocol, accountAtom), AtomRegistry.layer)
const signIn = Authenticate.toLayer(() =>
	Effect.sync(() => {
		location.replace(signInUrl(location.href))
		return false
	})
)

pipe(
	BrowserHost.mount(App, Router.props(DeployRoute), root),
	Layer.provide(Layer.provideMerge(Layer.merge(Execute.layer, Refresh.layer), reads)),
	Layer.provide(BrowserRouter.layer({routes: DeployRoute})),
	Layer.provide(
		Layer.merge(
			signIn,
			OpenEndpoint.toLayer(() => Effect.void)
		)
	),
	Layer.launch,
	// oxlint-disable-next-line eslint/no-restricted-properties -- The browser owns this root for the life of the page.
	Effect.runFork
)
