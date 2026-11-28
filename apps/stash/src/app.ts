import {Command, Component, Router, Subscription, UiSchema} from '@effect/ui'

import {Boolean, Function, Option, Predicate, Schema, Stream, String, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {chooseToolbar} from '@deslop/components/model'
import {isDeniedCause} from '@deslop/runtime/client/live-stream'
import {Authenticate, Refresh, SignOut, selection, shellApp, slide} from '@deslop/runtime/client/shell'
import type {AppScreen} from '@deslop/runtime/client/shell'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {
	Action,
	BackToQueue,
	ReadDraft,
	Run,
	StashRoute,
	StoreDraft,
	Wake,
	activated,
	noteOf,
	readStash,
	showsDetail
} from './reads.ts'

import {Kind, NoteId, TagName} from '#notes/contract.ts'
import type {NoteItem} from '#notes/contract.ts'
import {NotesModel, gatedReads, notesFields, notesScreen, select} from '#notes/screen.ts'

const Message = UiSchema.TaggedEnum({
	Account: {result: notesFields.account},
	Back: {},
	Body: {id: NoteId, result: notesFields.body},
	Choose: {id: Schema.String},
	Compose: {open: Schema.Boolean},
	DismissProblem: {},
	Draft: {text: Schema.String},
	Failed: {text: Schema.String},
	FilterTag: {tag: Schema.UndefinedOr(TagName)},
	Media: {id: NoteId, result: notesFields.media},
	Notes: {result: notesFields.notes},
	Open: {id: Schema.String},
	Problem: {text: Schema.UndefinedOr(Schema.String)},
	Restored: {text: Schema.String},
	Route: {route: StashRoute},
	Run: {action: Action},
	Settled: {action: Action, problem: Schema.UndefinedOr(Schema.String)},
	SignIn: {},
	SignedIn: {signedIn: Schema.Boolean},
	SignedOut: {},
	Wake: {}
})

type Message = typeof Message.Type

type Step = Component.Step<NotesModel, Message, never>

// Ends the shared session unless an action is under way; the page or the iPhone reads the account again once it has.
function signOut($: Step) {
	if ($.model.pending) return $.model
	return $.evolve({pending: true, problem: undefined}).run(
		pipe(
			SignOut.make({}),
			Command.match({onFailure: error => Message.Failed({text: error.message}), onSuccess: () => Message.SignedOut()})
		)
	)
}

function run(action: Action) {
	return pipe(
		Run.make({action}),
		Command.map(problem => Message.Settled({action, problem}))
	)
}

function readerAction(note: NoteItem, id: string) {
	if (id === 'regenerate') return Action.cases.Regenerate.make({id: note.id})
	if (id === 'share') {
		return Action.cases.Share.make({text: Option.getOrUndefined(note.url) ?? (note.summary || note.title)})
	}
	if (id === 'open-link') {
		return pipe(
			note.url,
			Option.map(url => Action.cases.OpenLink.make({url})),
			Option.getOrUndefined
		)
	}
	return undefined
}

// Starts what the person asked of a note, unless another action is under way.
function start($: Step, action: Action) {
	if ($.model.pending) return $.model
	return $.evolve({pending: true, problem: undefined}).run(run(action))
}

// The queue narrowed by a source or tag choice, or none when the choice names neither.
function filtered($: Step, id: string) {
	if (id === 'source-all') return $.set(select({...$.model, kind: undefined}))
	if (id === 'all-tags') return $.set(select({...$.model, tag: undefined}))
	const kind = String.slice('source-'.length)(id)
	if (String.startsWith('source-')(id) && Schema.is(Kind)(kind)) return $.set(select({...$.model, kind}))
	const tag = String.slice('tag-'.length)(id)
	if (String.startsWith('tag-')(id) && Schema.is(TagName)(tag)) return $.set(select({...$.model, tag}))
	return undefined
}

// What a toolbar or menu choice does, from the notes on screen.
function chosen($: Step, id: string) {
	if (id === 'compose') return $.evolve({composing: true})
	if (id === 'compose-cancel') return $.evolve({composing: false})
	if (id === 'compose-save') {
		if (String.isEmpty(String.trim($.model.draft))) return $.model
		return start($, Action.cases.Capture.make({text: $.model.draft}))
	}
	if (id === 'paste') return start($, Action.cases.Paste.make({}))
	if (id === 'sign-out') return signOut($)
	const narrowed = filtered($, id)
	if (narrowed !== undefined) return narrowed
	if ($.model.selected === undefined) return $.model
	const action = readerAction($.model.selected, id)
	if (action === undefined) return $.model
	return start($, action)
}

const Screen = Component.define({
	message: Message,
	model: NotesModel,
	name: 'Stash',
	props: Schema.Struct({now: DateTimeUtcFromFiniteMillis, route: StashRoute})
}).make({
	init: $ =>
		$.set({
			account: AsyncResult.initial(),
			body: AsyncResult.initial(),
			composing: false,
			draft: '',
			kind: undefined,
			media: AsyncResult.initial(),
			notes: AsyncResult.initial(),
			pending: false,
			problem: undefined,
			revision: 0,
			route: $.props.route,
			selected: undefined,
			tag: undefined
		}).run(Command.map(ReadDraft.make({}), text => Message.Restored({text}))),
	parts: (p, model) => {
		const routeMissing = StashRoute.isAnyOf(['NotFound'])(model.route)
		return {
			...notesScreen(model, p.props.now),
			choose: p.part(chooseToolbar<Message>(Message.Choose)),
			dismiss: p.part((el, event: string) =>
				el.on(
					event,
					Message.Compose({open: false}),
					Boolean.match(event === 'cancel', {
						onFalse: Function.constUndefined,
						onTrue: () => ({preventDefault: true as const})
					})
				)
			),
			dismissProblem: p.part((el, event: string) => el.on(event, Message.DismissProblem())),
			draftInput: p.part((el, event: string) =>
				el.on(event, payload => {
					if (Predicate.hasProperty(payload, 'value') && Predicate.isString(payload.value)) {
						return Message.Draft({text: payload.value})
					}
					return undefined
				})
			),
			filter: p.part((el, event: string, tag?: TagName) =>
				el.on(
					event,
					Message.FilterTag({
						tag: Boolean.match(tag === model.tag, {onFalse: () => tag, onTrue: Function.constUndefined})
					})
				)
			),
			openLink: p.part((el, event: string, url: string) =>
				el.on(event, Message.Run({action: Action.cases.OpenLink.make({url})}))
			),
			// A blocking refusal or outage on the account, or a refusal of the notes, is what the shell judges; a route that is not one comes first.
			reads: Boolean.match(routeMissing, {onFalse: () => gatedReads(model), onTrue: () => []}),
			routeMissing,
			save: p.part((el, event: string) =>
				el.on(event, Message.Run({action: Action.cases.Capture.make({text: model.draft})}))
			),
			selection: selection(p, {
				back: Message.Back(),
				id: noteOf(model.route) ?? 'note',
				open: showsDetail(model.route),
				select: id => Message.Open({id})
			}),
			signIn: p.part((el, event: string) => el.on(event, Message.SignIn()))
		}
	},
	subscriptions: $ => {
		const admitted =
			Option.isSome(AsyncResult.value($.model.account)) &&
			!(AsyncResult.isFailure($.model.account) && isDeniedCause($.model.account.cause))
		const item = pipe(
			Option.fromUndefinedOr($.model.selected),
			Option.filter(() => admitted),
			Option.getOrUndefined
		)
		return [
			Router.subscription(StashRoute, $.model.route, route => Message.Route({route})),
			Subscription.make(
				'account',
				readStash(
					reads => reads.account,
					result => Message.Account({result})
				)
			),
			Subscription.make(
				'activation',
				Stream.map(activated, () => Message.Wake())
			),
			admitted &&
				Subscription.make(
					'notes',
					readStash(
						reads => reads.notesAtom,
						result => Message.Notes({result})
					)
				),
			item !== undefined &&
				Subscription.make('body', [item.id, $.model.revision], () =>
					readStash(
						reads => reads.bodyAtoms(item),
						result => Message.Body({id: item.id, result})
					)
				),
			item !== undefined &&
				Subscription.make('media', [item.id, $.model.revision], () =>
					readStash(
						reads => reads.mediaAtoms(item),
						result => Message.Media({id: item.id, result})
					)
				)
		]
	},
	update: {
		Account: ($, input) => {
			if (!(AsyncResult.isFailure(input.result) && isDeniedCause(input.result.cause))) {
				return $.evolve({account: input.result})
			}
			return $.evolve({
				account: input.result,
				body: AsyncResult.initial(),
				media: AsyncResult.initial(),
				notes: AsyncResult.initial(),
				selected: undefined
			})
		},
		Back: $ => $.run(Command.asNoop(BackToQueue.make({narrowOnly: false}))),
		Body: ($, input) => {
			if (
				$.model.selected?.id !== input.id ||
				(AsyncResult.isInitial(input.result) && !AsyncResult.isInitial($.model.body))
			) {
				return $.model
			}
			if (AsyncResult.isFailure(input.result) && !isDeniedCause(input.result.cause)) {
				return $.evolve({
					body: AsyncResult.failureWithPrevious(input.result.cause, {previous: Option.some($.model.body)})
				})
			}
			return $.evolve({body: input.result})
		},
		Choose: ($, input) => chosen($, input.id),
		Compose: ($, input) => $.evolve({composing: input.open}),
		DismissProblem: $ => $.evolve({problem: undefined}),
		Draft: ($, input) => $.evolve({draft: input.text}).run(Command.asNoop(StoreDraft.make({text: input.text}))),
		Failed: ($, input) => $.evolve({pending: false, problem: input.text}),
		FilterTag: ($, input) => {
			const next = $.set(select({...$.model, tag: input.tag}))
			if (showsDetail($.model.route)) return next.run(Command.asNoop(BackToQueue.make({narrowOnly: true})))
			return next
		},
		Media: ($, input) => {
			if ($.model.selected?.id !== input.id) return $.model
			return $.evolve({media: input.result})
		},
		Notes: ($, input) => $.set(select({...$.model, notes: input.result})),
		Open: ($, input) => {
			if (!StashRoute.isAnyOf(['Home'])($.model.route) || !Schema.is(NoteId)(input.id)) return $.model
			const route = StashRoute.Home({search: {note: input.id, pane: 'detail'}})
			const navigate = Boolean.match(showsDetail($.model.route), {
				onFalse: () => Router.push(StashRoute, route),
				onTrue: () => Router.replace(StashRoute, route)
			})
			return $.evolve({composing: false}).run(Command.asNoop(navigate))
		},
		Problem: ($, input) => {
			if (input.text === undefined) return $.model
			return $.evolve({problem: input.text})
		},
		Restored: ($, input) => $.evolve({draft: input.text}),
		Route: ($, input) => {
			const next = $.set(select({...$.model, route: input.route}))
			if (showsDetail(input.route) !== showsDetail($.model.route)) {
				return slide(next, showsDetail, $.model.route, input.route)
			}
			return next.viewTransition(['design-layout'])
		},
		Run: ($, input) => {
			if (
				$.model.pending ||
				(Action.isAnyOf(['Capture'])(input.action) && String.isEmpty(String.trim(input.action.text)))
			) {
				return $.model
			}
			return $.evolve({pending: true, problem: undefined}).run(run(input.action))
		},
		Settled: ($, input) => {
			const next = $.evolve({pending: false, problem: input.problem})
			if (input.problem !== undefined || !Action.isAnyOf(['Capture'])(input.action)) return next
			const close = next.evolve({composing: false})
			if ($.model.draft !== input.action.text) return close
			return close.evolve({draft: ''}).run(Command.asNoop(StoreDraft.make({text: ''})))
		},
		SignIn: $ => {
			if ($.model.pending) return $.model
			return $.evolve({pending: true, problem: undefined}).run(
				pipe(
					Authenticate.make({}),
					Command.match({
						onFailure: error => Message.Failed({text: error.message}),
						onSuccess: signedIn => Message.SignedIn({signedIn})
					})
				)
			)
		},
		SignedIn: ($, input) => {
			const next = $.evolve({pending: false})
			if (!input.signedIn) return next
			return next.run(
				Command.asNoop(Refresh.make({authenticated: true})),
				Command.map(Wake.make({refresh: false}), text => Message.Problem({text}))
			)
		},
		SignedOut: $ => $.evolve({pending: false}).run(Command.asNoop(Refresh.make({authenticated: true}))),
		Wake: $ => $.run(Command.map(Wake.make({refresh: true}), text => Message.Problem({text})))
	}
})

export type StashScreen = AppScreen<Component.Headless.Parts<typeof Screen>>
export type Reader = NonNullable<StashScreen['detail']>

export const StashApp = shellApp({
	every: '1 minute',
	missing: 'Back to Stash',
	name: 'Stash',
	props: Schema.Struct({route: StashRoute}),
	screen: Screen
})
