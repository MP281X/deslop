import 'react-native/Libraries/Core/setUpXHR'

import {Router} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {Function, Layer, Schema, String, pipe} from 'effect'

import {Socket} from 'effect/socket'

import {DetailText, ListDetail} from '@deslop/design/native'
import {layerSocketProtocol} from '@deslop/runtime/client/protocol'
import {RPC_PATH} from '@deslop/runtime/shared/schema'

import {appOrigin} from '#iphone/origin.ts'
import {layerIPhoneRouter} from '#iphone/router.ts'
import {ItemsScreen, layerItems, layerViewer, sheet} from '#screens/items.ts'
import {AppRoute} from '#screens/routes.ts'

const App = Native.component({
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
					const text = h.text.style({color: '#f4f4f4', paddingVertical: 12})
					if (screen.retryable) return screen.retry(text, 'press').children('Retry')
					return screen.selection.back(text, 'press').children('Back to list')
				}
				return h.view
					.style({backgroundColor: '#000', flex: 1, justifyContent: 'center', padding: 20})
					.children(h.text.style({color: '#f4f4f4'}).children(screen.problem), action())
			}
		})
})

const socketUrl = `${String.replace(/^http/u, 'ws')(appOrigin)}${RPC_PATH}`
const protocol = layerSocketProtocol(
	Layer.provide(Socket.layerWebSocket(socketUrl), Socket.layerWebSocketConstructorGlobal)
)

NativeApp.register(
	pipe(
		NativeApp.mount(App, Router.props(AppRoute)),
		Layer.provide(layerIPhoneRouter),
		Layer.provide(Layer.merge(layerViewer(appOrigin), Layer.provide(layerItems, protocol)))
	)
)
