import 'react-native/Libraries/Core/setUpXHR'

import {Router} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {Array, Layer, pipe} from 'effect'

import {AtomRegistry} from 'effect/reactivity'

import {Layout, ListDetail, Row, styles} from '@deslop/components/native'

import {Button} from '#iphone/controls.ts'
import {platform, reads} from '#iphone/platform.ts'
import {ReaderView, Skeleton} from '#iphone/reader.ts'
import {layerIPhoneRouter} from '#iphone/router.ts'
import {dismissProblem, editDraft, makeStash, retry, signIn} from '#screens/notes.ts'
import type {StashMessage, StashScreen} from '#screens/notes.ts'
import {BackToQueue, StashRoute} from '#screens/routes.ts'
import {workspace} from '#screens/workspace.ts'

type H = Native.H<StashMessage>

function notice(h: H, text: string, retryable = false) {
	return h.view
		.style({alignItems: 'center', flexDirection: 'row', gap: 10, padding: 12})
		.children(h.text.style({...styles.line, flexShrink: 1}).children(text), retryable && Button(h, 'Retry', retry))
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
			Array.map(screen.tags, entry =>
				Button(h, entry.tag, screen.filter(entry.tag), {compact: true, selected: screen.tag === entry.tag}).key(
					entry.tag
				)
			)
		)
}

function report(h: H, problem?: string) {
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
		function action() {
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
	const options = workspace(h, screen, {
		list: (ui, rows, message) => ui.view.children(rows, message),
		notice,
		reader: ReaderView,
		row: Row<StashMessage, never>,
		skeleton: Skeleton
	})
	return h.view.style(styles.frame).children(
		ListDetail<StashMessage, never>(h, {
			...options,
			header: queueTags(h, screen),
			sheet: {
				...options.sheet,
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
				height: 0.8,
				toolbar: screen.composeToolbar
			}
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
