import {Router} from '@effect/ui'
import {BrowserHost, BrowserRouter, Html} from '@effect/ui/html'

import {Effect, Layer, Predicate, Schema, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'

import {DetailText, ListDetail} from '@deslop/design/web'
import {signInUrl} from '@deslop/runtime/shared/auth'
import {layerPageProtocol} from '@deslop/runtime/web/client'
import {layerWebTelemetry} from '@deslop/runtime/web/telemetry'

import {ItemsScreen, layerItems, layerViewer, sheet} from '#screens/items.ts'
import {AppRoute} from '#screens/routes.ts'

const App = Html.component({
	name: 'App',
	props: Schema.Struct({route: AppRoute}),
	model: Schema.Null,
	message: Schema.Never
}).make({
	init: () => null,
	update: () => null,
	view: h =>
		ItemsScreen(h, {
			props: h.props,
			view: ({items, body, loading, problem, retry, retryable, selection, signIn}) =>
				problem === undefined
					? ListDetail(h, {
							rows: items,
							loading,
							selection,
							sheet,
							detail: row => DetailText(h, row.title, body, row.line)
						})
					: h.main
							.style({padding: '20px'})
							.children(
								h.p.attr('role', 'status').children(problem),
								signIn
									? h.a.attr('href', signInUrl(location.href)).children('Continue with GitHub')
									: retryable
										? retry(h.button, 'click').children('Retry')
										: h.a.attr('href', AppRoute.print(AppRoute.List({}))).children('Back to list')
							)
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
