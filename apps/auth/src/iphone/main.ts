import 'react-native/Libraries/Core/setUpXHR'
import 'react-native/Libraries/Core/setUpTimers'

import {Router} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'
import {Pressable} from '@effect/ui-native/kit'

import {Array, Effect, Function, Layer, Schema, pipe} from 'effect'

import {AtomRegistry} from 'effect/reactivity'

import type {Selection} from '@deslop/design/model'
import {Layout, ListDetail, Row, styles} from '@deslop/design/native'
import {layerSocketProtocol} from '@deslop/runtime/client/protocol'

import {layerIPhoneRouter} from '#iphone/router.ts'
import {layerIPhoneSocket, signIn, signOut} from '#iphone/session.ts'
import {Directory} from '#screens/directory.ts'
import type {Entry, Screen} from '#screens/directory.ts'
import {marks} from '#screens/marks.ts'
import {Admit, RecoverSignIn, Refresh, SignOut, StartSignIn} from '#screens/model.ts'
import {AuthReads} from '#screens/reads.ts'
import {AuthRoute} from '#screens/routes.ts'
import {AVATAR} from '#screens/rows.ts'
import type {Mark} from '#screens/rows.ts'

const Image: <M>() => Native.ViewElement<M, never, Record<string, unknown>, 'authImage'> = Function.constant(
	Native.defineView(() => new Native.ViewElement<never, never, Record<string, unknown>, 'authImage'>('authImage'), {
		viewName: 'RCTImageView'
	})
)

function MarkImage<M>(uri: string, size: number, avatar = false) {
	return Image<M>()
		.style({flexShrink: 0, height: size, width: size, ...(avatar && {position: 'absolute', top: 0, left: 0})})
		.prop('resizeMode', avatar ? 'cover' : 'contain')
		.prop('source', [{uri, width: size, height: size, scale: 1}])
}

function Cover<M>(h: Native.H<M>, mark: Mark) {
	if (mark.kind === 'device') return MarkImage<M>(marks[mark.device], 20)
	return h.view
		.style(AVATAR)
		.children(
			h.text.style(styles.title).children(mark.initial),
			mark.url !== undefined && MarkImage<M>(mark.url, 28, true)
		)
}

function Button<M>(
	h: Native.H<M>,
	element: Native.ViewElement<M, never, Native.ViewEvents, 'view'>,
	label: string,
	github = false,
	disabled = false
) {
	return Pressable(h, {element, props: {disabled, pressedStyle: {backgroundColor: '#2b2b2b'}}})
		.style({...styles.control, flexDirection: 'row', gap: 8, opacity: disabled ? 0.5 : 1})
		.prop('accessible', true)
		.prop('accessibilityRole', 'button')
		.prop('accessibilityState', {disabled})
		.children(github && MarkImage<M>(marks.github, 20), h.text.style(styles.body).children(label))
}

function Skeleton<M>(h: Native.H<M>, id: string) {
	function bar(width: Native.ViewStyle['width'], height: number, borderRadius = 4) {
		return h.view.style({backgroundColor: styles.control.backgroundColor, borderRadius, height, width})
	}
	return h.view
		.key(id)
		.style(styles.row)
		.children(
			bar(28, 28, 14),
			h.view.style({...styles.lead, gap: 6}).children(bar('58%', 12), bar('36%', 10)),
			bar(30, 8)
		)
}

function EntryView<M>(
	h: Native.H<M>,
	entry: Entry,
	retry: Screen['retry'],
	activeId?: string,
	select?: Selection['select']
) {
	if (entry.kind === 'skeleton') return Skeleton(h, entry.id)
	if (entry.kind === 'row') {
		const {mark, ...item} = entry.row
		return Row(h, {active: activeId === item.id, cover: Cover(h, mark), item, ...(select !== undefined && {select})})
	}
	return h.view
		.key(entry.text)
		.style({alignItems: 'flex-start', gap: 8, paddingHorizontal: 12, paddingVertical: 8})
		.children(
			h.text.style(styles.line).children(entry.text),
			entry.reader !== undefined &&
				Button(h, retry(retry(h.view, 'press', entry.reader), 'accessibilityTap', entry.reader), 'Retry')
		)
}

function Workspace<M>(h: Native.H<M>, screen: Screen) {
	if (screen.kind === 'directory') {
		return ListDetail(h, {
			defaultId: screen.defaultId,
			detail: Array.map(screen.detail, entry => EntryView(h, entry, screen.retry)),
			detailToolbar: screen.detailToolbar,
			list: (active, wide) => [
				...Array.map(screen.people, entry => EntryView(h, entry, screen.retry, active, screen.selection.select)),
				...(wide ? [] : Array.map(screen.accountNotes, entry => EntryView(h, entry, screen.retry)))
			],
			selection: screen.selection,
			toolbar: screen.toolbar
		})
	}
	if (screen.kind === 'sessions') {
		return ListDetail(h, {
			list: () => Array.map(screen.detail, entry => EntryView(h, entry, screen.retry)),
			selection: screen.selection,
			toolbar: screen.toolbar
		})
	}

	const center = h.view.style({...styles.frame, alignItems: 'center', gap: 8, justifyContent: 'center', padding: 20})
	if (screen.kind === 'not-found') {
		return Layout(h, {
			content: center.children(Button(h, screen.back(screen.back(h.view, 'press'), 'accessibilityTap'), 'Back to Auth'))
		})
	}
	return Layout(h, {
		content: center.children(
			screen.state === 'waiting' && h.text.style(styles.line).children('Waiting for an admin'),
			screen.state === 'sign-in' &&
				Button(
					h,
					screen.signIn(screen.signIn(h.view, 'press'), 'accessibilityTap'),
					'Continue with GitHub',
					true,
					screen.signingIn
				),
			screen.error !== undefined && h.text.style(styles.line).children(screen.error),
			...Array.map(screen.entries, entry => EntryView(h, entry, screen.retry))
		),
		toolbar: screen.toolbar.actions.length > 0 ? screen.toolbar : undefined
	})
}

const App = Native.component({
	message: Schema.Never,
	model: Schema.Null,
	name: 'Auth',
	props: Schema.Struct({route: AuthRoute})
}).make({
	init: Function.constNull,
	update: Function.constNull,
	view: h => Directory(h, {native: true, route: h.props.route}, screen => Workspace(h, screen))
})

NativeApp.register(
	pipe(
		NativeApp.mount(App, Router.props(AuthRoute)),
		Layer.provide(
			Layer.mergeAll(
				Admit.layer,
				Refresh.layer,
				Layer.provide(
					RecoverSignIn.toLayer(Effect.map(Refresh, refresh => () => refresh({reader: 'account'}))),
					Refresh.layer
				),
				StartSignIn.toLayer(() => signIn),
				SignOut.toLayer(() => Effect.asVoid(signOut)),
				Router.Back.layer
			)
		),
		Layer.provide(
			Layer.mergeAll(
				AtomRegistry.layer,
				AuthReads.layer(layerSocketProtocol(layerIPhoneSocket), Function.constVoid),
				layerIPhoneRouter
			)
		)
	)
)
