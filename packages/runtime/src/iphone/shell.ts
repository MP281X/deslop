import 'react-native/Libraries/Core/setUpXHR'

import type {Router} from '@effect/ui'

import {Effect, Layer, Option, Schema} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {Atom} from 'effect/reactivity'
import {AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, deleteItemAsync, getItemAsync, setItemAsync} from 'expo-secure-store'
import {openAuthSessionAsync} from 'expo-web-browser'
import {fetch} from 'expo/fetch'
import Linking from 'react-native/Libraries/Linking/Linking'
import WebSocket from 'react-native/Libraries/WebSocket/WebSocket'

import {iphoneRouter} from '@deslop/components/native/router'
import {iphoneOrigins} from '@deslop/runtime/shared/origins'

import {layerSocketProtocol} from '#client/protocol.ts'
import {Authenticate, OpenUrl, SignOutSession, layerShell} from '#client/shell.ts'
import {iphoneSession, isSignOutConfirmed, secureSession} from '#iphone/session.ts'
import {AuthError} from '#shared/auth.ts'

class OpenUrlError extends Schema.TaggedError<OpenUrlError>()('OpenUrlError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

// Everything an iPhone app takes from its name: its origins and scheme, the Keychain session, the router that follows `<name>://` links, and the shell's sign-in. `replace` names the routes a link replaces instead of pushing.
export function layerIPhoneShell<Routes extends Router.Routes>(options: {
	readonly name: string
	readonly replace?: (route: Routes['Type']) => boolean
	readonly route: Routes
}) {
	const origins = iphoneOrigins(options.name)
	const session = iphoneSession(
		origins,
		secureSession({deleteItemAsync, getItemAsync, setItemAsync}, AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY),
		openAuthSessionAsync,
		WebSocket
	)
	return Layer.mergeAll(
		layerShell(
			layerSocketProtocol(session.layerIPhoneSocket),
			Atom.runtime(FetchHttpClient.layer).atom(session.readIPhoneAccount(fetch)),
			false
		),
		Authenticate.toLayer(() => session.signIn),
		SignOutSession.toLayer(request =>
			Effect.mapBoth(session.signOut(fetch), {
				onFailure: cause => AuthError.make({cause, message: request.failure}),
				onSuccess: isSignOutConfirmed
			})
		),
		OpenUrl.toLayer(request =>
			Effect.ignore(
				Effect.tryPromise({
					catch: cause => OpenUrlError.make({cause, message: 'Could not open the URL'}),
					try: () => Linking.openURL(request.url)
				}),
				{log: 'Warn', message: 'Could not open the URL'}
			)
		),
		Option.match(Option.fromUndefinedOr(options.replace), {
			onNone: () => iphoneRouter(options.route, origins.appOrigin, origins.scheme),
			onSome: replace =>
				iphoneRouter(options.route, origins.appOrigin, origins.scheme, {
					replace: location => Option.exists(options.route.parse(location.url), replace)
				})
		})
	)
}
