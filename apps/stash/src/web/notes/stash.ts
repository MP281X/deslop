import {Command, Component, Router, Subscription} from '@effect/ui'
import {Html} from '@effect/ui/html'

import {Array, Boolean, DateTime, Duration, Function, Layer, Option, Schema, Stream, String, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {clockAtom} from '@deslop/runtime/client/clock'
import {isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {ageOf, dayOf} from '@deslop/runtime/shared/format'
import {ActionShell, CheckedChoice} from '@deslop/ui/app-shell'
import type {ShellAction, ShellMenuGroup, ShellMenuItem} from '@deslop/ui/app-shell'
import {Loading, Notice, Row} from '@deslop/ui/axis'
import {Button, PressFeedback} from '@deslop/ui/control'
import {Glass, GlassPanel} from '@deslop/ui/glass'
import {isNative, sessionAccount} from '@deslop/ui/native'
import {WebSignOut} from '@deslop/ui/session'
import {Sheet} from '@deslop/ui/sheet'
import {Split, panelUpdates, singlePane, watchPanes} from '@deslop/ui/split'
import {ReadState, observe} from '@deslop/ui/state'
import {SymbolIcon} from '@deslop/ui/symbol'
import {hasHistoryBehind, historyBack, usedHistoryMotion} from '@deslop/ui/viewport'

import {Kind} from '#contracts'
import type {NoteItem} from '#contracts'

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
import {StashRoute} from '#web/routes.ts'

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
	return Row(h, {
		className: 'stash-note-row',
		current: !state.narrow && !state.listHidden && state.selected?.id === note.id,
		id: note.id,
		leading: Option.match(note.image, {
			onNone: () => h.span.class('stash-thumb'),
			onSome: () => picture(h, coverOf(note), 'stash-thumb')
		}),
		line: lineOf(note),
		open: Message.Open({id: note.id}),
		problem: note.status === 'failed',
		title: note.title,
		value: savedOf(note, state.now)
	})
}

function queueGroups(state: Model) {
	const tags = pipe(AsyncResult.value(state.notes), Option.getOrElse(Array.empty<NoteItem>), tagCounts)
	return [
		{
			items: [
				{
					checked: state.kind === undefined,
					id: 'source-all',
					message: Message.FilterKind({kind: undefined}),
					title: 'All sources'
				},
				...Array.map(Kind.literals, kind => ({
					checked: kind === state.kind,
					id: `source-${kind}`,
					message: Message.FilterKind({kind}),
					title: kinds[kind]
				}))
			],
			title: 'Source'
		},
		{
			items: [
				{
					checked: state.tag === undefined,
					id: 'all-tags',
					message: Message.FilterTag({tag: undefined}),
					title: 'All tags'
				},
				...Array.map(tags, entry => ({
					checked: entry.tag === state.tag,
					id: `tag-${entry.tag}`,
					message: Message.FilterTag({tag: entry.tag}),
					title: entry.tag
				}))
			],
			title: 'Tag'
		}
	] satisfies readonly ShellMenuGroup<Message>[]
}

function queueOptions(state: Model) {
	const groups: readonly ShellMenuGroup<Message>[] = queueGroups(state)
	const signedIn = Option.getOrUndefined(AsyncResult.value(state.account))
	if (!isNative || signedIn?.signOut !== true) return groups
	return [
		...groups,
		{
			items: [
				{
					disabled: state.pending,
					id: 'sign-out',
					message: Message.Run({action: Action.cases.SignOut.make({})}),
					title: 'Sign out'
				}
			],
			title: ''
		}
	] satisfies readonly ShellMenuGroup<Message>[]
}

function queueMenu(h: H, state: Model) {
	const signedIn = Option.getOrUndefined(AsyncResult.value(state.account))
	return GlassPanel(h, 'stash-queue-options', 'Queue options', [
		...Array.map(queueGroups(state), group =>
			h.div
				.key(group.title)
				.attrs({'aria-label': group.title, role: 'group'})
				.children(
					h.span.class('stash-menu-label').children(group.title),
					...Array.map(group.items, item => CheckedChoice(h, item))
				)
		),
		signedIn?.signOut === true && WebSignOut(h)
	])
		.attr('role', 'menu')
		.popover('auto', state.panel === 'queue')
		.on('toggle', event => {
			if (!event.open) return Message.PanelClosed({panel: 'queue'})
			return undefined
		})
}

function notesContent(h: H, state: Model) {
	return ReadState(state.notes, {
		failed: () => Notice(h, 'Couldn’t load notes', Message.Retry()),
		loading: () => Loading(h, 'Loading saved notes', h.div.class('stash-skeleton-list').attr('aria-hidden', 'true')),
		ready: (_, stale) =>
			Array.match(visibleNotes(state), {
				onEmpty: () => {
					if (stale) return Notice(h, 'Couldn’t load notes', Message.Retry())
					if (state.kind !== undefined || state.tag !== undefined) return Notice(h, 'No notes match')
					return Notice(h, 'No saved notes')
				},
				onNonEmpty: notes => [
					...Array.map(notes, note => noteRow(h, note, state)),
					stale && Notice(h, 'Notes may be out of date', Message.Retry())
				]
			})
	})
}

function noteOptions(state: Model, note: NoteItem) {
	const url = Option.getOrUndefined(Option.filter(note.url, isWebLink))
	const items: readonly ShellMenuItem<Message>[] = [
		{
			disabled: state.pending,
			id: 'regenerate',
			message: Message.Run({action: Action.cases.Regenerate.make({id: note.id})}),
			title: 'Regenerate'
		}
	]
	if (url === undefined) return [{items, title: ''}]
	return [
		{
			items: [
				{id: 'open-link', message: Message.Run({action: Action.cases.OpenLink.make({url})}), title: 'Open link'},
				...items
			],
			title: ''
		}
	] satisfies readonly ShellMenuGroup<Message>[]
}

function noteMenu(h: H, state: Model, note: NoteItem) {
	const url = Option.getOrUndefined(note.url)
	return GlassPanel(h, 'stash-note-options', 'Note options', [
		url !== undefined &&
			isWebLink(url) &&
			h.a
				.class('stash-menu-link')
				.attrs({'data-pressable': '', href: url, rel: 'noreferrer', role: 'menuitem', target: '_blank'})
				.on('click', Message.PanelClosed({panel: 'note'}))
				.children('Open link'),
		Button(h, {disabled: state.pending})
			.attr('role', 'menuitem')
			.on('click', Message.Run({action: Action.cases.Regenerate.make({id: note.id})}))
			.children('Regenerate')
	])
		.attr('role', 'menu')
		.popover('auto', state.panel === 'note')
		.on('toggle', event => {
			if (!event.open) return Message.PanelClosed({panel: 'note'})
			return undefined
		})
}

function Compose(h: H, state: Model) {
	if (!state.composing) return undefined
	return Sheet(h, {
		action: Glass(h).children(
			Button(h, {disabled: state.pending || String.isEmpty(String.trim(state.draft)), type: 'submit'})
				.attr('aria-label', 'Save')
				.children(SymbolIcon(h, 'checkmark'))
		),
		body: h.textarea
			.attrs({'aria-label': 'Write a note', maxlength: '20000', placeholder: 'Write a note'})
			.value(state.draft)
			.on('input', event => Message.Draft({text: event.value})),
		className: 'stash-sheet',
		close: Message.Compose({open: false}),
		submit: Message.Run({action: Action.cases.Capture.make({text: state.draft})}),
		title: 'New note',
		titleId: 'stash-compose-note'
	})
}

function detailContent(h: H, state: Model) {
	return ReadState(state.notes, {
		failed: () => Notice(h, 'Couldn’t load the note', Message.Retry()),
		loading: () => Loading(h, 'Loading note', h.div.class('stash-skeleton-note').attr('aria-hidden', 'true')),
		ready: (_, stale) => {
			if (state.selected !== undefined) return reader(h, state, state.selected, savedOf(state.selected, state.now))
			if (stale) return Notice(h, 'Couldn’t load the note', Message.Retry())
			if (StashRoute.isAnyOf(['Home'])(state.route) && state.route.search.note !== undefined) {
				return Notice(h, 'Note not found')
			}
			return undefined
		}
	})
}

function access(h: H, result: AsyncResult.AsyncResult<unknown, unknown>) {
	if (!AsyncResult.isFailure(result)) return undefined
	if (needsSignInCause(result.cause)) {
		return Notice(h, 'Sign in to Stash', Message.Run({action: Action.cases.SignIn.make({})}), 'Sign in')
	}
	if (isDeniedCause(result.cause)) return Notice(h, 'Access denied', Message.Retry())
	return Notice(h, 'Couldn’t connect to Stash', Message.Retry())
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

function selection(state: Model) {
	if (state.narrow && showOf(state) === 'list') return undefined
	return state.selected
}

function sidebar(state: Model) {
	if (state.narrow && showOf(state) === 'detail') {
		return {
			id: 'sidebar',
			message: Message.Sidebar(),
			symbol: 'chevron.left',
			title: 'Back'
		} satisfies ShellAction<Message>
	}
	return {
		disabled: state.narrow && state.selected === undefined,
		id: 'sidebar',
		message: Message.Sidebar(),
		pressed: sidebarOpen(state),
		symbol: 'sidebar.left',
		title: 'Sidebar'
	} satisfies ShellAction<Message>
}

function queueActions(state: Model) {
	if (state.narrow && showOf(state) === 'detail') return []
	return [
		{
			disabled: state.pending,
			id: 'paste',
			message: Message.Run({action: Action.cases.Paste.make({})}),
			symbol: 'plus',
			title: 'Paste link'
		},
		{id: 'compose', message: Message.Compose({open: true}), symbol: 'square.and.pencil', title: 'New note'},
		{
			id: 'queue',
			menu: queueOptions(state),
			message: Message.Panel({panel: 'queue'}),
			symbol: 'line.3.horizontal.decrease',
			title: 'Queue options'
		}
	] satisfies readonly ShellAction<Message>[]
}

function actions(state: Model) {
	const note = selection(state)
	const queue = queueActions(state)
	if (note === undefined) return queue
	return [
		...queue,
		{
			disabled: state.pending,
			id: 'share',
			message: Message.Run({
				action: Action.cases.Share.make({text: Option.getOrUndefined(note.url) ?? (note.summary || note.title)})
			}),
			symbol: 'square.and.arrow.up',
			title: 'Share'
		},
		{
			id: 'note',
			menu: noteOptions(state, note),
			message: Message.Panel({panel: 'note'}),
			symbol: 'ellipsis',
			title: 'Note options'
		}
	] satisfies readonly ShellAction<Message>[]
}

function workspace(h: H, state: Model) {
	if (!StashRoute.isAnyOf(['Home'])(state.route)) {
		return h.main
			.class('stash-gate axis-controls')
			.onMount(PressFeedback({}))
			.children(
				Glass(h).children(h.a.class('stash-action').attrs({'data-pressable': '', href: '/'}).children('Back to Stash'))
			)
	}
	const gate = accessGate(h, state)
	const note = selection(state)
	return h.main
		.class('axis-controls')
		.onMount(PressFeedback({}))
		.children(
			Boolean.match(gate !== undefined, {
				onFalse: () =>
					ActionShell(h, {
						actions: actions(state),
						content: Split(h, {
							detail: {
								content: h.div.class('stash-reading').children(detailContent(h, state)),
								key: state.selected?.id ?? 'detail',
								label: 'Reader'
							},
							list: {
								content: h.div.class('stash-queue').children(notesContent(h, state)),
								label: 'Saved notes',
								position: {
									key: `${state.kind ?? ''}:${state.tag ?? ''}`,
									ready: Option.isSome(AsyncResult.value(state.notes))
								}
							},
							listHidden: state.listHidden,
							narrow: state.narrow,
							show: showOf(state)
						}),
						overlays: [
							!isNative && queueMenu(h, state),
							Compose(h, state),
							!isNative && note !== undefined && noteMenu(h, state, note)
						],
						sidebar: sidebar(state)
					}),
				onTrue: () => h.div.class('stash-gate').children(gate)
			}),
			state.problem !== undefined &&
				Glass(h, 'stash-report')
					.attr('role', 'alert')
					.children(
						h.p.children(state.problem),
						Button(h).class('stash-action').on('click', Message.DismissProblem()).children('Dismiss')
					)
		)
}

function motion(previous: Model, next: Model) {
	if (!next.narrow || previous.narrow !== next.narrow) return 'axis-layout'
	if (showOf(next) === 'detail') return 'axis-open'
	return 'axis-back'
}

const StashDef = Html.component({
	message: Message,
	model: Model,
	name: 'Stash',
	props: Schema.Struct({route: StashRoute})
})

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
				narrow: singlePane(),
				notes: AsyncResult.initial(),
				now: DateTime.nowUnsafe(),
				panel: undefined,
				pending: false,
				problem: undefined,
				revision: 0,
				route: context.props.route,
				selected: undefined,
				tag: undefined
			}
			if (isNative) return context.set(state).run(Wake.make({refresh: false}))
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
				...watchPanes(() => Message.Posture({narrow: singlePane()})),
				Router.subscription(StashRoute, context.model.route, route => Message.Route({route})),
				Subscription.make(
					'account',
					observe(sessionAccount, result => Message.Account({result}))
				),
				Subscription.make(
					'clock',
					observe(clockAtom('1 minute'), now => Message.Clock({now}))
				),
				isNative &&
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
			Compose: ($, message) => {
				if ($.model.composing === message.open) return $.model
				const next = $.evolve({composing: message.open, panel: undefined})
				if (message.open) return next.viewTransition(['axis-sheet-open'])
				return next.viewTransition(['axis-sheet-close'])
			},
			DismissProblem: $ => $.evolve({problem: undefined}),
			Draft: ($, message) => $.evolve({draft: message.text}).run(Command.asNoop(StoreDraft.make({text: message.text}))),
			FilterKind: ($, message) => $.set(select({...$.model, kind: message.kind, panel: undefined})),
			FilterTag: ($, message) => {
				if (!StashRoute.isAnyOf(['Home'])($.model.route)) return $.model
				const next = $.set(select({...$.model, listHidden: false, panel: undefined, tag: message.tag}))
				if ($.model.narrow && showOf($.model) === 'detail') {
					return next.run(Command.asNoop(Router.patchSearch(StashRoute, $.model.route, {pane: 'list'})))
				}
				return next
			},
			Media: ($, message) => {
				if ($.model.selected?.id !== message.id) return $.model
				return $.evolve({media: message.result})
			},
			Notes: ($, message) => $.set(select({...$.model, notes: message.result})),
			Open: ($, message) => {
				if (!StashRoute.isAnyOf(['Home'])($.model.route)) return $.model
				return $.evolve({composing: false, listHidden: false}).run(
					Command.asNoop(
						Router.patchSearch(
							StashRoute,
							$.model.route,
							{note: message.id, pane: 'detail'},
							{
								history: Boolean.match(showOf($.model) === 'list', {
									onFalse: Function.constant('replace'),
									onTrue: Function.constant('push')
								})
							}
						)
					)
				)
			},
			...panelUpdates<Model, Message>(),
			Problem: ($, message) => $.evolve({problem: message.text}),
			Retry: $ => $.run(Command.asNoop(Refresh.make({item: $.model.selected}))),
			Route: ($, message) => {
				const next = select({
					...$.model,
					listHidden:
						StashRoute.isAnyOf(['Home'])(message.route) && message.route.search.pane === 'detail' && $.model.listHidden,
					panel: undefined,
					route: message.route
				})
				const changedPane = showOf(next) !== showOf($.model)
				const changedNote = next.selected?.id !== $.model.selected?.id
				const result = $.set(next)
				if (usedHistoryMotion()) return result
				if (changedPane || (!next.narrow && changedNote)) return result.viewTransition([motion($.model, next)])
				return result
			},
			Run: ($, message) => {
				if (
					$.model.pending ||
					(Action.isAnyOf(['Capture'])(message.action) && String.isEmpty(String.trim(message.action.text)))
				) {
					return $.model
				}
				return $.evolve({panel: undefined, pending: true, problem: undefined}).run(
					RunAction.make({action: message.action})
				)
			},
			Settled: ($, message) => {
				const next = $.evolve({pending: false, problem: message.problem})
				if (message.problem !== undefined) return next
				if (Action.isAnyOf(['SignIn'])(message.action) && isNative) return next.run(Wake.make({refresh: false}))
				if (!Action.isAnyOf(['Capture'])(message.action)) return next
				const close = next.evolve({composing: false}).viewTransition(['axis-sheet-close'])
				if ($.model.draft !== message.action.text) return close
				return close.evolve({draft: ''}).run(Command.asNoop(StoreDraft.make({text: ''})))
			},
			Sidebar: $ => {
				if (!StashRoute.isAnyOf(['Home'])($.model.route)) return $.model
				if ($.model.narrow && showOf($.model) === 'detail') {
					if (
						hasHistoryBehind(previous => {
							if (previous.pathname !== '/') return false
							const pane = previous.searchParams.get('pane')
							return pane === 'list' || (pane === null && !previous.searchParams.has('note'))
						})
					) {
						return $.run(historyBack)
					}
					return $.run(Command.asNoop(Router.patchSearch(StashRoute, $.model.route, {pane: 'list'})))
				}
				const hide = sidebarOpen($.model)
				if ($.model.narrow) {
					return $.run(
						Command.asNoop(
							Router.patchSearch(
								StashRoute,
								$.model.route,
								{note: $.model.selected?.id, pane: 'detail'},
								{history: 'push'}
							)
						)
					)
				}
				return $.evolve({listHidden: hide, panel: undefined}).viewTransition(['axis-layout'])
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
