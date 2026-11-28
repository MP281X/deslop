import 'react-native/Libraries/Core/setUpXHR'

import {Router} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {Array, Boolean, Function, HashSet, Layer, Option, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {Atom, AtomRegistry} from 'effect/reactivity'

import type {ToolbarOptions} from '@deslop/components/model'
import {Row, Toolbar, black, fold, styles} from '@deslop/components/native'
import {layerSocketProtocol} from '@deslop/runtime/client/protocol'

import {registerChapters} from '#iphone/push.ts'
import {IPhoneReader, control, image} from '#iphone/reader.ts'
import {layerIPhoneRouter} from '#iphone/router.ts'
import {readIPhoneAccount, session, signOut} from '#iphone/session.ts'
import {catalogue} from '#screens/catalogue.ts'
import {ChooseToolbar, chapterListOf, chapterRows, library, toolbar} from '#screens/library.ts'
import type {Screen} from '#screens/library.ts'
import {Message} from '#screens/model.ts'
import {CloseChapter, OpmRoute} from '#screens/routes.ts'

const PANE = {flex: 1, minHeight: 0, minWidth: 0} as const
const SHADE = '#202020'

function native<Tag extends string>(tag: Tag, viewName: string) {
	return Function.constant(
		Native.defineView(() => new Native.ViewElement<Message, never, Record<string, unknown>, Tag>(tag), {viewName})
	)
}

const Stack = native('opmStack', 'RNSScreenStack')
const Page = native('opmPage', 'RNSScreen')
const SafeArea = native('opmSafeArea', 'RNCSafeAreaView')

function skeleton(h: Native.H<Message>, index: number) {
	return h.view
		.key(`skeleton:${index}`)
		.style(styles.row)
		.children(
			h.view.style({backgroundColor: SHADE, borderRadius: 4, height: 40, width: 28}),
			h.view
				.style({...styles.lead, gap: 6})
				.children(
					h.view.style({backgroundColor: SHADE, borderRadius: 4, height: 12, width: '36%'}),
					h.view.style({backgroundColor: SHADE, borderRadius: 4, height: 10, width: '52%'})
				),
			h.view.style({backgroundColor: SHADE, borderRadius: 4, height: 10, width: 28})
		)
}

function chapterList(h: Native.H<Message>, screen: Screen, older = false) {
	const chapters = chapterListOf(screen, older)
	const hidden = !older && screen.reader !== undefined && screen.wide && screen.listHidden
	const beside = screen.wide && screen.reader !== undefined
	function content() {
		if (screen.waiting) return Array.makeBy(10, index => skeleton(h, index))
		if (chapters.empty) return h.text.style(styles.line).children('No chapters')
		// A pane starts one cover at a time, leaving the native image loader room for reader pages.
		const next = Option.getOrUndefined(
			Array.findFirst(chapters.rows, row => row.cover !== undefined && !HashSet.has(screen.covers, row.cover))
		)
		return chapterRows(
			h,
			chapters.rows,
			row =>
				h.view
					.style({
						backgroundColor: SHADE,
						borderRadius: 4,
						height: 40,
						opacity: row.coverOpacity,
						overflow: 'hidden',
						width: 28
					})
					.prop('accessibilityElementsHidden', true)
					.children(
						row.cover !== undefined &&
							(row === next || HashSet.has(screen.covers, row.cover)) &&
							image(row.cover)
								.prop('resizeMode', 'cover')
								.style({height: 40, width: 28})
								.on('load', Message.CoverSettled({src: row.cover}))
								.on('error', Message.CoverSettled({src: row.cover}))
					),
			options => Row(h, options)
		)
	}
	return h.scroll
		.key(`${screen.series}:${older}`)
		.style({
			...PANE,
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
		.prop('accessibilityLabel', chapters.label)
		.prop('accessibilityState', {busy: screen.waiting})
		.children(content())
}

function page(id: string) {
	return Page()
		.key(id)
		.prop('screenId', id)
		.prop('activityState', 2)
		.prop('statusBarStyle', 'light')
		.style({backgroundColor: black, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0})
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

const queries = catalogue(
	layerSocketProtocol(session.layerIPhoneSocket),
	Atom.runtime(FetchHttpClient.layer).atom(readIPhoneAccount)
)
const App = library(
	Native.vocabulary,
	queries,
	{registerPush: registerChapters(queries), signIn: session.signIn, signOut},
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
			if (screen.problem !== undefined) {
				return h.view
					.style({...PANE, alignItems: 'center', gap: 8, justifyContent: 'center', padding: 20})
					.children(
						h.text.style(styles.body).children(screen.problem),
						screen.signIn && !screen.busy && control(h, 'Sign in', Message.SignIn()),
						screen.retryable && control(h, 'Retry', Message.Retry()),
						screen.problem === 'Back to chapters' && control(h, 'Back to chapters', Message.Close())
					)
			}
			return h.view.style(styles.panes).children(
				SafeArea()
					.style(listStyle())
					.prop('edges', {bottom: 'additive', left: 'additive', right: 'additive', top: 'off'})
					.children(chapterList(h, screen), screen.book && reader === undefined && chapterList(h, screen, true)),
				beside && IPhoneReader(h, screen, reader)
			)
		}
		return ChooseToolbar(h, {
			onEmit: message => message,
			view: parts =>
				h.view
					.style(styles.frame)
					.on('layout', event => Message.Layout({height: event.layout.height, width: event.layout.width}))
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
										header(h, screen, beside, parts.choose).prop(
											'hidden',
											screen.problem !== undefined || (beside && !screen.bars)
										)
									),
								pushed &&
									page('reader')
										.prop('statusBarHidden', !screen.bars)
										.prop('homeIndicatorHidden', !screen.bars)
										.on('dismissed', Message.Close())
										.children(IPhoneReader(h, screen, reader), header(h, screen, true, parts.choose))
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
