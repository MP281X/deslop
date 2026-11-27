import 'react-native/Libraries/Core/setUpXHR'

import {Router} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {Array, Layer, Option, pipe} from 'effect'

import {AtomRegistry} from 'effect/reactivity'

import {Layout, ListDetail, Row, styles} from '@deslop/design/native'

import {Button} from '#iphone/controls.ts'
import {platform, reads} from '#iphone/platform.ts'
import {ReaderView, Skeleton} from '#iphone/reader.ts'
import {layerIPhoneRouter} from '#iphone/router.ts'
import {dismissProblem, editDraft, makeStash, retry, signIn} from '#screens/notes.ts'
import type {StashMessage, StashScreen} from '#screens/notes.ts'
import {BackToQueue, StashRoute} from '#screens/routes.ts'

type H = Native.H<StashMessage>

function notice(h: H, text: string, retryable = false) {
	return h.view
		.style({alignItems: 'center', flexDirection: 'row', gap: 10, padding: 12})
		.children(h.text.style({...styles.line, flexShrink: 1}).children(text), retryable && Button(h, 'Retry', retry))
}

function detail(h: H, screen: StashScreen) {
	if (screen.detailLoading) return Skeleton(h)
	if (screen.detailFailed) return notice(h, 'Couldn’t load the note', true)
	if (screen.detailMissing) return notice(h, 'Note not found')
	if (screen.detail === undefined) return undefined
	return ReaderView(h, screen, screen.detail)
}

function queueTags(h: H, screen: StashScreen) {
	if (Array.isReadonlyArrayEmpty(screen.tags)) return undefined
	return h.scroll
		.prop('horizontal', true)
		.prop('showsHorizontalScrollIndicator', false)
		.style({flexGrow: 0})
		.contentContainerStyle({gap: 6, paddingBottom: 10, paddingHorizontal: 12, paddingTop: 4})
		.children(
			Button(h, 'All', screen.filter(undefined), {compact: true, selected: screen.tag === undefined}),
			Array.map(screen.tags, ({tag}) =>
				Button(h, tag, screen.filter(tag), {compact: true, selected: screen.tag === tag}).key(tag)
			)
		)
}

function report(h: H, problem: string | undefined) {
	if (problem === undefined) return undefined
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
		.children(h.text.style(styles.body).children(problem), Button(h, 'Dismiss', dismissProblem))
}

const Stash = makeStash(Native.vocabulary, platform, reads, (h, screen) => {
	if (screen.notFound || screen.access !== undefined) {
		const action = () => {
			if (screen.notFound) {
				return screen.selection
					.back(screen.selection.back(h.text, 'press'), 'accessibilityTap')
					.style(styles.body)
					.children('Back to Stash')
			}
			if (screen.access?.signIn === true) {
				if (screen.pending) return h.text.style(styles.line).children('Signing in…')
				return Button(h, 'Continue with GitHub', signIn)
			}
			return Button(h, 'Retry', retry)
		}
		return Layout(h, {
			content: h.view
				.style({alignItems: 'center', flex: 1, gap: 16, justifyContent: 'center', paddingHorizontal: 40})
				.children(
					h.text.style(styles.body).children(screen.access?.message ?? 'Stash could not find this page'),
					action(),
					report(h, screen.problem)
				)
		})
	}
	const queueMessage = Option.fromUndefinedOr(screen.queueMessage).pipe(
		Option.map(text => notice(h, text, screen.queueRetryable)),
		Option.getOrUndefined
	)
	return h.view.style(styles.frame).children(
		ListDetail(h, {
			...Option.fromUndefinedOr(screen.detail).pipe(
				Option.map(note => ({defaultId: note.id})),
				Option.getOrElse(() => ({}))
			),
			detail: detail(h, screen),
			detailToolbar: screen.toolbar.detail,
			empty: queueMessage,
			header: queueTags(h, screen),
			list: activeId =>
				h.view.children(
					Array.map(screen.list.rows, item =>
						Row(h, {active: activeId === item.id, item, select: screen.selection.select})
					),
					queueMessage
				),
			loading: screen.list.loading,
			selection: screen.selection,
			sheet: {
				body: h.input
					.style({...styles.body, minHeight: 140})
					.prop('accessibilityLabel', 'Write a note')
					.prop('autoFocus', true)
					.prop('maxLength', 20_000)
					.prop('multiline', true)
					.prop('placeholderTextColor', styles.line.color)
					.placeholder('Write a note')
					.value(screen.draft)
					.on('input', event => editDraft(event.value)),
				dismiss: screen.dismiss,
				height: 0.8,
				label: 'New note',
				open: screen.composing,
				pending: screen.pending,
				toolbar: screen.composeToolbar
			},
			toolbar: screen.toolbar.queue
		}),
		report(h, screen.problem)
	)
})

NativeApp.register(
	pipe(
		NativeApp.mount(Stash, Router.props(StashRoute)),
		Layer.provide(BackToQueue.layer),
		Layer.provide(layerIPhoneRouter),
		Layer.provide(AtomRegistry.layer)
	)
)
