import 'react-native/Libraries/Core/setUpXHR'

import {Router} from '@effect/ui'
import type {View} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'
import {Pan, Pressable} from '@effect/ui-native/kit'

import {Array, Boolean, Effect, Function, Layer, Number, Option, Queue, Schema, Stream} from 'effect'

import type {NativeModule} from 'expo'
import {requireNativeModule} from 'expo'

import type {PaneLeaf, ToolbarOptions} from '@deslop/components/model'
import {Toolbar, black, fold, native, styles} from '@deslop/components/native'
import {nativeComponents} from '@deslop/components/native/components'
import {SignOut, SignOutSession} from '@deslop/runtime/client/shell'
import {layerIPhoneShell} from '@deslop/runtime/iphone/shell'

import {OpmApp} from '#app'
import type {OpmScreen} from '#app'
import {ChapterTokens, OpmRoute, layerOpm, targetOf} from '#reads'
import {Workspace} from '#view'
import type {OpmUi} from '#view'

import {ChapterNumberFromString, Series} from '#chapters/contract.ts'
import {ChapterPushError} from '#push/contract.ts'
import {variant} from '#push/shared.ts'

const PANE = {flex: 1, minHeight: 0, minWidth: 0} as const
const SHADE = '#202020'
const ALIGNMENT = {left: 'flex-end', right: 'flex-start', single: 'center'} as const

const Stack = native('opmStack', 'RNSScreenStack')
const Page = native('opmPage', 'RNSScreen')
const SafeArea = native('opmSafeArea', 'RNCSafeAreaView')
const NativeImage = native('opmImage', 'RCTImageView')

declare class ChapterActivities extends NativeModule<{chapterStartToken: (event: {readonly value: string}) => void}> {
	opened(url: string): PromiseLike<void>
}

const activity = requireNativeModule<ChapterActivities>('ChapterActivities')

// A chapter's Live Activity is dismissed once the chapter it announced is opened.
function dismissActivity(url: string) {
	return Effect.ignore(
		Effect.tryPromise({
			catch: cause => ChapterPushError.make({cause, message: 'The chapter Live Activity could not be dismissed.'}),
			try: () => activity.opened(url)
		}),
		{log: 'Warn'}
	)
}

const tokens = Stream.callback<string>(queue =>
	Effect.acquireRelease(
		Effect.sync(() =>
			activity.addListener('chapterStartToken', token => {
				Queue.offerUnsafe(queue, token.value)
			})
		),
		listener => Effect.sync(() => listener.remove())
	)
)

type ChapterActivityLink = typeof ChapterActivityLink.Type
const ChapterActivityLink = Schema.TemplateLiteralParser([
	variant.scheme,
	'://chapter/',
	Series,
	'/',
	ChapterNumberFromString
])

// A Live Activity's link opens its chapter, and dismisses the activity.
function chapterLink(url: string) {
	return Option.map(Schema.decodeUnknownOption(ChapterActivityLink)(url), parts => ({
		followed: dismissActivity(url),
		path: OpmRoute.print(OpmRoute.Library({params: {}, search: {chapter: parts[4], series: parts[2]}}))
	}))
}

function image(src: string) {
	return NativeImage<never>()
		.prop('source', [{uri: src}])
		.prop('pointerEvents', 'none')
}

const components = nativeComponents<never>()

function skeleton(h: Native.H<never>, index: number) {
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

function pane(id: string) {
	return Page<never>()
		.key(id)
		.prop('screenId', id)
		.prop('activityState', 2)
		.prop('statusBarStyle', 'light')
		.style({backgroundColor: black, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0})
}

function header(h: Native.H<never>, screen: OpmScreen, reader: boolean, toolbar: ToolbarOptions) {
	return Toolbar(h, {
		actions: Boolean.match(reader, {
			onFalse: () =>
				Array.filter(
					toolbar.actions,
					action => action.id === 'series' || action.id === 'retry' || action.id === 'sign-out'
				),
			onTrue: () => toolbar.actions
		}),
		choose: toolbar.choose
	})
		.prop('hidden', reader && !screen.bars)
		.prop('hideBackButton', true)
		.prop('translucent', reader)
		.prop(
			'backgroundColor',
			Boolean.match(reader, {onFalse: Function.constant(black), onTrue: Function.constant('transparent')})
		)
}

const edge = Boolean.match({onFalse: Function.constant(0), onTrue: Function.constant('50%' as const)})

function PageImage(
	h: Native.H<never>,
	screen: OpmScreen,
	page: OpmScreen['pages'][number],
	size: {height: number; width: number}
) {
	if (page.failed) {
		return (
			page.visible &&
			components.button(h, {label: 'Reload page', press: (el, event) => screen.retryPage(el, event, page.src)})
		)
	}
	return screen
		.shape(screen.shape(image(page.src), 'error', page.src), 'load', page.src)
		.prop('accessible', page.visible)
		.prop('accessibilityLabel', `Page ${page.index + 1}`)
		.prop('resizeMode', 'contain')
		.style(size)
}

function Reader(h: Native.H<never>, screen: OpmScreen, reader: NonNullable<OpmScreen['reader']>) {
	const active = Array.filter(screen.pages, page => page.visible)
	const spread = active.length === 2
	const available = Boolean.match(screen.wide && !screen.listHidden, {
		onFalse: () => screen.width,
		onTrue: () => screen.width - screen.listWidth
	})
	const half = Number.max(0, (available - 1) / 2)
	// The taller page sets the shared height only if both pages fit inside the two halves.
	const height = Boolean.match(spread, {
		onFalse: () => screen.height,
		onTrue: () => Array.reduce(active, screen.height, (limit, page) => Number.min(limit, half / page.aspect))
	})
	function pending() {
		if (reader.ready) return undefined
		if (!reader.waiting) return h.text.style(styles.line).children('Chapter unavailable')
		return h.view
			.style({backgroundColor: '#202020', height: '100%', width: Number.min(available, screen.height * 0.71)})
			.prop('accessible', true)
			.prop('accessibilityState', {busy: true})
			.prop('accessibilityLabel', 'Loading chapter')
	}
	return screen.selection
		.back(
			Pan(h, {
				element: screen.gesture(Pressable(h, {element: screen.gesture(h.view, 'press')}), 'panEnd'),
				props: {axis: 'x', threshold: 8}
			}),
			'accessibilityEscape'
		)
		.key(reader.id)
		.style({...styles.pane, alignItems: 'center', justifyContent: 'center', overflow: 'hidden'})
		.prop('accessibilityLabel', reader.title)
		.children(
			pending(),
			Array.map(screen.pages, page => {
				const width = Boolean.match(spread && page.visible, {
					onFalse: () => available,
					onTrue: () => Number.min(half, height * page.aspect)
				})
				return h.view
					.key(`${page.index}`)
					.style({
						alignItems: ALIGNMENT[page.side],
						bottom: 0,
						justifyContent: 'center',
						left: edge(page.side === 'right'),
						opacity: Boolean.match(page.visible, {onFalse: Function.constant(0), onTrue: Function.constant(1)}),
						position: 'absolute',
						right: edge(page.side === 'left'),
						top: 0,
						...(spread &&
							page.visible && {
								marginLeft: Boolean.match(page.side === 'right', {
									onFalse: Function.constant(0),
									onTrue: Function.constant(0.5)
								}),
								marginRight: Boolean.match(page.side === 'left', {
									onFalse: Function.constant(0),
									onTrue: Function.constant(0.5)
								})
							})
					})
					.prop('accessibilityElementsHidden', !page.visible)
					.prop(
						'pointerEvents',
						Boolean.match(page.visible, {onFalse: Function.constant('none'), onTrue: Function.constant('box-none')})
					)
					.children(PageImage(h, screen, page, {height, width}))
			})
		)
}

const drawing: OpmUi<Native.H<never>, PaneLeaf<Native.NoTextInput<never>>, View.Content<never>> = {
	...components,
	chapters: (h, screen, options, content) => {
		const hidden = !options.older && screen.reader !== undefined && screen.wide && screen.listHidden
		const beside = screen.wide && screen.reader !== undefined
		return h.scroll
			.key(`${screen.series}:${options.older}`)
			.style({
				...PANE,
				...(!options.older && (beside || screen.book) && {borderRightColor: fold, borderRightWidth: 1}),
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
			.prop('accessibilityLabel', options.label)
			.prop('accessibilityState', {busy: screen.waiting})
			.children(content)
	},
	cover: (h, screen, row) =>
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
					row.loadCover &&
					screen
						.settle(screen.settle(image(row.cover), 'load', row.cover), 'error', row.cover)
						.prop('resizeMode', 'cover')
						.style({height: 40, width: 28})
			),
	leave: (h, label, press) => components.button(h, {label, press}),
	loading: h => Array.makeBy(10, index => skeleton(h, index)),
	native: true,
	note: (h, text) => h.text.style(styles.line).children(text),
	problem: (h, text, actions) =>
		h.view
			.style({...PANE, alignItems: 'center', gap: 8, justifyContent: 'center', padding: 20})
			.children(h.text.style(styles.body).children(text), actions),
	reader: Reader,
	retry: (h, label, press) => components.button(h, {label, press}),
	signIn: (h, label, press) => components.button(h, {label, press}),
	stage: (h, screen, parts) => {
		const reader = parts.panes?.reader
		const beside = screen.reader !== undefined && screen.wide && parts.problem === undefined
		const pushed = screen.reader !== undefined && !screen.wide && parts.problem === undefined
		function listStyle() {
			if (!beside) return styles.panes
			if (screen.listHidden) return {display: 'none' as const}
			return {width: screen.listWidth}
		}
		function listContent() {
			if (parts.problem !== undefined) return parts.problem
			return h.view
				.style(styles.panes)
				.children(
					SafeArea<never>()
						.style(listStyle())
						.prop('edges', {bottom: 'additive', left: 'additive', right: 'additive', top: 'off'})
						.children(parts.panes?.latest, parts.panes?.older),
					beside && reader
				)
		}
		return screen
			.resize(h.view, 'layout')
			.style(styles.frame)
			.children(
				Stack<never>()
					.style(styles.frame)
					.prop('nativeContainerBackgroundColor', black)
					.children(
						pane('list')
							.prop('statusBarHidden', beside && !screen.bars)
							.prop('homeIndicatorHidden', beside && !screen.bars)
							.children(
								listContent(),
								header(h, screen, beside, parts.toolbar).prop(
									'hidden',
									parts.problem !== undefined || (beside && !screen.bars)
								)
							),
						pushed &&
							screen.selection
								.back(pane('reader'), 'dismissed')
								.prop('statusBarHidden', !screen.bars)
								.prop('homeIndicatorHidden', !screen.bars)
								.children(reader, header(h, screen, true, parts.toolbar))
					)
			)
	}
}

const App = OpmApp(Native.vocabulary, (h, screen) => Workspace(h, screen, drawing))

// The iPhone reports its push-to-start tokens, and asks Auth itself to end the shared session.
const layerActions = Layer.mergeAll(
	Layer.succeed(ChapterTokens, tokens),
	SignOut.toLayer(Effect.map(SignOutSession, signOut => () => signOut({failure: 'Could not clear the session'})))
)

const layerShell = layerIPhoneShell({
	link: chapterLink,
	linkScheme: variant.scheme,
	name: 'opm',
	replace: route => targetOf(route) !== undefined,
	route: OpmRoute
})

NativeApp.register(
	Layer.provide(
		NativeApp.mount(App, Router.props(OpmRoute)),
		Layer.provideMerge(layerOpm, Layer.provideMerge(layerActions, layerShell))
	)
)
