import 'react-native/Libraries/Core/setUpXHR'

import {Router} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {Array, Boolean, Function, Layer, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {Atom, AtomRegistry} from 'effect/reactivity'

import type {ToolbarOptions} from '@deslop/design/model'
import {Row, Toolbar, black, fold, styles} from '@deslop/design/native'
import {layerSocketProtocol} from '@deslop/runtime/client/protocol'

import {registerChapters} from '#iphone/push.ts'
import {Reader, control, image} from '#iphone/reader.ts'
import {layerIPhoneRouter} from '#iphone/router.ts'
import {layerIPhoneSocket, readIPhoneAccount, signIn, signOut} from '#iphone/session.ts'
import {catalogue} from '#screens/catalogue.ts'
import {ChooseChapter, ChooseToolbar, library, toolbar} from '#screens/library.ts'
import type {Screen} from '#screens/library.ts'
import {Message} from '#screens/model.ts'
import {CloseChapter, OpmRoute} from '#screens/routes.ts'

function native<Tag extends string>(tag: Tag, viewName: string) {
	return Function.constant(
		Native.defineView(() => new Native.ViewElement<Message, never, Record<string, unknown>, Tag>(tag), {viewName})
	)
}

const Stack = native('opmStack', 'RNSScreenStack')
const Page = native('opmPage', 'RNSScreen')
const SafeArea = native('opmSafeArea', 'RNCSafeAreaView')
const pane = {flex: 1, minWidth: 0, minHeight: 0} as const
const shade = '#202020'

function skeleton(h: Native.H<Message>, index: number) {
	return h.view
		.key(`skeleton:${index}`)
		.style(styles.row)
		.children(
			h.view.style({backgroundColor: shade, borderRadius: 4, width: 28, height: 40}),
			h.view
				.style({...styles.lead, gap: 6})
				.children(
					h.view.style({backgroundColor: shade, borderRadius: 4, width: '36%', height: 12}),
					h.view.style({backgroundColor: shade, borderRadius: 4, width: '52%', height: 10})
				),
			h.view.style({backgroundColor: shade, borderRadius: 4, width: 28, height: 10})
		)
}

function chapterList(h: Native.H<Message>, screen: Screen, older = false) {
	const rows = Boolean.match(older, {onFalse: () => screen.rows, onTrue: () => screen.older})
	const hidden = !older && screen.reader !== undefined && screen.wide && screen.listHidden
	const beside = screen.wide && screen.reader !== undefined
	function content() {
		if (screen.waiting) return Array.makeBy(10, index => skeleton(h, index))
		if (rows.length === 0 && !older) return h.text.style(styles.line).children('No chapters')
		return Array.map(rows, row =>
			ChooseChapter(h, {
				key: row.data.id,
				props: {chapter: row.chapter},
				onEmit: message => message,
				view: ({select}) =>
					Row(h, {
						active: row.active,
						cover: h.view
							.style({
								backgroundColor: shade,
								borderRadius: 4,
								width: 28,
								height: 40,
								overflow: 'hidden',
								opacity: Boolean.match(row.muted, {onFalse: Function.constant(1), onTrue: Function.constant(0.45)})
							})
							.prop('accessibilityElementsHidden', true)
							.children(
								row.cover !== undefined && image(row.cover).prop('resizeMode', 'cover').style({width: 28, height: 40})
							),
						item: row.data,
						muted: row.muted,
						select
					})
			})
		)
	}
	return h.scroll
		.key(`${screen.series}:${older}`)
		.style({
			...pane,
			...(!older && (beside || screen.book) && {borderRightColor: fold, borderRightWidth: 1}),
			...(hidden && {display: 'none' as const})
		})
		.contentContainerStyle({
			...styles.rows,
			paddingRight: Boolean.match(screen.wide, {onFalse: Function.constant(76), onTrue: Function.constant(8)}),
			...(beside && {
				paddingTop: Boolean.match(screen.bars, {onFalse: Function.constant(8), onTrue: Function.constant(52)})
			})
		})
		.prop('contentInsetAdjustmentBehavior', 'never')
		.prop(
			'accessibilityLabel',
			Boolean.match(older, {onFalse: Function.constant('Chapters'), onTrue: Function.constant('Older chapters')})
		)
		.prop('accessibilityState', {busy: screen.waiting})
		.children(content())
}

function page(id: string) {
	return Page()
		.key(id)
		.prop('screenId', id)
		.prop('activityState', 2)
		.prop('statusBarStyle', 'light')
		.style({position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: black})
}

function header(h: Native.H<Message>, screen: Screen, reader: boolean, choose: ToolbarOptions['choose']) {
	const actions = toolbar(screen, true)
	return Toolbar(h, {
		actions: Boolean.match(reader, {
			onFalse: () =>
				Array.filter(actions, action => action.id === 'series' || action.id === 'retry' || action.id === 'sign-out'),
			onTrue: () => actions
		}),
		choose
	})
		.prop('hidden', reader && !screen.bars)
		.prop('hideBackButton', true)
		.prop('translucent', reader)
		.prop(
			'backgroundColor',
			Boolean.match(reader, {onFalse: Function.constant(black), onTrue: Function.constant('transparent')})
		)
}

function problem(h: Native.H<Message>, screen: Screen) {
	return h.view
		.style({...pane, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20})
		.children(
			h.text.style(styles.body).children(screen.problem),
			screen.signIn && !screen.busy && control(h, 'Sign in', Message.SignIn()),
			screen.retryable && control(h, 'Retry', Message.Retry()),
			screen.problem === 'Back to chapters' && control(h, 'Back to chapters', Message.Close())
		)
}

const queries = catalogue(
	layerSocketProtocol(layerIPhoneSocket),
	Atom.runtime(FetchHttpClient.layer).atom(readIPhoneAccount)
)
const App = library(
	Native.vocabulary,
	queries,
	{registerPush: registerChapters(queries), signIn, signOut},
	(h, screen) => {
		const reader = screen.reader
		const beside = reader !== undefined && screen.wide && screen.problem === undefined
		const pushed = reader !== undefined && !screen.wide && screen.problem === undefined
		function listStyle() {
			if (!beside) return styles.panes
			if (screen.listHidden) return {display: 'none' as const}
			return {width: screen.listWidth}
		}
		function listContent() {
			if (screen.problem !== undefined) return problem(h, screen)
			return h.view.style(styles.panes).children(
				SafeArea()
					.style(listStyle())
					.prop('edges', {bottom: 'additive', left: 'additive', right: 'additive', top: 'off'})
					.children(chapterList(h, screen), screen.book && reader === undefined && chapterList(h, screen, true)),
				beside && Reader(h, screen, reader)
			)
		}
		return ChooseToolbar(h, {
			onEmit: message => message,
			view: ({choose}) =>
				h.view
					.style(styles.frame)
					.on('layout', ({layout}) => Message.Layout({height: layout.height, width: layout.width}))
					.children(
						Stack()
							.style(styles.frame)
							.prop('nativeContainerBackgroundColor', black)
							.children(
								page('list')
									.prop('statusBarHidden', beside && !screen.bars)
									.prop('homeIndicatorHidden', beside && !screen.bars)
									.children(
										listContent(),
										header(h, screen, beside, choose).prop(
											'hidden',
											screen.problem !== undefined || (beside && !screen.bars)
										)
									),
								pushed &&
									page('reader')
										.prop('statusBarHidden', !screen.bars)
										.prop('homeIndicatorHidden', !screen.bars)
										.on('dismissed', Message.Close())
										.children(Reader(h, screen, reader), header(h, screen, true, choose))
							)
					)
		})
	}
)

NativeApp.register(
	pipe(
		NativeApp.mount(App, Router.props(OpmRoute)),
		Layer.provide(CloseChapter.layer),
		Layer.provide(layerIPhoneRouter),
		Layer.provide(AtomRegistry.layer)
	)
)
