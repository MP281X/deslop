import 'react-native/Libraries/Core/setUpXHR'

import {Router} from '@effect/ui'
import type {View} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'
import {Pressable} from '@effect/ui-native/kit'

import {Boolean, Effect, Function, Layer} from 'effect'

import type {ButtonOptions, Press} from '@deslop/components/model'
import {styles} from '@deslop/components/native'
import {nativeComponents} from '@deslop/components/native/components'
import {Authenticate, SignOutSession} from '@deslop/runtime/client/shell'
import {layerIPhoneShell} from '@deslop/runtime/iphone/shell'

import {AuthApp} from '#app'
import {AuthRoute, RecoverSignIn, isHome, Refresh, ReturnTo, SignOut, StartSignIn, layerAuth} from '#reads'
import {Workspace} from '#view'
import type {AuthUi} from '#view'

import {marks} from '#identity/view.ts'
import {Mark} from '#people/screen.ts'
import {AVATAR} from '#people/view.ts'

const Image: <M>() => Native.ViewElement<M, never, Record<string, unknown>, 'authImage'> = Function.constant(
	Native.defineView(() => new Native.ViewElement<never, never, Record<string, unknown>, 'authImage'>('authImage'), {
		viewName: 'RCTImageView'
	})
)

function MarkImage<M>(uri: string, size: number, avatar = false) {
	return Image<M>()
		.style({flexShrink: 0, height: size, width: size, ...(avatar && {left: 0, position: 'absolute', top: 0})})
		.prop(
			'resizeMode',
			Boolean.match(avatar, {onFalse: Function.constant('contain'), onTrue: Function.constant('cover')})
		)
		.prop('source', [{height: size, scale: 1, uri, width: size}])
}

function Cover<M>(h: Native.H<M>, mark: Mark) {
	if (Mark.isAnyOf(['Device'])(mark)) return MarkImage<M>(marks[mark.device], 20)
	return h.view
		.style(AVATAR)
		.children(
			h.text.style(styles.title).children(mark.initial),
			mark.url !== undefined && MarkImage<M>(mark.url, 28, true)
		)
}

function Line<M>(h: Native.H<M>, text: string) {
	return h.text.style(styles.line).children(text)
}

// Auth's buttons are a little dimmer when disabled than the shared ones, and the GitHub one carries its mark.
function Control<M>(h: Native.H<M>, options: ButtonOptions, github = false) {
	const disabled = options.disabled === true
	return Pressable(h, {
		element: options.press(options.press(h.view, 'press'), 'accessibilityTap'),
		props: {disabled, pressedStyle: {backgroundColor: '#2b2b2b'}}
	})
		.style({
			...styles.control,
			flexDirection: 'row',
			gap: 8,
			opacity: Boolean.match(disabled, {onFalse: Function.constant(1), onTrue: Function.constant(0.5)})
		})
		.prop('accessible', true)
		.prop('accessibilityRole', 'button')
		.prop('accessibilityState', {disabled})
		.children(github && MarkImage<M>(marks.github, 20), h.text.style(styles.body).children(options.label))
}

function Notice<M>(h: Native.H<M>, text: string, retry?: Press) {
	return h.view
		.key(text)
		.style({alignItems: 'flex-start', gap: 8, paddingHorizontal: 12, paddingVertical: 8})
		.children(
			h.text.style(styles.line).children(text),
			retry !== undefined && Control(h, {label: 'Retry', press: retry})
		)
}

const components = nativeComponents<never>()

const drawing: AuthUi<Native.H<never>, ReturnType<typeof components.view>, View.Content<never>> = {
	...components,
	button: (h, options) => Control(h, options),
	cover: Cover,
	line: Line,
	memberList: (h, options) =>
		components.listDetail(h, {list: () => options.rows, selection: options.selection, toolbar: options.toolbar}),
	notice: Notice,
	signIn: (h, options) => Control(h, options, true)
}

const App = AuthApp(Native.vocabulary, (h, screen) => Workspace(h, screen, drawing))

// Signing in and out go through the shell's session; an expired session sends the app back to read its account, which shows the sign-in.
const layerActions = Layer.provideMerge(
	Layer.mergeAll(
		StartSignIn.toLayer(Effect.map(Authenticate, authenticate => () => authenticate({}))),
		ReturnTo.toLayer(() => Effect.void),
		SignOut.toLayer(Effect.map(SignOutSession, signOut => () => Effect.as(signOut({}), true))),
		RecoverSignIn.toLayer(Effect.map(Refresh, refresh => () => refresh({reader: 'account'})))
	),
	layerAuth
)

NativeApp.register(
	Layer.provide(
		NativeApp.mount(App, Router.props(AuthRoute)),
		Layer.provideMerge(
			layerActions,
			layerIPhoneShell({
				name: 'auth',
				replace: person => isHome(person) && person.search.person !== undefined,
				route: AuthRoute
			})
		)
	)
)
