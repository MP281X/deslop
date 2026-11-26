import {Command, Component, Router, Subscription} from '@effect/ui'
import {Html, HtmlSubscription} from '@effect/ui/html'

import {Array, Boolean, DateTime, Duration, Function, Layer, Option, Schema, Stream, String, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {clockAtom} from '@deslop/runtime/client/clock'
import {isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {ageOf, dayOf} from '@deslop/runtime/shared/format'
import {AppShell} from '@deslop/ui/app-shell'
import {Button} from '@deslop/ui/control'
import {Glass, GlassPanel, SidebarControl} from '@deslop/ui/glass'
import {observe} from '@deslop/ui/state'

import {Kind} from '#contracts'
import type {NoteId, NoteItem} from '#contracts'

import {kinds, sourceLabelOf, subjectOf, tagCounts} from '#web/notes/kinds.ts'
import {
	Action,
	Message,
	Model,
	Refresh,
	RunAction,
	StoreDraft,
	Wake,
	readDraft,
	select,
	visibleNotes
} from '#web/notes/model.ts'
import {mediaAtom, noteAtom, notesAtom} from '#web/notes/notes.ts'
import {coverOf, isWebLink, issueOf, picture, reader} from '#web/notes/reader.ts'
import {account, installed} from '#web/notes/session.ts'
import {StashRoute} from '#web/routes.ts'
import type {Pane} from '#web/routes.ts'

const SINGLE_PANE =
	'(width < 640px) and (not (horizontal-viewport-segments: 2)) and (not (vertical-viewport-segments: 2))'
const QUEUE_PANEL = 'stash-queue-options'
const NOTE_PANEL = 'stash-note-options'
const COMPOSE_PANEL = 'stash-compose-note'

type H = Html.H<Message>

function savedOf(note: NoteItem, now: DateTime.Utc) {
	if (pipe(note.createdAt, DateTime.distance(now), Duration.isLessThan(Duration.days(1)))) {
		return ageOf(note.createdAt, now)
	}
	return dayOf(note.createdAt, now)
}

function lineOf(note: NoteItem) {
	if (note.status === 'failed') return issueOf(note)
	if (note.status === 'organizing') return `Reading this ${subjectOf(note)}`
	return pipe([sourceLabelOf(note), note.summary], Array.filter(String.isNonEmpty), Array.join(' · '))
}

function noteRow(h: H, note: NoteItem, state: Model) {
	return Button(h)
		.key(note.id)
		.class('axis-row stash-note-row')
		.attr('aria-current', `${state.selected?.id === note.id}`)
		.on('click', Message.Open({id: note.id}))
		.children(
			Option.match(note.image, {
				onNone: () => h.span.class('stash-thumb stash-no-image'),
				onSome: () => picture(h, coverOf(note), 'stash-thumb')
			}),
			h.span
				.class('stash-row-lines')
				.children(
					h.span.class('axis-title').children(note.status === 'failed' && h.span.class('axis-dot'), note.title),
					h.span.class('axis-muted').children(lineOf(note))
				),
			h.span.class('axis-value').children(savedOf(note, state.now))
		)
}

function notice(h: H, text: string, action?: Message, label = 'Retry') {
	return h.div
		.class('stash-notice')
		.attr('role', 'status')
		.children(
			h.p.children(text),
			action !== undefined && Glass(h).children(Button(h).class('stash-action').on('click', action).children(label))
		)
}

function actionIcon(h: H, path: string) {
	return h.el('svg').attrs({'aria-hidden': 'true', viewBox: '0 0 24 24'}).children(h.el('path').attr('d', path))
}

function signOutButton(h: H, pending: boolean) {
	if (installed) {
		return Button(h, {disabled: pending})
			.on('click', Message.Run({action: Action.cases.SignOut.make({})}))
			.children('Sign out')
	}
	return h.form
		.attrs({action: `/auth/sign-out?${new URLSearchParams({next: location.href})}`, method: 'post'})
		.children(Button(h, {type: 'submit'}).children('Sign out'))
}

function queueMenu(h: H, state: Model) {
	const active = Option.getOrUndefined(AsyncResult.value(state.account))
	const tags = pipe(AsyncResult.value(state.notes), Option.getOrElse(Array.empty<NoteItem>), tagCounts)
	return GlassPanel(h, QUEUE_PANEL, 'Queue options', [
		h.select
			.attr('aria-label', 'Filter by source')
			.value(state.kind ?? '')
			.on('change', event =>
				Message.FilterKind({kind: Option.getOrUndefined(Array.findFirst(Kind.literals, kind => kind === event.value))})
			)
			.children(
				h.option.attr('value', '').children('All sources'),
				Array.map(Kind.literals, kind => h.option.key(kind).attr('value', kind).children(kinds[kind]))
			),
		h.select
			.attr('aria-label', 'Filter by tag')
			.value(state.tag ?? '')
			.on('change', event =>
				Message.FilterTag({
					tag: Option.getOrUndefined(
						Array.findFirst(tags, entry => Option.liftPredicate(entry.tag, tag => tag === event.value))
					)
				})
			)
			.children(
				h.option.attr('value', '').children('All tags'),
				Array.map(tags, entry => h.option.key(entry.tag).attr('value', entry.tag).children(entry.tag))
			),
		active !== undefined && h.span.class('axis-muted').children(active.name),
		active?.signOut === true && signOutButton(h, state.pending)
	])
}

function notesContent(h: H, state: Model) {
	if (AsyncResult.isInitial(state.notes)) return [notice(h, 'Loading notes…')]
	const notes = visibleNotes(state)
	if (Array.isReadonlyArrayEmpty(notes)) {
		if (AsyncResult.isFailure(state.notes)) return [notice(h, 'Couldn’t load notes', Message.Retry())]
		if (state.kind !== undefined || state.tag !== undefined) return [notice(h, 'No notes match')]
		return [notice(h, 'No saved notes')]
	}
	return [
		...Array.map(notes, note => noteRow(h, note, state)),
		AsyncResult.isFailure(state.notes) && notice(h, 'Notes may be out of date', Message.Retry())
	]
}

function noteMenu(h: H, pending: boolean, note: NoteItem) {
	const url = Option.getOrUndefined(note.url)
	return GlassPanel(h, NOTE_PANEL, 'Note options', [
		url !== undefined &&
			isWebLink(url) &&
			h.a.attrs({href: url, rel: 'noreferrer', target: '_blank'}).children('Open link'),
		Button(h, {disabled: pending})
			.attrs({popovertarget: NOTE_PANEL, popovertargetaction: 'hide'})
			.on('click', Message.Run({action: Action.cases.Regenerate.make({id: note.id})}))
			.children('Regenerate')
	])
}

function Compose(h: H, state: Model) {
	return GlassPanel(h, COMPOSE_PANEL, 'New note', [
		h.form
			.class('stash-compose')
			.on('submit', Message.Run({action: Action.cases.Capture.make({text: state.draft})}), {preventDefault: true})
			.children(
				h.textarea
					.attrs({'aria-label': 'Write a note', autofocus: '', maxlength: '20000', placeholder: 'Write a note'})
					.value(state.draft)
					.on('input', event => Message.Draft({text: event.value})),
				h.div
					.class('stash-compose-actions')
					.children(
						Button(h, {disabled: state.pending})
							.attrs({popovertarget: COMPOSE_PANEL, popovertargetaction: 'hide'})
							.children('Cancel'),
						Button(h, {disabled: state.pending || String.isEmpty(String.trim(state.draft)), type: 'submit'}).children(
							'Save'
						)
					)
			)
	])
		.popover('auto', state.composing)
		.on('toggle', event => Message.Compose({open: event.open}))
}

function detailContent(h: H, state: Model) {
	if (state.selected !== undefined) return reader(h, state, state.selected, savedOf(state.selected, state.now))
	if (
		StashRoute.isAnyOf(['Home'])(state.route) &&
		state.route.search.note !== undefined &&
		AsyncResult.isSuccess(state.notes)
	) {
		return notice(h, 'Note not found')
	}
	return undefined
}

function access(h: H, result: AsyncResult.AsyncResult<unknown, unknown>) {
	if (AsyncResult.isInitial(result)) return notice(h, 'Connecting to Stash…')
	if (!AsyncResult.isFailure(result)) return undefined
	if (needsSignInCause(result.cause)) {
		return notice(h, 'Sign in to Stash', Message.Run({action: Action.cases.SignIn.make({})}), 'Sign in')
	}
	if (isDeniedCause(result.cause)) return notice(h, 'Access denied', Message.Retry())
	return notice(h, 'Couldn’t connect to Stash', Message.Retry())
}

function accessGate(h: H, state: Model) {
	if (
		Option.isNone(AsyncResult.value(state.account)) ||
		(AsyncResult.isFailure(state.account) && isDeniedCause(state.account.cause))
	) {
		return access(h, state.account)
	}
	if (AsyncResult.isFailure(state.notes) && isDeniedCause(state.notes.cause)) return access(h, state.notes)
	return undefined
}

function showOf(state: Model) {
	if (!StashRoute.isAnyOf(['Home'])(state.route)) return 'list'
	if (state.route.search.pane !== undefined) return state.route.search.pane
	if (state.route.search.note !== undefined) return 'detail'
	return 'list'
}

function sidebarOpen(state: Model) {
	if (state.narrow) return showOf(state) === 'list' && !state.listHidden
	return !state.listHidden
}

function actions(h: H, state: Model) {
	const note = Option.getOrUndefined(
		Option.filter(Option.fromUndefinedOr(state.selected), () => !state.narrow || showOf(state) === 'detail')
	)
	return [
		Button(h, {disabled: state.pending})
			.attrs({'aria-label': 'Paste link', title: 'Paste link'})
			.on('click', Message.Run({action: Action.cases.Paste.make({})}))
			.children(actionIcon(h, 'M12 5v14M5 12h14')),
		Button(h)
			.attrs({'aria-label': 'New note', popovertarget: COMPOSE_PANEL, title: 'New note'})
			.children(actionIcon(h, 'm15 5 4 4M5 19l4-1 11-11-4-4L5 14Z')),
		Button(h)
			.attrs({'aria-label': 'Queue options', popovertarget: QUEUE_PANEL, title: 'Queue options'})
			.children(actionIcon(h, 'M4 7h16M7 12h10m-7 5h4')),
		note !== undefined &&
			Button(h, {disabled: state.pending})
				.attrs({'aria-label': 'Share', title: 'Share'})
				.on(
					'click',
					Message.Run({
						action: Action.cases.Share.make({text: Option.getOrUndefined(note.url) ?? (note.summary || note.title)})
					})
				)
				.children(actionIcon(h, 'M12 15V3m-4 4 4-4 4 4M7 11H5v10h14V11h-2')),
		note !== undefined &&
			Button(h).attrs({'aria-label': 'Note options', popovertarget: NOTE_PANEL, title: 'Note options'}).children('⋯'),
		queueMenu(h, state),
		Compose(h, state),
		note !== undefined && noteMenu(h, state.pending, note)
	]
}

function workspace(h: H, state: Model) {
	if (!StashRoute.isAnyOf(['Home'])(state.route)) {
		return h.main.class('stash-gate').children(h.a.attr('href', '/').children('Back to Stash'))
	}
	const gate = accessGate(h, state)
	return h.main.children(
		Boolean.match(gate !== undefined, {
			onFalse: () =>
				AppShell(h, {
					actions: actions(h, state),
					content: h.div
						.class('fold stash')
						.attrs({
							'data-list-hidden': Boolean.match(state.listHidden, {
								onFalse: Function.constUndefined,
								onTrue: Function.constant('')
							}),
							'data-show': showOf(state)
						})
						.children(
							h.section
								.class('fold-list')
								.attr('aria-label', 'Saved notes')
								.children(h.div.class('stash-queue').children(notesContent(h, state))),
							h.section
								.key(state.selected?.id ?? 'no-note')
								.class('fold-detail')
								.attr('aria-label', 'Reader')
								.children(h.div.class('stash-reading').children(detailContent(h, state)))
						),
					sidebar: SidebarControl(h, sidebarOpen(state), Message.Sidebar())
				}),
			onTrue: () => h.div.class('stash-gate').children(gate)
		}),
		state.problem !== undefined &&
			h.div
				.class('stash-report')
				.attr('role', 'alert')
				.children(h.p.children(state.problem), Button(h).on('click', Message.DismissProblem()).children('Dismiss'))
	)
}

const StashDef = Html.component({
	message: Message,
	model: Model,
	name: 'Stash',
	props: Schema.Struct({route: StashRoute})
})

function page(route: typeof StashRoute.cases.Home.Type, pane: Pane, note?: NoteId) {
	return Command.asNoop(Router.patchSearch(StashRoute, route, {note, pane}, {history: 'push'}))
}

export const Stash = pipe(
	StashDef.make({
		init: context => {
			const state: Model = {
				account: AsyncResult.initial(),
				body: AsyncResult.initial(),
				composing: false,
				draft: readDraft(),
				kind: undefined,
				listHidden: false,
				media: AsyncResult.initial(),
				narrow: matchMedia(SINGLE_PANE).matches,
				notes: AsyncResult.initial(),
				now: DateTime.nowUnsafe(),
				pending: false,
				problem: undefined,
				revision: 0,
				route: context.props.route,
				selected: undefined,
				tag: undefined
			}
			if (installed) return context.set(state).run(Wake.make({refresh: false}))
			return state
		},
		subscriptions: context => {
			const admitted =
				Option.isSome(AsyncResult.value(context.model.account)) &&
				!(AsyncResult.isFailure(context.model.account) && isDeniedCause(context.model.account.cause))
			const selected = Option.getOrUndefined(
				Option.filter(Option.fromUndefinedOr(context.model.selected), () => admitted)
			)
			return [
				HtmlSubscription.onMediaQuery(SINGLE_PANE, narrow => Message.Posture({narrow})),
				Router.subscription(StashRoute, context.model.route, route => Message.Route({route})),
				Subscription.make(
					'account',
					observe(account, result => Message.Account({result}))
				),
				Subscription.make(
					'clock',
					observe(clockAtom('1 minute'), now => Message.Clock({now}))
				),
				installed &&
					Subscription.make(
						'activation',
						pipe(
							Stream.fromEventListener(document, 'visibilitychange'),
							Stream.filter(() => document.visibilityState === 'visible'),
							Stream.map(() => Message.Activate())
						)
					),
				admitted &&
					Subscription.make(
						'notes',
						observe(notesAtom, result => Message.Notes({result}))
					),
				selected !== undefined &&
					Subscription.make('body', [selected.id, context.model.revision], () =>
						observe(noteAtom(selected), result => Message.Body({id: selected.id, result}))
					),
				selected !== undefined &&
					Subscription.make('media', selected.id, id => observe(mediaAtom(id), result => Message.Media({id, result})))
			]
		},
		update: {
			Account: ($, message) => {
				if (AsyncResult.isFailure(message.result) && isDeniedCause(message.result.cause)) {
					return $.evolve({
						account: message.result,
						body: AsyncResult.initial(),
						media: AsyncResult.initial(),
						notes: AsyncResult.initial(),
						selected: undefined
					})
				}
				return $.evolve({account: message.result})
			},
			Activate: $ => $.run(Wake.make({refresh: true})),
			Awake: $ => $.model,
			Body: ($, message) => {
				if (
					$.model.selected?.id !== message.id ||
					(AsyncResult.isInitial(message.result) && !AsyncResult.isInitial($.model.body))
				) {
					return $.model
				}
				if (AsyncResult.isFailure(message.result) && !isDeniedCause(message.result.cause)) {
					return $.evolve({
						body: AsyncResult.failureWithPrevious(message.result.cause, {previous: Option.some($.model.body)})
					})
				}
				return $.evolve({body: message.result})
			},
			Clock: ($, message) => $.evolve({now: message.now}),
			Compose: ($, message) => $.evolve({composing: message.open}),
			DismissProblem: $ => $.evolve({problem: undefined}),
			Draft: ($, message) => $.evolve({draft: message.text}).run(Command.asNoop(StoreDraft.make({text: message.text}))),
			FilterKind: ($, message) => $.set(select({...$.model, kind: message.kind})),
			FilterTag: ($, message) => {
				if (!StashRoute.isAnyOf(['Home'])($.model.route)) return $.model
				return $.set(select({...$.model, listHidden: false, tag: message.tag})).run(
					page($.model.route, 'list', $.model.selected?.id)
				)
			},
			Media: ($, message) => {
				if ($.model.selected?.id !== message.id) return $.model
				return $.evolve({media: message.result})
			},
			Notes: ($, message) => $.set(select({...$.model, notes: message.result})),
			Open: ($, message) => {
				if (!StashRoute.isAnyOf(['Home'])($.model.route)) return $.model
				return $.evolve({composing: false, listHidden: false}).run(page($.model.route, 'detail', message.id))
			},
			Posture: ($, message) => $.evolve({narrow: message.narrow}),
			Problem: ($, message) => $.evolve({problem: message.text}),
			Retry: $ => $.run(Command.asNoop(Refresh.make({item: $.model.selected}))),
			Route: ($, message) =>
				$.set(
					select({
						...$.model,
						listHidden:
							StashRoute.isAnyOf(['Home'])(message.route) &&
							message.route.search.pane === 'detail' &&
							$.model.listHidden,
						route: message.route
					})
				),
			Run: ($, message) => {
				if (
					$.model.pending ||
					(Action.isAnyOf(['Capture'])(message.action) && String.isEmpty(String.trim(message.action.text)))
				) {
					return $.model
				}
				return $.evolve({pending: true, problem: undefined}).run(RunAction.make({action: message.action}))
			},
			Settled: ($, message) => {
				const next = $.evolve({pending: false, problem: message.problem})
				if (message.problem !== undefined) return next
				if (Action.isAnyOf(['SignIn'])(message.action) && installed) return next.run(Wake.make({refresh: false}))
				if (!Action.isAnyOf(['Capture'])(message.action)) return next
				if ($.model.draft !== message.action.text) return next.evolve({composing: false})
				return next.evolve({composing: false, draft: ''}).run(Command.asNoop(StoreDraft.make({text: ''})))
			},
			Sidebar: $ => {
				if (!StashRoute.isAnyOf(['Home'])($.model.route)) return $.model
				const hide = sidebarOpen($.model)
				return $.evolve({listHidden: hide}).run(
					page(
						$.model.route,
						Boolean.match(hide, {onFalse: Function.constant('list'), onTrue: Function.constant('detail')}),
						$.model.selected?.id
					)
				)
			}
		},
		view: workspace
	}),
	Component.provide(
		Layer.provideMerge(
			Layer.mergeAll(Refresh.layer, RunAction.layer, Wake.layer),
			Layer.merge(AtomRegistry.layer, FetchHttpClient.layer)
		)
	)
)
