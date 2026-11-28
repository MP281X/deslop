import 'react-native/Libraries/Core/setUpXHR'

import {Router} from '@effect/ui'
import type {View} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {Effect, Layer, Option, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {Atom, AtomRegistry} from 'effect/reactivity'
import {AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, deleteItemAsync, getItemAsync, setItemAsync} from 'expo-secure-store'
import {openAuthSessionAsync} from 'expo-web-browser'
import {fetch} from 'expo/fetch'
import Linking from 'react-native/Libraries/Linking/Linking'
import WebSocket from 'react-native/Libraries/WebSocket/WebSocket'

import type {PaneLeaf, Press} from '@deslop/components/model'
import {status, styles} from '@deslop/components/native'
import {nativeComponents} from '@deslop/components/native/components'
import {iphoneRouter} from '@deslop/components/native/router'
import {layerSocketProtocol} from '@deslop/runtime/client/protocol'
import {iphoneSession, secureSession} from '@deslop/runtime/iphone/session'

import {DeployApp} from '#app'
import {Authenticate, DeployReads, DeployRoute, Execute, OpenEndpoint, Refresh, isDetail} from '#reads'
import {Workspace} from '#view'

import {appOrigin, authOrigin, scheme} from './origin.ts'

import type {DeployUi, Exposure} from '#exposures/view.ts'
import {DeployError} from '#machine/contract.ts'

function Site<M>(h: Native.H<M>, site: Exposure, open: (url: string) => Press) {
	const components = nativeComponents<M>()
	return h.view
		.key(site.id)
		.style(styles.titleLine)
		.children(
			site.status !== undefined && h.view.style({...styles.dot, backgroundColor: status[site.status]}),
			Option.match(Option.fromUndefinedOr(site.url), {
				onNone: () => h.text.style(styles.body).children(site.label),
				onSome: url => components.button(h, {label: site.label, press: open(url)})
			}),
			site.line !== undefined && h.text.style({...styles.line, flexShrink: 1}).children(site.line)
		)
}

const drawing: DeployUi<Native.H<never>, PaneLeaf<Native.NoTextInput<never>>, View.Content<never>> = {
	...nativeComponents<never>(),
	site: Site
}

const App = DeployApp(Native.vocabulary, false, (h, screen) => Workspace(h, screen, drawing))

const session = iphoneSession(
	{appOrigin, authOrigin, scheme},
	secureSession({deleteItemAsync, getItemAsync, setItemAsync}, AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY),
	openAuthSessionAsync,
	WebSocket
)

const readIPhoneAccount = session.readIPhoneAccount(fetch)

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

const layerIPhoneRouter = iphoneRouter(DeployRoute, appOrigin, scheme, {
	replace: location => Option.exists(DeployRoute.parse(location.url), isDetail)
})

const layerIPhoneSignIn = Authenticate.toLayer(() => session.signIn)

NativeApp.register(
	pipe(
		NativeApp.mount(App, Router.props(DeployRoute)),
		Layer.provide(pipe(Execute.layer, Layer.merge(Refresh.layer), Layer.provideMerge(reads))),
		Layer.provide(layerIPhoneRouter),
		Layer.provide(Layer.merge(layerIPhoneSignIn, openEndpoint))
	)
)
