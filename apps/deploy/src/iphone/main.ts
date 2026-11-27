import 'react-native/Libraries/Core/setUpXHR'

import {Router} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {Effect, Function, Layer, Schema, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {Atom, AtomRegistry} from 'effect/reactivity'
import Linking from 'react-native/Libraries/Linking/Linking'

import {layerSocketProtocol} from '@deslop/runtime/client/protocol'

import {layerIPhoneRouter} from '#iphone/router.ts'
import {layerIPhoneSignIn, layerIPhoneSocket, readIPhoneAccount} from '#iphone/session.ts'
import {Workspace} from '#iphone/view.ts'
import {DeployView} from '#screens/deploy.ts'
import {DeployReads, Execute, OpenEndpoint, Refresh} from '#screens/reads.ts'
import {DeployRoute} from '#screens/routes.ts'

const App = Native.component({
	message: Schema.Never,
	model: Schema.Null,
	name: 'App',
	props: Schema.Struct({route: DeployRoute})
}).make({
	init: Function.constNull,
	update: Function.constNull,
	view: h => DeployView(h, {...h.props, autoSignIn: false}, screen => Workspace(h, screen))
})

const account = Atom.runtime(FetchHttpClient.layer).atom(readIPhoneAccount)
const reads = Layer.merge(DeployReads.layer(layerSocketProtocol(layerIPhoneSocket), account), AtomRegistry.layer)
const openEndpoint = OpenEndpoint.toLayer(
	() =>
		({url}) =>
			Effect.ignore(
				Effect.tryPromise(() => Linking.openURL(url)),
				{log: 'Warn', message: 'Could not open the URL'}
			)
)

NativeApp.register(
	pipe(
		NativeApp.mount(App, Router.props(DeployRoute)),
		Layer.provide(Layer.provideMerge(Layer.merge(Execute.layer, Refresh.layer), reads)),
		Layer.provide(layerIPhoneRouter),
		Layer.provide(Layer.merge(layerIPhoneSignIn, openEndpoint))
	)
)
