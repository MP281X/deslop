import 'react-native/Libraries/Core/setUpXHR'

import {Router} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {Effect, Layer, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {Atom, AtomRegistry} from 'effect/reactivity'
import Linking from 'react-native/Libraries/Linking/Linking'

import {layerSocketProtocol} from '@deslop/runtime/client/protocol'

import {DeployError} from '#contracts'

import {layerIPhoneRouter} from '#iphone/router.ts'
import {layerIPhoneSignIn, readIPhoneAccount, session} from '#iphone/session.ts'
import {Workspace} from '#iphone/view.ts'
import {DeployApp} from '#screens/deploy.ts'
import {DeployReads, Execute, OpenEndpoint, Refresh} from '#screens/reads.ts'
import {DeployRoute} from '#screens/routes.ts'

const App = DeployApp(Native.vocabulary, false, Workspace)

const accountAtom = Atom.runtime(FetchHttpClient.layer).atom(readIPhoneAccount)
const reads = Layer.merge(
	DeployReads.layer(layerSocketProtocol(session.layerIPhoneSocket), accountAtom),
	AtomRegistry.layer
)
const openEndpoint = OpenEndpoint.toLayer(request =>
	Effect.ignore(
		Effect.tryPromise({
			catch: cause => DeployError.make({cause, message: 'Could not open the URL'}),
			try: () => Linking.openURL(request.url)
		}),
		{log: 'Warn', message: 'Could not open the URL'}
	)
)

NativeApp.register(
	pipe(
		NativeApp.mount(App, Router.props(DeployRoute)),
		Layer.provide(pipe(Execute.layer, Layer.merge(Refresh.layer), Layer.provideMerge(reads))),
		Layer.provide(layerIPhoneRouter),
		Layer.provide(Layer.merge(layerIPhoneSignIn, openEndpoint))
	)
)
