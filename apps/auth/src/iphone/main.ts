import 'react-native/Libraries/Core/setUpXHR'
import 'react-native/Libraries/Core/setUpTimers'

import {Router} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'
import {Pressable} from '@effect/ui-native/kit'

import {Array, Boolean, Effect, Function, Layer, pipe} from 'effect'

import {AtomRegistry} from 'effect/reactivity'

import type {PaneLeaf} from '@deslop/design/model'
import {Layout, ListDetail, Row, styles} from '@deslop/design/native'
import {layerSocketProtocol} from '@deslop/runtime/client/protocol'

import {layerIPhoneRouter} from '#iphone/router.ts'
import {session, signOut} from '#iphone/session.ts'
import {Directory} from '#screens/directory.ts'
import type {Entry, Screen} from '#screens/directory.ts'
import {marks} from '#screens/marks.ts'
import {Admit, RecoverSignIn, Refresh, SignOut, StartSignIn} from '#screens/model.ts'
import {AuthReads} from '#screens/reads.ts'
import {AuthRoute} from '#screens/routes.ts'
import {AVATAR, Mark} from '#screens/rows.ts'
import {accessOptions, authApp, directoryOptions, renderEntry, rowOptions} from '#screens/view.ts'
import type {RowSelection} from '#screens/view.ts'

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

function Button<M>(
	h: Native.H<M>,
	element: Native.ViewElement<M, never, Native.ViewEvents, 'view'>,
	label: string,
	github = false,
	disabled = false
) {
	return Pressable(h, {element, props: {disabled, pressedStyle: {backgroundColor: '#2b2b2b'}}})
		.style({
			...styles.control,
			flexDirection: 'row',
			gap: 8,
			opacity: Boolean.match(disabled, {onFalse: Function.constant(1), onTrue: Function.constant(0.5)})
		})
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

function EntryView<M>(h: Native.H<M>, entry: Entry, retry: Screen['retry'], selection?: RowSelection) {
	return renderEntry(entry, {
		notice: notice =>
			h.view
				.key(notice.text)
				.style({alignItems: 'flex-start', gap: 8, paddingHorizontal: 12, paddingVertical: 8})
				.children(
					h.text.style(styles.line).children(notice.text),
					notice.retry !== undefined &&
						// fallow-ignore-next-line code-duplication -- Web and iPhone pass the same screen parts; only each host's elements differ.
						Button(h, retry(retry(h.view, 'press', notice.retry), 'accessibilityTap', notice.retry), 'Retry')
				),
		row: row => Row<M, never>(h, rowOptions(row, Cover(h, row.mark), selection)),
		skeleton: id => Skeleton(h, id)
	})
}

// fallow-ignore-next-line code-duplication -- Web and iPhone pass the same screen parts; only each host's elements differ.
function Workspace<M>(h: Native.H<M>, screen: Screen) {
	if (screen.kind === 'directory') {
		return ListDetail<M, never>(
			h,
			directoryOptions(screen, (entry, retry, selection) => EntryView(h, entry, retry, selection))
		)
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
	return Layout(
		h,
		accessOptions<PaneLeaf<Native.NoTextInput<M>>, Native.NoTextInput<M>>(screen, {
			content: children => center.children(children),
			entry: (entry, retry) => EntryView(h, entry, retry),
			error: text => h.text.style(styles.line).children(text),
			signIn: (part, label, disabled) =>
				Button(h, part(part(h.view, 'press'), 'accessibilityTap'), label, true, disabled),
			waiting: text => h.text.style(styles.line).children(text)
		})
	)
}

const App = Native.component(authApp.definition).make({
	...authApp.lifecycle,
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
				StartSignIn.toLayer(() => session.signIn),
				SignOut.toLayer(() => signOut),
				Router.Back.layer
			)
		),
		Layer.provide(
			Layer.mergeAll(
				AtomRegistry.layer,
				AuthReads.layer(layerSocketProtocol(session.layerIPhoneSocket), Function.constVoid),
				layerIPhoneRouter
			)
		)
	)
)
