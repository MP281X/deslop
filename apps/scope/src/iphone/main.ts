import 'react-native/Libraries/Core/setUpXHR'

import {Router} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {Effect, Function, Layer, Schema, pipe} from 'effect'

import {AtomRegistry} from 'effect/reactivity'
import Linking from 'react-native/Libraries/Linking/Linking'

import {layerSocketProtocol} from '@deslop/runtime/client/protocol'

import {layerIPhoneRouter} from '#iphone/router.ts'
import {layerIPhoneSignIn, layerIPhoneSocket} from '#iphone/session.ts'
import {Workspace} from '#iphone/view.ts'
import {OpenLink, Retry, ScopeReads} from '#screens/reads.ts'
import {ScopeRoute} from '#screens/routes.ts'
import {ScopeView} from '#screens/scope.ts'

const App = Native.component({
	message: Schema.Never,
	model: Schema.Null,
	name: 'App',
	props: Schema.Struct({route: ScopeRoute})
}).make({
	init: Function.constNull,
	update: Function.constNull,
	view: h => ScopeView(h, {...h.props, iphone: true}, screen => Workspace(h, screen))
})

const reads = Layer.merge(
	ScopeReads.layer(layerSocketProtocol(layerIPhoneSocket)),
	AtomRegistry.layerOptions({defaultIdleTTL: 400})
)
const openLink = OpenLink.toLayer(
	() =>
		({url}) =>
			Effect.ignore(
				Effect.tryPromise(() => Linking.openURL(url)),
				{log: 'Warn', message: 'Could not open the URL'}
			)
)

NativeApp.register(
	pipe(
		NativeApp.mount(App, Router.props(ScopeRoute)),
		Layer.provide(Layer.provideMerge(Retry.layer, reads)),
		Layer.provide(layerIPhoneRouter),
		Layer.provide(Layer.merge(layerIPhoneSignIn, openLink))
	)
)
