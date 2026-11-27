import 'react-native/Libraries/Core/setUpXHR'

import {Router} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {Layer, Schema, String} from 'effect'

import {Socket} from 'effect/socket'

import {DetailText, ListDetail} from '@deslop/design/native'
import {layerSocketProtocol} from '@deslop/runtime/client/protocol'
import {RPC_PATH} from '@deslop/runtime/shared/schema'

import {appOrigin} from '#iphone/origin.ts'
import {layerIPhoneRouter} from '#iphone/router.ts'
import {ItemsScreen, layerItems, layerViewer, sheet} from '#screens/items.ts'
import {AppRoute} from '#screens/routes.ts'

const App = Native.component({
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
			view: ({items, body, loading, problem, retry, retryable, selection}) =>
				problem === undefined
					? ListDetail(h, {
							rows: items,
							loading,
							selection,
							sheet,
							detail: row => DetailText(h, row.title, body, row.line)
						})
					: h.view
							.style({flex: 1, justifyContent: 'center', backgroundColor: '#000', padding: 20})
							.children(
								h.text.style({color: '#f4f4f4'}).children(problem),
								retryable
									? retry(h.text, 'press').style({color: '#f4f4f4', paddingVertical: 12}).children('Retry')
									: selection
											.back(h.text, 'press')
											.style({color: '#f4f4f4', paddingVertical: 12})
											.children('Back to list')
							)
		})
})

const socketUrl = `${String.replace(/^http/u, 'ws')(appOrigin)}${RPC_PATH}`
const protocol = layerSocketProtocol(
	Layer.provide(Socket.layerWebSocket(socketUrl), Socket.layerWebSocketConstructorGlobal)
)

NativeApp.register(
	NativeApp.mount(App, Router.props(AppRoute)).pipe(
		Layer.provide(layerIPhoneRouter),
		Layer.provide(Layer.merge(layerViewer(appOrigin), Layer.provide(layerItems, protocol)))
	)
)
