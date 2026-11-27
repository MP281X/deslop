import './stash.css'

import {Router} from '@effect/ui'
import {Button} from '@effect/ui-kit'
import {BrowserHost, BrowserRouter, Html} from '@effect/ui/html'
import type {Html as Web} from '@effect/ui/html'

import {Array, Effect, Layer, Option, Predicate, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {AtomRegistry} from 'effect/reactivity'

import {Layout, ListDetail, Row, styles, webStyle} from '@deslop/design/web'
import {layerWebTelemetry} from '@deslop/runtime/web/telemetry'

import {dismissCompose, dismissProblem, editDraft, makeStash, retry, signIn} from '#screens/notes.ts'
import type {StashMessage, StashScreen} from '#screens/notes.ts'
import {BackToQueue, StashRoute} from '#screens/routes.ts'
import {platform, reads} from '#web/platform.ts'
import {ReaderView, Skeleton} from '#web/reader.ts'

type H = Web.H<StashMessage>

function notice(h: H, text: string, retryable = false) {
	return h.p
		.style(webStyle(styles.line))
		.class('stash-notice')
		.attr('role', 'status')
		.children(text, retryable && Button(h, {onPress: retry}).class('stash-button').children('Retry'))
}

function detail(h: H, screen: StashScreen) {
	if (screen.detailLoading) return Skeleton(h)
	if (screen.detailFailed) return notice(h, 'Couldn’t load the note', true)
	if (screen.detailMissing) return notice(h, 'Note not found')
	if (screen.detail === undefined) return undefined
	return ReaderView(h, screen, screen.detail)
}

function report(h: H, problem: string | undefined) {
	if (problem === undefined) return undefined
	return h.div
		.class('stash-report')
		.attr('role', 'alert')
		.children(h.p.children(problem), Button(h, {onPress: dismissProblem}).class('stash-button').children('Dismiss'))
}

function queueTags(h: H, screen: StashScreen) {
	if (Array.isReadonlyArrayEmpty(screen.tags)) return undefined
	return h.div
		.class('stash-tags stash-queue-tags')
		.attr('aria-label', 'Filter by tag')
		.children(
			Button(h, {onPress: screen.filter(undefined)})
				.attr('aria-pressed', `${screen.tag === undefined}`)
				.children('All'),
			Array.map(screen.tags, ({tag}) =>
				Button(h, {onPress: screen.filter(tag)})
					.key(tag)
					.attr('aria-pressed', `${screen.tag === tag}`)
					.children(tag)
			)
		)
}

const Stash = makeStash(Html.vocabulary, platform, reads, (h, screen) => {
	if (screen.notFound) {
		return Layout(h, {content: h.div.class('stash-gate').children(h.a.attr('href', '/').children('Back to Stash'))})
	}
	if (screen.access !== undefined) {
		const action = () => {
			if (screen.access?.signIn === true) {
				return Button(h, {onPress: signIn, props: {disabled: screen.pending}})
					.class('stash-button')
					.children('Continue with GitHub')
			}
			return Button(h, {onPress: retry}).class('stash-button').children('Retry')
		}
		return Layout(h, {
			content: h.div
				.class('stash-gate')
				.children(h.p.attr('role', 'status').children(screen.access.message), action(), report(h, screen.problem))
		})
	}
	const queueMessage = Option.fromUndefinedOr(screen.queueMessage).pipe(
		Option.map(text => notice(h, text, screen.queueRetryable)),
		Option.getOrUndefined
	)
	return h.div.class('stash-workspace').children(
		ListDetail(h, {
			...Option.fromUndefinedOr(screen.detail).pipe(
				Option.map(note => ({defaultId: note.id})),
				Option.getOrElse(() => ({}))
			),
			detail: detail(h, screen),
			detailToolbar: screen.toolbar.detail,
			empty: queueMessage,
			header: h.div.key('tags').children(queueTags(h, screen)),
			list: activeId =>
				h.div.key('notes').children(
					Array.map(screen.list.rows, item =>
						Row(h, {active: activeId === item.id, item, select: screen.selection.select})
					),
					queueMessage
				),
			loading: screen.list.loading,
			selection: screen.selection,
			sheet: {
				actions: [
					Button(h, {onPress: dismissCompose}).class('stash-button').children('Cancel'),
					Button(h, {onPress: screen.save, props: {disabled: screen.saveDisabled}})
						.class('stash-button')
						.children('Save')
				],
				body: h.textarea
					.class('stash-draft')
					.attrs({'aria-label': 'Write a note', maxlength: '20000', placeholder: 'Write a note', autofocus: ''})
					.value(screen.draft)
					.on('input', event => editDraft(event.value)),
				dismiss: screen.dismiss,
				label: 'New note',
				open: screen.composing,
				pending: screen.pending
			},
			toolbar: screen.toolbar.queue
		}),
		report(h, screen.problem)
	)
})

const root = document.getElementById('root')
if (Predicate.isNull(root)) throw new TypeError('Missing application mount element with id "root"')

pipe(
	BrowserHost.mount(Stash, Router.props(StashRoute), root),
	Layer.provide(BackToQueue.layer),
	Layer.provide(BrowserRouter.layer({routes: StashRoute})),
	Layer.provide(AtomRegistry.layer),
	Layer.provide(Layer.provide(layerWebTelemetry('@deslop/stash'), FetchHttpClient.layer)),
	Layer.launch,
	// oxlint-disable-next-line eslint/no-restricted-properties -- Mount one scoped root for the life of the document.
	Effect.runFork
)
