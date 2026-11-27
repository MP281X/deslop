import 'react-native/Libraries/Core/setUpXHR'

import {Command, Router, UiSchema} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'
import {Pressable} from '@effect/ui-native/kit'

import {Effect, Layer, Option, Schema, pipe} from 'effect'

import {DetailText, ListDetail} from '@deslop/design/native'
import {layerSocketProtocol} from '@deslop/runtime/client/protocol'
import {AuthError} from '@deslop/runtime/shared/auth'

import {layerIPhoneRouter} from '#iphone/router.ts'
import {IPhoneSignIn, layerIPhoneSocket, readIPhoneAccount} from '#iphone/session.ts'
import {Items, ItemsView, RefreshViewer, layerViewer, readItems} from '#screens/items.ts'
import {AppRoute, CloseItem} from '#screens/routes.ts'

const Message = UiSchema.TaggedEnum({
	SignIn: {},
	SignInFailed: {error: AuthError},
	SignInFinished: {signedIn: Schema.Boolean}
})

const App = Native.component({
	message: Message,
	model: Schema.Struct({problem: Schema.Option(Schema.String)}),
	name: 'App',
	props: Schema.Struct({route: AppRoute})
}).make({
	init: () => ({problem: Option.none()}),
	update: {
		SignIn: $ =>
			$.evolve({problem: Option.none()}).run(
				pipe(
					IPhoneSignIn.make({}),
					Command.match({
						onFailure: error => Message.SignInFailed({error}),
						onSuccess: signedIn => Message.SignInFinished({signedIn})
					})
				)
			),
		SignInFailed: ($, message) => $.evolve({problem: Option.some(message.error.message)}),
		SignInFinished: ($, message) => {
			if (!message.signedIn) return $.model
			return $.run(Command.asNoop(RefreshViewer.make({})))
		}
	},
	view: (h, model) =>
		ItemsView(h, h.props, {
			list: (list, body) => ListDetail(h, {...list, detail: row => DetailText(h, row.title, body, row.line)}),
			problem: (problem, screen) => {
				function action() {
					const text = h.text.style({color: '#f4f4f4', paddingVertical: 12})
					if (screen.signIn) {
						if (h.isRunning(IPhoneSignIn)) return text.children('Signing in…')
						return Pressable(h, {
							element: h.view.on('accessibilityTap', Message.SignIn()).on('press', Message.SignIn()),
							props: {pressedStyle: {backgroundColor: '#2b2b2b'}}
						})
							.prop('accessibilityRole', 'button')
							.prop('accessible', true)
							.children(text.children('Continue with GitHub'))
					}
					if (screen.retryable) {
						return Pressable(h, {
							element: screen.retry(screen.retry(h.view, 'press'), 'accessibilityTap'),
							props: {pressedStyle: {backgroundColor: '#2b2b2b'}}
						})
							.prop('accessibilityRole', 'button')
							.prop('accessible', true)
							.children(text.children('Retry'))
					}
					return Pressable(h, {
						element: screen.list.selection.back(screen.list.selection.back(h.view, 'press'), 'accessibilityTap'),
						props: {pressedStyle: {backgroundColor: '#2b2b2b'}}
					})
						.prop('accessibilityRole', 'button')
						.prop('accessible', true)
						.children(text.children('Back to list'))
				}
				return h.view
					.style({backgroundColor: '#000', flex: 1, justifyContent: 'center', padding: 20})
					.children(h.text.style({color: '#f4f4f4'}).children(Option.getOrElse(model.problem, () => problem)), action())
			}
		})
})

const protocol = layerSocketProtocol(layerIPhoneSocket)
const layerNativeItems = Items.toLayer(() =>
	pipe(
		readItems,
		Effect.flatMap(read => read()),
		// oxlint-disable-next-line effecttsgo/strict-effect-provide -- This native query owns the lifetime of its credential-bound socket.
		Effect.provide(protocol),
		Effect.scoped
	)
)

NativeApp.register(
	pipe(
		NativeApp.mount(App, Router.props(AppRoute)),
		Layer.provide(CloseItem.layer),
		Layer.provide(layerIPhoneRouter),
		Layer.provide(Layer.mergeAll(layerViewer(readIPhoneAccount), layerNativeItems, IPhoneSignIn.layer))
	)
)
