import './styles.css'

import {Router} from '@effect/ui'
import {BrowserHost, BrowserRouter, Html} from '@effect/ui/html'

import {Effect, Function, Layer, Predicate, Schema, pipe} from 'effect'

import {AtomRegistry} from 'effect/reactivity'

import {signInUrl} from '@deslop/runtime/shared/auth'
import {layerPageProtocol} from '@deslop/runtime/web/client'

import {Authenticate, OpenLink, Retry, ScopeReads} from '#screens/reads.ts'
import {ScopeRoute} from '#screens/routes.ts'
import {ScopeView} from '#screens/scope.ts'
import {Workspace} from '#web/view.ts'

const App = Html.component({
	message: Schema.Never,
	model: Schema.Null,
	name: 'App',
	props: Schema.Struct({route: ScopeRoute})
}).make({
	init: Function.constNull,
	update: Function.constNull,
	view: h => ScopeView(h, {...h.props, iphone: false}, screen => Workspace(h, screen))
})

const root = document.getElementById('root')
if (Predicate.isNull(root)) throw new TypeError('Missing application mount element with id "root"')

const reads = Layer.merge(ScopeReads.layer(layerPageProtocol), AtomRegistry.layerOptions({defaultIdleTTL: 400}))
const signIn = Authenticate.toLayer(() =>
	Effect.sync(() => {
		location.replace(signInUrl(location.href))
		return false
	})
)

// Scope does not trace itself.
pipe(
	BrowserHost.mount(App, Router.props(ScopeRoute), root),
	Layer.provide(Layer.provideMerge(Retry.layer, reads)),
	Layer.provide(BrowserRouter.layer({routes: ScopeRoute})),
	Layer.provide(
		Layer.merge(
			signIn,
			OpenLink.toLayer(() => Effect.void)
		)
	),
	Layer.launch,
	// oxlint-disable-next-line eslint/no-restricted-properties -- The browser owns this root for the life of the page.
	Effect.runFork
)
