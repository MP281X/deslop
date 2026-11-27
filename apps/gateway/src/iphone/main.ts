import 'react-native/Libraries/Core/setUpXHR'

import {Router} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {Boolean, Effect, Function, Layer, Schema, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {Atom, AtomRegistry} from 'effect/reactivity'
import Clipboard from 'react-native/Libraries/Components/Clipboard/Clipboard'
import Linking from 'react-native/Libraries/Linking/Linking'

import {layerSocketProtocol} from '@deslop/runtime/client/protocol'
import {AuthError} from '@deslop/runtime/shared/auth'

import {appOrigin} from '#iphone/origin.ts'
import {layerIPhoneRouter} from '#iphone/router.ts'
import {readIPhoneAccount, session, signOutIPhone} from '#iphone/session.ts'
import {Workspace} from '#iphone/view.ts'
import {Platform, layerActions} from '#screens/actions.ts'
import {GatewayView} from '#screens/gateway.ts'
import {GatewayReads} from '#screens/reads.ts'
import {GatewayRoute} from '#screens/routes.ts'

const App = Native.component({
	message: Schema.Never,
	model: Schema.Null,
	name: 'GatewayIPhone',
	props: Schema.Struct({route: GatewayRoute})
}).make({
	init: Function.constNull,
	update: Function.constNull,
	view: h => GatewayView(h, {...h.props, autoSignIn: false}, screen => Workspace(h, screen))
})

const platform = Layer.succeed(Platform, {
	authenticate: signOut =>
		Boolean.match(signOut, {
			onFalse: () => Effect.map(session.signIn, changed => ({changed, problem: undefined})),
			onTrue: Function.constant(signOutIPhone)
		}),
	copy: Effect.try({
		catch: cause => AuthError.make({cause, message: 'Couldn’t copy MCP URL'}),
		try: () => Clipboard.setString(`${appOrigin}/mcp`)
	}),
	open: path =>
		Effect.asVoid(
			Effect.tryPromise({
				catch: cause => AuthError.make({cause, message: 'Could not open the server’s authorization page'}),
				try: () => Linking.openURL(`${appOrigin}${path}`)
			})
		)
})

const accountAtom = Atom.runtime(FetchHttpClient.layer).atom(readIPhoneAccount)
const reads = GatewayReads.layer(layerSocketProtocol(session.layerIPhoneSocket), accountAtom)

NativeApp.register(
	pipe(
		NativeApp.mount(App, Router.props(GatewayRoute)),
		Layer.provide(layerActions),
		Layer.provide(Layer.mergeAll(platform, reads, AtomRegistry.layer)),
		Layer.provide(layerIPhoneRouter)
	)
)
