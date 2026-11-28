import {Router} from '@effect/ui'
import {BrowserHost, Html} from '@effect/ui/html'

import {Layer} from 'effect'

import {webComponents} from '@deslop/components/web/components'
import {mountPage} from '@deslop/components/web/page'
import {layerWebShell} from '@deslop/runtime/web/shell'

import {ItemsApp} from '#app'
import {AppRoute, layerReads} from '#reads'
import {Workspace} from '#view'

const App = ItemsApp(Html.vocabulary, (h, screen) => Workspace(h, screen, webComponents<never>()))

mountPage(AppRoute, root =>
	Layer.provide(
		BrowserHost.mount(App, Router.props(AppRoute), root),
		Layer.provideMerge(layerReads, layerWebShell('template-app'))
	)
)
