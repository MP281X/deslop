import {Command, Component, Router, Subscription} from '@effect/ui'
import {Html} from '@effect/ui/html'

import {Array, Boolean, DateTime, Duration, Function, Layer, Option, Schema, Stream, String, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {clockAtom} from '@deslop/runtime/client/clock'
import {isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {ageOf, dayOf} from '@deslop/runtime/shared/format'
import {Button} from '@deslop/ui/control'
import {Glass} from '@deslop/ui/glass'
import {observe} from '@deslop/ui/state'

import {kinds, sourceLabelOf, subjectOf} from '#lib/kinds.ts'
import {mediaAtom, noteAtom, notesAtom} from '#lib/notes.ts'
import {account, installed} from '#lib/session.ts'
import {
	Action,
	Message,
	Model,
	Refresh,
	RunAction,
	StashRoute,
	StoreDraft,
	Wake,
	readDraft,
	select,
	visibleNotes
} from '#routes/model.ts'
import type {Menu, Pane} from '#routes/model.ts'
import {coverOf, isWebLink, issueOf, picture, reader} from '#routes/reader.ts'
import {tagCounts} from '#services/notes/lib/utils.ts'
import {Kind} from '#services/notes/schema.ts'
import type {NoteId, NoteItem} from '#services/notes/schema.ts'

type H = Html.H<Message>

function savedOf(note: NoteItem, now: DateTime.Utc) {
	if (pipe(note.createdAt, DateTime.distance(now), Duration.isLessThan(Duration.days(1)))) {
		return ageOf(note.createdAt, now)
	}
	return dayOf(note.createdAt, now)
}

function sidebar(h: H, label: string, message: Message, disabled = false) {
	return Glass(h).children(
		Button(h, {disabled})
			.class('stash-icon')
			.attrs({'aria-label': label, title: label})
			.on('click', message)
			.children(h.span.class('stash-sidebar-mark').attr('aria-hidden', 'true'))
	)
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

function more(h: H, state: Model, name: Menu, label: string) {
	return Button(h)
		.class('stash-icon')
		.attrs({'aria-expanded': `${state.menu === name}`, 'aria-label': label, title: label})
		.on('click', Message.Menu({name: Option.getOrUndefined(Option.liftPredicate(name, menu => state.menu !== menu))}))
		.children('⋯')
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
	return h.div.class('stash-menu stash-queue-menu').children(
		Button(h).on('click', Message.Compose()).children('New note'),
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
	)
}

function queueSidebar(h: H, state: Model) {
	if (state.selected === undefined) return sidebar(h, 'Hide sidebar', Message.ShowList(), true)
	return sidebar(h, 'Hide sidebar', Message.HideList({id: state.selected.id}))
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

function Queue(h: H, state: Model) {
	return h.section
		.class('fold-list')
		.attr('aria-label', 'Saved notes')
		.children(
			h.div
				.class('stash-top')
				.children(
					queueSidebar(h, state),
					h.div
						.class('stash-more')
						.children(
							Glass(h).children(more(h, state, 'queue', 'Queue options')),
							state.menu === 'queue' && queueMenu(h, state)
						)
				),
			h.div.class('stash-scroll stash-queue').children(notesContent(h, state)),
			h.div.class('stash-bottom').children(
				Glass(h).children(
					Button(h, {disabled: state.pending})
						.class('stash-action')
						.on('click', Message.Run({action: Action.cases.Paste.make({})}))
						.children('+ Paste link')
				)
			)
		)
}

function noteActions(h: H, state: Model, note: NoteItem) {
	const url = Option.getOrUndefined(note.url)
	const share = url ?? (note.summary || note.title)
	return h.div.class('stash-bottom').children(
		h.div.class('stash-more').children(
			Glass(h).children(
				Button(h, {disabled: state.pending})
					.class('stash-action')
					.on('click', Message.Run({action: Action.cases.Share.make({text: share})}))
					.children('Share'),
				more(h, state, 'note', 'Note options')
			),
			state.menu === 'note' &&
				h.div.class('stash-menu stash-note-menu').children(
					url !== undefined &&
						isWebLink(url) &&
						h.a.attrs({href: url, rel: 'noreferrer', target: '_blank'}).children('Open link'),
					Button(h, {disabled: state.pending})
						.on('click', Message.Run({action: Action.cases.Regenerate.make({id: note.id})}))
						.children('Regenerate')
				)
		)
	)
}

function Compose(h: H, state: Model) {
	return h.form
		.class('stash-compose')
		.on('submit', Message.Run({action: Action.cases.Capture.make({text: state.draft})}), {preventDefault: true})
		.children(
			h.textarea
				.attrs({'aria-label': 'Write a note', autofocus: '', maxlength: '20000', placeholder: 'Write a note'})
				.value(state.draft)
				.on('input', event => Message.Draft({text: event.value})),
			h.div.class('stash-bottom').children(
				Glass(h).children(
					Button(h, {disabled: state.pending}).class('stash-action').on('click', Message.ShowList()).children('Cancel'),
					Button(h, {disabled: state.pending || String.isEmpty(String.trim(state.draft)), type: 'submit'})
						.class('stash-action')
						.children('Save')
				)
			)
		)
}

function detailContent(h: H, state: Model) {
	if (state.composing) return [Compose(h, state)]
	return [
		h.div
			.key(state.selected?.id ?? 'no-note')
			.class('stash-scroll stash-reading')
			.children(
				Boolean.match(state.selected === undefined, {
					onFalse: () =>
						Option.getOrUndefined(
							Option.map(Option.fromUndefinedOr(state.selected), note =>
								reader(h, state, note, savedOf(note, state.now))
							)
						),
					onTrue: () =>
						StashRoute.isAnyOf(['Home'])(state.route) &&
						state.route.search.note !== undefined &&
						AsyncResult.isSuccess(state.notes) &&
						notice(h, 'Note not found')
				})
			),
		state.selected !== undefined && noteActions(h, state, state.selected)
	]
}

function Detail(h: H, state: Model) {
	return h.section
		.class('fold-detail')
		.attr('aria-label', 'Reader')
		.children(
			h.div.class('stash-detail-top').children(sidebar(h, 'Show sidebar', Message.ShowList())),
			detailContent(h, state)
		)
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
	if (state.composing) return 'detail'
	if (!StashRoute.isAnyOf(['Home'])(state.route)) return 'list'
	if (state.route.search.pane !== undefined) return state.route.search.pane
	if (state.route.search.note !== undefined) return 'detail'
	return 'list'
}

function workspace(h: H, state: Model) {
	if (!StashRoute.isAnyOf(['Home'])(state.route)) {
		return h.main.class('stash-gate').children(h.a.attr('href', '/').children('Back to Stash'))
	}
	const gate = accessGate(h, state)
	return h.main.children(
		Boolean.match(gate !== undefined, {
			onFalse: () =>
				h.div
					.class('fold stash')
					.attrs({
						'data-list-hidden': Boolean.match(state.listHidden, {
							onFalse: Function.constUndefined,
							onTrue: Function.constant('')
						}),
						'data-show': showOf(state)
					})
					.children(Queue(h, state), Detail(h, state)),
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
				menu: undefined,
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
			Compose: $ => $.evolve({composing: true, listHidden: false, menu: undefined}),
			DismissProblem: $ => $.evolve({problem: undefined}),
			Draft: ($, message) => $.evolve({draft: message.text}).run(Command.asNoop(StoreDraft.make({text: message.text}))),
			FilterKind: ($, message) => $.set(select({...$.model, kind: message.kind, menu: undefined})),
			FilterTag: ($, message) => {
				if (!StashRoute.isAnyOf(['Home'])($.model.route)) return $.model
				return $.set(select({...$.model, listHidden: false, menu: undefined, tag: message.tag})).run(
					page($.model.route, 'list', $.model.selected?.id)
				)
			},
			HideList: ($, message) => {
				if (!StashRoute.isAnyOf(['Home'])($.model.route)) return $.model
				return $.evolve({listHidden: true, menu: undefined}).run(page($.model.route, 'detail', message.id))
			},
			Media: ($, message) => {
				if ($.model.selected?.id !== message.id) return $.model
				return $.evolve({media: message.result})
			},
			Menu: ($, message) => $.evolve({menu: message.name}),
			Notes: ($, message) => $.set(select({...$.model, notes: message.result})),
			Open: ($, message) => {
				if (!StashRoute.isAnyOf(['Home'])($.model.route)) return $.model
				return $.evolve({composing: false, listHidden: false, menu: undefined}).run(
					page($.model.route, 'detail', message.id)
				)
			},
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
						menu: undefined,
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
				return $.evolve({menu: undefined, pending: true, problem: undefined}).run(
					RunAction.make({action: message.action})
				)
			},
			Settled: ($, message) => {
				const next = $.evolve({pending: false, problem: message.problem})
				if (message.problem !== undefined) return next
				if (Action.isAnyOf(['SignIn'])(message.action) && installed) return next.run(Wake.make({refresh: false}))
				if (!Action.isAnyOf(['Capture'])(message.action)) return next
				if ($.model.draft !== message.action.text) return next.evolve({composing: false})
				return next.evolve({composing: false, draft: ''}).run(Command.asNoop(StoreDraft.make({text: ''})))
			},
			ShowList: $ => {
				if (!StashRoute.isAnyOf(['Home'])($.model.route)) return $.model
				return $.evolve({composing: false, listHidden: false, menu: undefined}).run(
					page($.model.route, 'list', $.model.selected?.id)
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
