import './styles.css'

import {Router} from '@effect/ui'
import {BrowserHost, Html} from '@effect/ui/html'

import {Effect, Layer, pipe} from 'effect'

import {AtomRegistry} from 'effect/reactivity'

import {mountPage} from '@deslop/design/web/page'
import {layerPageProtocol, pageSignIn} from '@deslop/runtime/web/client'

import {Authenticate, OpenLink, Retry, ScopeReads} from '#screens/reads.ts'
import {ScopeRoute} from '#screens/routes.ts'
import {scopeApp} from '#screens/scope.ts'
import {Workspace} from '#web/view.ts'

const App = scopeApp<Html.Elements>(Html.component, false, Workspace)

// Scope does not trace itself.
mountPage(ScopeRoute, root => {
	const reads = Layer.merge(ScopeReads.layer(layerPageProtocol), AtomRegistry.layerOptions({defaultIdleTTL: 400}))
	return pipe(
		BrowserHost.mount(App, Router.props(ScopeRoute), root),
		Layer.provide(Layer.provideMerge(Retry.layer, reads)),
		Layer.provide(
			Layer.merge(
				Authenticate.toLayer(() => pageSignIn),
				OpenLink.toLayer(() => Effect.void)
			)
		)
	)
})
