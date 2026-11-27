import './styles.css'

import {Router} from '@effect/ui'
import {BrowserHost, Html} from '@effect/ui/html'

import {Effect, Layer, pipe} from 'effect'

import {AtomRegistry} from 'effect/reactivity'

import {mountPage} from '@deslop/design/web/page'
import {accountAtom, addPageTelemetry, layerPageProtocol, pageSignIn} from '@deslop/runtime/web/client'

import {DeployApp} from '#screens/deploy.ts'
import {Authenticate, DeployReads, Execute, OpenEndpoint, Refresh} from '#screens/reads.ts'
import {DeployRoute} from '#screens/routes.ts'
import {Workspace} from '#web/view.ts'

const App = DeployApp(Html.vocabulary, true, Workspace)

mountPage(DeployRoute, root => {
	addPageTelemetry('@deslop/deploy')
	const reads = Layer.merge(DeployReads.layer(layerPageProtocol, accountAtom), AtomRegistry.layer)
	return pipe(
		BrowserHost.mount(App, Router.props(DeployRoute), root),
		Layer.provide(pipe(Execute.layer, Layer.merge(Refresh.layer), Layer.provideMerge(reads))),
		Layer.provide(
			Layer.merge(
				Authenticate.toLayer(() => pageSignIn),
				OpenEndpoint.toLayer(() => Effect.void)
			)
		)
	)
})
