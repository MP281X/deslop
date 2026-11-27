import {Router} from '@effect/ui'
import {BrowserHost, BrowserRouter, Html} from '@effect/ui/html'

import {Effect, Function, Layer, Predicate, Schema, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'

import {DetailText, ListDetail} from '@deslop/design/web'
import {signInUrl} from '@deslop/runtime/shared/auth'
import {layerPageProtocol} from '@deslop/runtime/web/client'
import {layerWebTelemetry} from '@deslop/runtime/web/telemetry'

import {ItemsScreen, layerItems, layerViewer, sheet} from '#screens/items.ts'
import {AppRoute} from '#screens/routes.ts'

const App = Html.component({
	message: Schema.Never,
	model: Schema.Null,
	name: 'App',
	props: Schema.Struct({route: AppRoute})
}).make({
	init: Function.constNull,
	update: Function.constNull,
	view: h =>
		ItemsScreen(h, {
			props: h.props,
			view: screen => {
				if (screen.problem === undefined) {
					return ListDetail(h, {
						detail: row => DetailText(h, row.title, screen.body, row.line),
						loading: screen.loading,
						rows: screen.items,
						selection: screen.selection,
						sheet
					})
				}
				function action() {
					if (screen.signIn) return h.a.attr('href', signInUrl(location.href)).children('Continue with GitHub')
					if (screen.retryable) return screen.retry(h.button, 'click').children('Retry')
					return h.a.attr('href', AppRoute.print(AppRoute.List({}))).children('Back to list')
				}
				return h.main.style({padding: '20px'}).children(h.p.attr('role', 'status').children(screen.problem), action())
			}
		})
})

const root = document.getElementById('root')
if (Predicate.isNull(root)) throw new TypeError('Missing application mount element with id "root"')

pipe(
	BrowserHost.mount(App, Router.props(AppRoute), root),
	Layer.provide(BrowserRouter.layer({routes: AppRoute})),
	Layer.provide(Layer.merge(layerViewer(''), Layer.provide(layerItems, layerPageProtocol))),
	Layer.provide(Layer.provide(layerWebTelemetry('@deslop/template-app'), FetchHttpClient.layer)),
	Layer.launch,
	// oxlint-disable-next-line eslint/no-restricted-properties -- Mount one scoped root for the life of the document.
	Effect.runFork
)
