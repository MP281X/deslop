import 'react-native/Libraries/Core/setUpXHR'

import {Command, Router, UiSchema} from '@effect/ui'
import type {View} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'
import {Pressable} from '@effect/ui-native/kit'
import type {Markdown} from '@effect/ui/html'

import {
	Array,
	Boolean,
	Effect,
	Function,
	Layer,
	Match,
	Number,
	Option,
	Queue,
	Result,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {SecureRandom} from 'effect/crypto'
import {requireNativeModule} from 'expo-modules-core'
import AppState from 'react-native/Libraries/AppState/AppState'
import Linking from 'react-native/Libraries/Linking/Linking'
import Share from 'react-native/Libraries/Share/Share'
import Dimensions from 'react-native/Libraries/Utilities/Dimensions'

import type {PaneLeaf} from '@deslop/components/model'
import {ListDetail, black, ink, status, styles} from '@deslop/components/native'
import {nativeComponents} from '@deslop/components/native/components'
import {SignOut, SignOutSession} from '@deslop/runtime/client/shell'
import {nativeSession} from '@deslop/runtime/iphone/session'
import {layerIPhoneShell} from '@deslop/runtime/iphone/shell'

import {StashApp} from '#app'
import type {Reader, StashScreen} from '#app'
import {Device, StashRoute, layerStash, showsDetail} from '#reads'
import {Workspace} from '#view'
import type {StashUi} from '#view'

import {ImageType, NoteId, NotesError} from '#notes/contract.ts'
import type {TagName} from '#notes/contract.ts'
import {parseBody} from '#notes/screen.ts'
import {copiedLink, isWebLink} from '#notes/shared.ts'

type H = Native.H<never>
type Surface = Native.ViewElement<never, never, Native.ViewEvents, 'view'>
type Content = Exclude<Native.NoTextInput<never>, readonly unknown[]>
type Inline = Native.TextElement<never, never, Native.TextEvents, 'text'> | string

// The native module that holds the session and the draft for the app and its share extension, and reads what the share extension queued.
// oxlint-disable typescript/no-restricted-types -- Expo turns each native AsyncFunction into a Promise.
const StashNative = requireNativeModule<{
	image: (path: string) => Promise<{data: string; type: string}>
	paste: () => Promise<{image?: string; text?: string}>
	readDraft: () => string
	readSession: () => string | null
	saveImage: (id: NoteId, data: string) => Promise<void>
	settleShares: () => Promise<readonly string[]>
	writeDraft: (text: string) => void
	writeSession: (secret?: string) => void
}>('StashNative')

function atDevice<A>(message: string, call: () => Promise<A>) {
	// Effect passes a signal; Expo's native functions check the exact argument count.
	return Effect.tryPromise({catch: cause => NotesError.make({cause, message}), try: () => call()})
}
// oxlint-enable typescript/no-restricted-types

const components = nativeComponents<never>()

// A button as the iPhone draws it: Stash's own look, compact or selected for a filter, dimmed when it cannot be pressed.
function Button(
	h: H,
	label: string,
	press: (element: Surface, event: string) => Surface,
	options: {compact?: boolean; disabled?: boolean; selected?: boolean} = {}
) {
	const active = options.selected === true
	const disabled = options.disabled === true
	const element = Boolean.match(disabled, {
		onFalse: () => press(press(h.view, 'press'), 'accessibilityTap'),
		onTrue: () => h.view
	})
	return Pressable(h, {element, props: {disabled, pressedStyle: {backgroundColor: '#2b2b2b'}}})
		.prop('accessible', true)
		.prop('accessibilityLabel', label)
		.prop('accessibilityRole', 'button')
		.prop('accessibilityState', {disabled, selected: active})
		.style({
			...styles.control,
			backgroundColor: Boolean.match(active, {
				onFalse: Function.constant(styles.control.backgroundColor),
				onTrue: Function.constant(ink)
			}),
			borderRadius: Boolean.match(options.compact === true, {
				onFalse: Function.constant(styles.control.borderRadius),
				onTrue: Function.constant(15)
			}),
			minHeight: Boolean.match(options.compact === true, {
				onFalse: Function.constant(styles.control.minHeight),
				onTrue: Function.constant(30)
			}),
			opacity: Boolean.match(disabled, {onFalse: Function.constant(1), onTrue: Function.constant(0.45)})
		})
		.children(
			h.text
				.style({
					...styles.line,
					color: Boolean.match(active, {onFalse: Function.constant(ink), onTrue: Function.constant(black)})
				})
				.children(label)
		)
}

function filterBy(screen: StashScreen, tag?: TagName) {
	return (element: Surface, event: string) => screen.filter(element, event, tag)
}

const Image = Native.defineView(
	() => new Native.ViewElement<never, never, Record<string, unknown>, 'stashImage'>('stashImage'),
	{viewName: 'RCTImageView'}
)

const PictureMessage = UiSchema.TaggedEnum({Loaded: {uri: Schema.String}, Retry: {}})
const load = Command.make('Stash/LoadPicture', {args: {path: Schema.String}}, request =>
	pipe(
		atDevice('Picture unavailable', () => StashNative.image(request.path)),
		Effect.map(result => {
			if (!Schema.is(ImageType)(result.type)) return ''
			return `data:${result.type};base64,${result.data}`
		}),
		Effect.catchTag('NotesError', () => Effect.succeed('')),
		Effect.map(uri => PictureMessage.Loaded({uri}))
	)
)

const Picture = Native.component({
	message: PictureMessage,
	model: Schema.UndefinedOr(Schema.String),
	name: 'StashPicture',
	props: Schema.Struct({label: Schema.String, path: Schema.String, width: Schema.Finite})
}).make({
	init: $ => $.set(undefined).run(load.make({path: $.props.path})),
	update: {Loaded: ($, input) => $.set(input.uri), Retry: $ => $.set(undefined).run(load.make({path: $.props.path}))},
	view: (h, uri) => {
		const style = {height: 304, width: h.props.width}
		if (uri === undefined) return h.view.style({...style, backgroundColor: '#181818'})
		if (uri === '') {
			return h.text
				.style({...styles.line, ...style})
				.on('press', PictureMessage.Retry())
				.children('Picture unavailable. Tap to retry.')
		}
		return Image.style(style)
			.prop('accessibilityLabel', h.props.label)
			.prop('accessible', true)
			.prop('resizeMode', 'contain')
			.prop('source', [{uri}])
	}
})

const GalleryMessage = UiSchema.TaggedEnum({Measured: {width: Schema.Finite}, Scrolled: {x: Schema.Finite}})
const Gallery = Native.component({
	message: GalleryMessage,
	model: Schema.Struct({page: Schema.Int, width: Schema.Finite}),
	name: 'StashGallery',
	props: Schema.Struct({paths: Schema.Array(Schema.String)})
}).make({
	init: () => ({page: 0, width: 0}),
	update: {
		Measured: ($, input) => {
			if ($.model.width === input.width) return $.model
			return $.evolve({page: 0, width: input.width})
		},
		Scrolled: ($, input) => {
			const page = pipe(
				input.x / $.model.width,
				Number.round(0),
				Number.clamp({maximum: $.props.paths.length - 1, minimum: 0})
			)
			if (page === $.model.page) return $.model
			return $.evolve({page})
		}
	},
	view: (h, model) =>
		h.view
			.on('layout', event => GalleryMessage.Measured({width: event.layout.width}))
			.children(
				model.width > 0 &&
					h.scroll
						.key(`${model.width}`)
						.style({height: 304})
						.prop('horizontal', true)
						.prop('pagingEnabled', true)
						.prop('showsHorizontalScrollIndicator', false)
						.on('scroll', event => GalleryMessage.Scrolled({x: event.x}))
						.children(
							Array.map(h.props.paths, (path, index) => {
								if (index < model.page - 1 || index > model.page + 1) {
									return h.view.key(path).style({height: 304, width: model.width})
								}
								return Picture(h, {
									key: path,
									props: {label: `Picture ${index + 1} of ${h.props.paths.length}`, path, width: model.width}
								})
							})
						),
				h.props.paths.length > 1 &&
					h.text
						.style({...styles.line, alignSelf: 'center', fontVariant: ['tabular-nums']})
						.children(`${model.page + 1} / ${h.props.paths.length}`)
			)
})

function inline(h: H, screen: StashScreen, nodes: readonly Markdown.Inline[]): readonly Inline[] {
	return Array.map(nodes, item =>
		Match.valueTags(item, {
			Emphasis: node => h.text.style({fontStyle: 'italic'}).children(inline(h, screen, node.content)),
			HardBreak: Function.constant('\n'),
			Image: node => node.alt,
			InlineCode: node => h.text.style({fontFamily: 'ui-monospace'}).children(node.value),
			Link: node => {
				const text = h.text.children(inline(h, screen, node.content))
				if (!isWebLink(node.url)) return text
				return screen.openLink(
					text.prop('accessibilityRole', 'link').style({textDecorationLine: 'underline'}),
					'press',
					node.url
				)
			},
			Strikethrough: node =>
				h.text.style({textDecorationLine: 'line-through'}).children(inline(h, screen, node.content)),
			Strong: node => h.text.style({fontWeight: '600'}).children(inline(h, screen, node.content)),
			Text: node => node.value
		})
	)
}

function table(h: H, screen: StashScreen, node: Markdown.Table, key: string) {
	return h.view
		.key(key)
		.style({gap: 6})
		.children(
			Array.map([node.headerRow, ...node.bodyRows], (row, rowIndex) =>
				h.view
					.key(`${rowIndex}`)
					.style({flexDirection: 'row', gap: 8})
					.children(
						Array.map(row.cells, (cell, column) =>
							h.text
								.key(`${column}`)
								.style({
									...styles.body,
									flex: 1,
									fontWeight: Boolean.match(rowIndex === 0, {
										onFalse: Function.constant('400' as const),
										onTrue: Function.constant('600' as const)
									})
								})
								.children(inline(h, screen, cell.content))
						)
					)
			)
		)
}

function blocks(h: H, screen: StashScreen, nodes: readonly Markdown.Block[]): readonly Content[] {
	function nested(content: readonly Markdown.Block[], key: string) {
		return h.view
			.key(key)
			.style({gap: 8, paddingLeft: 12})
			.children(blocks(h, screen, content))
	}

	function list(node: Markdown.List, key: string) {
		return h.view
			.key(key)
			.style({gap: 8})
			.children(
				Array.map(node.items, (item, position) =>
					h.view
						.key(`${position}`)
						.style({flexDirection: 'row', gap: 8})
						.children(
							h.text
								.style(styles.line)
								.children(
									Boolean.match(node.isOrdered, {
										onFalse: Function.constant('•'),
										onTrue: () => `${Option.getOrElse(node.startNumber, Function.constant(1)) + position}.`
									})
								),
							h.view.style({flex: 1, gap: 6}).children(blocks(h, screen, item.blocks))
						)
				)
			)
	}
	return Array.map(nodes, (item, index) => {
		const key = `${index}`
		return Match.valueTags(item, {
			Blockquote: node => nested(node.blocks, key),
			CodeBlock: node =>
				h.text
					.key(key)
					.style({...styles.body, fontFamily: 'ui-monospace'})
					.prop('selectable', true)
					.children(node.value),
			Heading: node =>
				h.text
					.key(key)
					.style(styles.heading)
					.children(inline(h, screen, node.content)),
			Island: node => nested(node.blocks, key),
			List: node => list(node, key),
			Paragraph: node =>
				h.text
					.key(key)
					.style(styles.body)
					.prop('selectable', true)
					.children(inline(h, screen, node.content)),
			Table: node => table(h, screen, node, key),
			ThematicBreak: () => h.view.key(key).style({height: 8})
		})
	})
}

function body(h: H, screen: StashScreen, raw: string) {
	return Result.match(parseBody(raw), {
		onFailure: () => h.text.style(styles.body).prop('selectable', true).children(raw),
		onSuccess: document => h.view.style({gap: 12}).children(blocks(h, screen, document.blocks))
	})
}

function Skeleton(h: H) {
	return h.view
		.prop('accessibilityLabel', 'Loading note')
		.style({gap: 12})
		.children(
			h.view.style({backgroundColor: '#202020', borderRadius: 4, height: 19, width: '60%'}),
			h.view.style({backgroundColor: '#202020', borderRadius: 4, height: 12, width: '86%'}),
			h.view.style({backgroundColor: '#202020', borderRadius: 4, height: 12, width: '69%'})
		)
}

function problem(h: H, screen: StashScreen, text: string, failed: boolean, retryable = false) {
	return h.view
		.style({alignItems: 'center', flexDirection: 'row', gap: 8})
		.children(
			failed && h.view.style({...styles.dot, backgroundColor: status.error}),
			h.text.style({...styles.line, flexShrink: 1}).children(text),
			retryable && Button(h, 'Retry', screen.retry)
		)
}

function ReaderView(h: H, screen: StashScreen, note: Reader) {
	if (note.denied) return h.text.style(styles.line).children('Access denied')
	return h.view
		.key(note.id)
		.style({gap: 12})
		.children(
			h.text.style(styles.heading).prop('accessibilityRole', 'header').children(note.title),
			h.view
				.style({flexDirection: 'row', gap: 10, justifyContent: 'space-between'})
				.children(
					h.text.style({...styles.line, flexShrink: 1}).children(note.source),
					h.text.style({...styles.line, fontVariant: ['tabular-nums']}).children(note.saved)
				),
			Array.isReadonlyArrayNonEmpty(note.pictures) && Gallery(h, {key: note.id, props: {paths: note.pictures}}),
			note.status !== undefined && problem(h, screen, note.status, note.statusFailed),
			String.isNonEmpty(note.summary) &&
				h.text
					.style({...styles.body, color: styles.line.color})
					.prop('selectable', true)
					.children(note.summary),
			Array.isReadonlyArrayNonEmpty(note.tags) &&
				h.view
					.style({flexDirection: 'row', flexWrap: 'wrap', gap: 6})
					.children(
						Array.map(note.tags, entry =>
							Button(h, `${entry.tag}  ${entry.count}`, filterBy(screen, entry.tag), {
								compact: true,
								selected: screen.tag === entry.tag
							}).key(entry.tag)
						)
					),
			note.body !== undefined && body(h, screen, note.body),
			note.loading && Skeleton(h),
			note.retry !== undefined && problem(h, screen, note.retry, true, true),
			!note.loading &&
				Array.isReadonlyArrayNonEmpty(note.related) &&
				h.view.style({marginTop: 12}).children(
					h.text.style(styles.line).children('Related notes'),
					Array.map(note.related, item => components.row(h, {active: false, item, select: screen.selection.select}))
				)
		)
}

function report(h: H, screen: StashScreen) {
	if (screen.report === undefined) return undefined
	return h.view
		.prop('accessibilityRole', 'alert')
		.style({
			backgroundColor: '#202020',
			borderRadius: 10,
			bottom: 34,
			gap: 8,
			left: 12,
			padding: 14,
			position: 'absolute',
			right: 80
		})
		.children(h.text.style(styles.body).children(screen.report), Button(h, 'Dismiss', screen.dismissProblem))
}

// What stands in for the notes when there is a message and a way on.
function Gate(h: H, screen: StashScreen, message: string, action: Content) {
	return components.layout(h, {
		content: h.view
			.style({alignItems: 'center', flex: 1, gap: 16, justifyContent: 'center', paddingHorizontal: 40})
			.children(h.text.style(styles.body).children(message), action, report(h, screen))
	})
}

const drawing: StashUi<H, PaneLeaf<Native.NoTextInput<never>>, View.Content<never>> = {
	...components,
	header: (h, screen) => {
		if (Array.isReadonlyArrayEmpty(screen.tags)) return undefined
		return h.scroll
			.prop('horizontal', true)
			.prop('showsHorizontalScrollIndicator', false)
			.style({flexGrow: 0})
			.contentContainerStyle({gap: 6, paddingBottom: 10, paddingHorizontal: 12, paddingTop: 4})
			.children(
				Button(h, 'All', filterBy(screen, undefined), {compact: true, selected: screen.tag === undefined}),
				Array.map(screen.tags, entry =>
					Button(h, entry.tag, filterBy(screen, entry.tag), {compact: true, selected: screen.tag === entry.tag}).key(
						entry.tag
					)
				)
			)
	},
	leave: (h, screen) =>
		Gate(
			h,
			screen,
			'Stash could not find this page',
			screen.selection
				.back(screen.selection.back(h.text, 'press'), 'accessibilityTap')
				.style(styles.body)
				.children('Back to Stash')
		),
	list: (h, rows, note) => h.view.children(rows, note),
	loadingNote: Skeleton,
	note: (h, screen, text, retryable) =>
		h.view
			.style({alignItems: 'center', flexDirection: 'row', gap: 10, padding: 12})
			.children(
				h.text.style({...styles.line, flexShrink: 1}).children(text),
				retryable && Button(h, 'Retry', screen.retry)
			),
	reader: ReaderView,
	retry: (h, screen, message) => Gate(h, screen, message, Button(h, 'Retry', screen.retry)),
	sheet: (h, screen) => ({
		body: screen
			.draftInput(h.input, 'input')
			.style({...styles.body, minHeight: 140})
			.prop('accessibilityLabel', 'Write a note')
			.prop('autoFocus', true)
			.prop('maxLength', 20_000)
			.prop('multiline', true)
			.prop('placeholderTextColor', styles.line.color)
			.placeholder('Write a note')
			.value(screen.draft),
		height: 0.8,
		toolbar: {actions: screen.composeActions, choose: screen.choose}
	}),
	signIn: (h, screen, message) =>
		Gate(
			h,
			screen,
			message,
			Boolean.match(screen.pending, {
				onFalse: () => Button(h, 'Continue with GitHub', screen.signIn),
				onTrue: () => h.text.style(styles.line).children('Signing in…')
			})
		),
	stage: (h, screen, options) =>
		h.view.style(styles.frame).children(ListDetail<never, never>(h, options), report(h, screen))
}

const App = StashApp(Native.vocabulary, (h, screen) => Workspace(h, screen, drawing))

const activation = Stream.callback<void>(queue =>
	Effect.acquireRelease(
		Effect.sync(() => {
			Queue.offerUnsafe(queue, undefined)
			return AppState.addEventListener('change', state => {
				if (state === 'active') Queue.offerUnsafe(queue, undefined)
			})
		}),
		listener => Effect.sync(() => listener.remove())
	)
)

const paste = Effect.gen(function* () {
	const clipboard = yield* atDevice('The clipboard could not be read.', StashNative.paste)
	const image = clipboard.image
	if (image === undefined) return Option.some(yield* copiedLink(clipboard.text ?? ''))
	const id = NoteId.make(SecureRandom.uuidV4Unsafe())
	yield* atDevice('The copied image could not be saved.', () => StashNative.saveImage(id, image))
	return Option.none<string>()
})

// The phone reads the clipboard and shares through the system, keeps the draft in the native module, and hands over the shares the extension queued.
const layerDevice = Layer.succeed(Device, {
	activation,
	narrow: () => {
		const windowSize = Dimensions.get('window')
		return windowSize.width < 640 || (windowSize.width < 800 && windowSize.height < 600)
	},
	openLink: Effect.fnUntraced(function* (url: string) {
		yield* atDevice('The link could not be opened.', () => Linking.openURL(url))
	}),
	paste,
	readDraft: StashNative.readDraft,
	settleShares: atDevice('Queued shares could not be sent.', StashNative.settleShares),
	share: Effect.fnUntraced(function* (text: string) {
		yield* atDevice('The share sheet could not open.', () => Share.share({message: text}))
	}),
	writeDraft: StashNative.writeDraft
})

// The share extension reads the session this module keeps, so the shell signs in to it, and an app that cannot reach Auth is still signed out here.
const layerShell = layerIPhoneShell({
	name: 'stash',
	replace: showsDetail,
	route: StashRoute,
	store: nativeSession(StashNative)
})

const layerActions = Layer.merge(
	layerDevice,
	SignOut.toLayer(
		Effect.map(SignOutSession, signOut => () => Effect.as(signOut({failure: 'Could not clear the session'}), true))
	)
)

NativeApp.register(
	Layer.provide(
		NativeApp.mount(App, Router.props(StashRoute)),
		Layer.provideMerge(layerStash, Layer.provideMerge(layerActions, layerShell))
	)
)
