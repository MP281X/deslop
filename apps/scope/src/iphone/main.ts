import 'react-native/Libraries/Core/setUpXHR'

import {Router} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {Effect, Layer, Schema, pipe} from 'effect'

import {AtomRegistry} from 'effect/reactivity'
import Linking from 'react-native/Libraries/Linking/Linking'

import {layerSocketProtocol} from '@deslop/runtime/client/protocol'

import {layerIPhoneRouter} from '#iphone/router.ts'
import {layerIPhoneSignIn, session} from '#iphone/session.ts'
import {Workspace} from '#iphone/view.ts'
import {OpenLink, Retry, ScopeReads} from '#screens/reads.ts'
import {ScopeRoute} from '#screens/routes.ts'
import {scopeApp} from '#screens/scope.ts'

const App = scopeApp<Native.Elements>(Native.component, true, Workspace)

const reads = Layer.merge(
	ScopeReads.layer(layerSocketProtocol(session.layerIPhoneSocket)),
	AtomRegistry.layerOptions({defaultIdleTTL: 400})
)
class LinkOpenError extends Schema.TaggedError<LinkOpenError>()('LinkOpenError', {cause: Schema.Defect()}) {}

const openLink = OpenLink.toLayer(args =>
	Effect.ignore(
		Effect.tryPromise({catch: cause => LinkOpenError.make({cause}), try: () => Linking.openURL(args.url)}),
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
