import {Command, Component, Router, Subscription, UiSchema} from '@effect/ui'
import type {View} from '@effect/ui'

import {
	Array,
	Boolean,
	Cause,
	Context,
	DateTime,
	Effect,
	Equal,
	Function,
	Layer,
	Option,
	Predicate,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'
import type {Atom} from 'effect/reactivity'

import type {Selection, ToolbarAction, ToolbarOptions} from '@deslop/design/model'
import {chooseToolbar, defineSelection} from '@deslop/design/model'
import {observe, refreshFailed} from '@deslop/runtime/client/atom'
import {clockAtom} from '@deslop/runtime/client/clock'
import {blockingFailure, isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {AuthError} from '@deslop/runtime/shared/auth'
import {Account} from '@deslop/runtime/shared/schema'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import type {NotesError} from '#contracts'
import {Kind, Note, NoteId, NoteItem, TagName} from '#contracts'

import {kindOf, kinds, sourceLabelOf, subjectOf, tagCounts} from '#screens/kinds.ts'
import {isWebLink, issueOf, pathsOf, rowOf, savedOf} from '#screens/note.ts'
import type {makeReads} from '#screens/reads.ts'
import {BackToQueue, StashRoute, showsDetail} from '#screens/routes.ts'

const ReadAccount = AsyncResult.Schema({error: AuthError, success: Account})
const ReadNotes = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(NoteItem.json)})
const ReadBody = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Struct({body: Note.json.fields.body})})
const ReadMedia = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Finite})

type Model = typeof Model.Type
const Model = Schema.Struct({
	account: ReadAccount,
	body: ReadBody,
	composing: Schema.Boolean,
	draft: Schema.String,
	kind: Schema.UndefinedOr(Kind),
	media: ReadMedia,
	notes: ReadNotes,
	now: DateTimeUtcFromFiniteMillis,
	pending: Schema.Boolean,
	problem: Schema.UndefinedOr(Schema.String),
	revision: Schema.Int,
	route: StashRoute,
	selected: Schema.UndefinedOr(NoteItem.json),
	tag: Schema.UndefinedOr(TagName)
})

type Action = typeof Action.Type
const Action = Schema.TaggedUnion({
	Capture: {text: Schema.String},
	OpenLink: {url: Schema.String},
	Paste: {},
	Regenerate: {id: NoteId},
	Share: {text: Schema.String},
	SignIn: {},
	SignOut: {}
})

const Message = UiSchema.TaggedEnum({
	Account: {result: ReadAccount},
	Back: {},
	Body: {id: NoteId, result: ReadBody},
	Choose: {id: Schema.String},
	Clock: {now: DateTimeUtcFromFiniteMillis},
	Compose: {open: Schema.Boolean},
	DismissProblem: {},
	Draft: {text: Schema.String},
	FilterKind: {kind: Schema.UndefinedOr(Kind)},
	FilterTag: {tag: Schema.UndefinedOr(TagName)},
	Media: {id: NoteId, result: ReadMedia},
	Notes: {result: ReadNotes},
	Open: {id: NoteId},
	Problem: {text: Schema.UndefinedOr(Schema.String)},
	Retry: {},
	Route: {route: StashRoute},
	Run: {action: Action},
	Settled: {action: Action, problem: Schema.UndefinedOr(Schema.String)},
	Wake: {}
})
export type StashMessage = typeof Message.Type

export type Platform<R = never> = {
	account: Atom.Atom<AsyncResult.AsyncResult<Account, AuthError>>
	activation: Stream.Stream<void>
	narrow: () => boolean
	openLink: (url: string) => Effect.Effect<void, NotesError>
	paste: Effect.Effect<Option.Option<string>, NotesError, R>
	readDraft: () => string
	settleShares: Effect.Effect<readonly string[], NotesError>
	share: (text: string) => Effect.Effect<void, NotesError>
	signIn: Effect.Effect<boolean, AuthError>
	signOut: Effect.Effect<void, AuthError, R>
	writeDraft: (text: string) => void
}

function allNotes(state: Model) {
	return Option.getOrElse(AsyncResult.value(state.notes), Array.empty<NoteItem>)
}

function visibleNotes(state: Model) {
	return Array.filter(
		allNotes(state),
		note =>
			(state.kind === undefined || kindOf(note) === state.kind) &&
			(state.tag === undefined || Array.contains(note.tags, state.tag))
	)
}

function select(model: Model) {
	const selected = Option.getOrUndefined(
		StashRoute.match(model.route, {
			Home: route => {
				if (route.search.note === undefined) return Array.head(visibleNotes(model))
				return Array.findFirst(allNotes(model), note => note.id === route.search.note)
			},
			NotFound: () => Option.none()
		})
	)
	if (Equal.equals(selected, model.selected)) return model
	const next = {...model, revision: model.revision + 1, selected}
	if (selected?.id === model.selected?.id) return next
	return {...next, body: AsyncResult.initial(), media: AsyncResult.initial()}
}

function problemText(cause: Cause.Cause<unknown>) {
	const error = Cause.squash(cause)
	if (Predicate.hasProperty(error, 'message') && Predicate.isString(error.message)) return error.message
	return 'Stash could not complete this action.'
}

function gate(state: Model) {
	return pipe(
		blockingFailure(state.account),
		Option.orElse(() => Option.filter(blockingFailure(state.notes), isDeniedCause)),
		Option.match({
			onNone: Function.constUndefined,
			onSome: cause => {
				if (needsSignInCause(cause)) return {message: 'Sign in to Stash', signIn: true}
				if (isDeniedCause(cause)) return {message: 'Access denied', signIn: false}
				return {message: 'Couldn’t connect to Stash', signIn: false}
			}
		})
	)
}

function readerRetry(state: Model) {
	if (AsyncResult.isFailure(state.body)) return 'Note body unavailable'
	if (AsyncResult.isFailure(state.media)) return 'Pictures unavailable'
	return undefined
}

function readerStatus(note: NoteItem) {
	if (note.status === 'failed') return issueOf(note)
	if (note.status === 'organizing') return `Reading this ${subjectOf(note)}…`
	return undefined
}

function denied(result: AsyncResult.AsyncResult<unknown, unknown>) {
	return AsyncResult.isFailure(result) && isDeniedCause(result.cause)
}

function reader(state: Model) {
	const note = state.selected
	if (note === undefined) return undefined
	const notes = allNotes(state)
	return {
		body: Option.getOrUndefined(Option.flatMap(AsyncResult.value(state.body), full => full.body)),
		denied: denied(state.body) || denied(state.media),
		id: note.id,
		kind: kindOf(note),
		loading: AsyncResult.isInitial(state.body) && note.status === 'ready',
		pictures: pathsOf(note, Option.getOrElse(AsyncResult.value(state.media), Function.constant(0))),
		related: pipe(
			notes,
			Array.filter(item => item.id !== note.id && Array.some(item.tags, tag => Array.contains(note.tags, tag))),
			Array.take(4),
			Array.map(item => rowOf(item, state.now))
		),
		retry: readerRetry(state),
		saved: savedOf(note, state.now),
		source: sourceLabelOf(note),
		status: readerStatus(note),
		statusFailed: note.status === 'failed',
		summary: note.summary,
		tags: Array.map(note.tags, tag => ({count: Array.countBy(notes, item => Array.contains(item.tags, tag)), tag})),
		title: note.title
	}
}

function queueNote(state: Model) {
	if (Option.isSome(blockingFailure(state.notes))) return 'Couldn’t load notes'
	if (AsyncResult.isFailure(state.notes)) return 'Notes may be out of date'
	if (AsyncResult.isInitial(state.notes) || Array.isReadonlyArrayNonEmpty(visibleNotes(state))) return undefined
	if (state.kind !== undefined || state.tag !== undefined) return 'No notes match'
	return 'No saved notes'
}

function detailActions(state: Model) {
	if (state.selected === undefined) return []
	return [
		{disabled: state.pending, id: 'share', label: 'Share', symbol: 'square.and.arrow.up'},
		{
			id: 'note-options',
			label: 'Note options',
			menu: [
				...Array.fromOption(
					pipe(
						state.selected.url,
						Option.filter(isWebLink),
						Option.map(() => ({id: 'open-link', label: 'Open link'}))
					)
				),
				{disabled: state.pending, id: 'regenerate', label: 'Regenerate'}
			],
			symbol: 'ellipsis'
		}
	] satisfies readonly ToolbarAction[]
}

function queueActions(state: Model) {
	return [
		{disabled: state.pending, id: 'paste', label: 'Paste link', symbol: 'doc.on.clipboard'},
		{id: 'compose', label: 'New note', symbol: 'square.and.pencil'},
		{
			id: 'queue-options',
			label: 'Queue options',
			menu: [
				{checked: state.kind === undefined, id: 'source-all', label: 'All sources'},
				...Array.map(Kind.literals, kind => ({checked: state.kind === kind, id: `source-${kind}`, label: kinds[kind]})),
				{checked: state.tag === undefined, id: 'all-tags', label: 'All tags'},
				...Array.map(tagCounts(allNotes(state)), entry => ({
					checked: state.tag === entry.tag,
					id: `tag-${entry.tag}`,
					label: entry.tag
				})),
				...Array.fromOption(
					pipe(
						AsyncResult.value(state.account),
						Option.filter(account => account.signOut),
						Option.map(() => ({disabled: state.pending, id: 'sign-out', label: 'Sign out'}))
					)
				)
			],
			symbol: 'line.3.horizontal.decrease'
		}
	] satisfies readonly ToolbarAction[]
}

export const dismissCompose = Message.Compose({open: false})
export const dismissProblem = Message.DismissProblem()
export const retry = Message.Retry()
export const signIn = Message.Run({action: Action.cases.SignIn.make({})})
export function editDraft(text: string) {
	return Message.Draft({text})
}
export function openLink(url: string) {
	return Message.Run({action: Action.cases.OpenLink.make({url})})
}

type SelectionParts = Selection & {choose: ToolbarOptions['choose']; dismiss: Selection['back']}

function saveDisabled(state: Model) {
	return state.pending || String.isEmpty(String.trim(state.draft))
}

function saveDraft(state: Model) {
	return Message.Run({action: Action.cases.Capture.make({text: state.draft})})
}

function filterAction(id: string) {
	if (id === 'source-all') return Message.FilterKind({kind: undefined})
	if (id === 'all-tags') return Message.FilterTag({tag: undefined})
	const kind = String.slice('source-'.length)(id)
	if (String.startsWith('source-')(id) && Schema.is(Kind)(kind)) return Message.FilterKind({kind})
	const tag = String.slice('tag-'.length)(id)
	if (String.startsWith('tag-')(id) && Schema.is(TagName)(tag)) return Message.FilterTag({tag})
	return undefined
}

function readerAction(note: NoteItem, id: string) {
	if (id === 'regenerate') return Message.Run({action: Action.cases.Regenerate.make({id: note.id})})
	if (id === 'share') {
		return Message.Run({
			action: Action.cases.Share.make({text: Option.getOrUndefined(note.url) ?? (note.summary || note.title)})
		})
	}
	if (id === 'open-link') {
		return pipe(note.url, Option.filter(isWebLink), Option.map(openLink), Option.getOrUndefined)
	}
	return undefined
}

function selectedAction(state: Model, id: string) {
	if (id === 'compose') return Message.Compose({open: true})
	if (id === 'compose-cancel') return dismissCompose
	if (id === 'compose-save' && !saveDisabled(state)) return saveDraft(state)
	if (id === 'paste') return Message.Run({action: Action.cases.Paste.make({})})
	if (id === 'sign-out') return Message.Run({action: Action.cases.SignOut.make({})})
	const filter = filterAction(id)
	if (filter !== undefined) return filter
	if (state.selected === undefined) return undefined
	return readerAction(state.selected, id)
}

function screenOf(state: Model, selection: SelectionParts) {
	const detail = reader(state)
	const opened = showsDetail(state.route)
	const id = StashRoute.match(state.route, {Home: route => route.search.note, NotFound: Function.constUndefined})
	return {
		access: gate(state),
		composeToolbar: {
			actions: [
				{disabled: state.pending, id: 'compose-cancel', label: 'Cancel', symbol: 'xmark'},
				{disabled: saveDisabled(state), id: 'compose-save', label: 'Save', symbol: 'checkmark'}
			],
			choose: selection.choose
		} satisfies ToolbarOptions,
		composing: state.composing,
		detail,
		detailFailed: Option.isSome(blockingFailure(state.notes)),
		detailLoading: AsyncResult.isInitial(state.notes),
		detailMissing: id !== undefined && detail === undefined && AsyncResult.isSuccess(state.notes),
		dismiss: selection.dismiss,
		draft: state.draft,
		filter: (tag?: TagName) =>
			Message.FilterTag({
				tag: pipe(
					Option.fromUndefinedOr(tag),
					Option.filter(value => value !== state.tag),
					Option.getOrUndefined
				)
			}),
		list: {
			loading: AsyncResult.isInitial(state.notes),
			rows: Array.map(visibleNotes(state), note => rowOf(note, state.now))
		},
		notFound: StashRoute.isAnyOf(['NotFound'])(state.route),
		opened,
		pending: state.pending,
		problem: state.problem,
		queueMessage: queueNote(state),
		queueRetryable: AsyncResult.isFailure(state.notes),
		save: saveDraft(state),
		saveDisabled: saveDisabled(state),
		selection: {
			...selection,
			id: Boolean.match(opened, {onFalse: Function.constUndefined, onTrue: () => id ?? 'note'})
		},
		tag: state.tag,
		tags: tagCounts(allNotes(state)),
		toolbar: {detail: detailActions(state), queue: {actions: queueActions(state), choose: selection.choose}}
	}
}

export type StashScreen = ReturnType<typeof screenOf>
export type Reader = NonNullable<StashScreen['detail']>

const Select = defineSelection('StashSelection', Message).make({
	init: Function.constUndefined,
	parts: p => ({
		back: p.part((el, event: string) => el.on(event, Message.Back())),
		choose: p.part(chooseToolbar<typeof Message.Type>(Message.Choose)),
		dismiss: p.part((el, event: string) =>
			el.on(
				event,
				dismissCompose,
				Boolean.match(event === 'cancel', {
					onFalse: Function.constUndefined,
					onTrue: () => ({preventDefault: true as const})
				})
			)
		),
		id: p.props.id,
		select: p.part((el, event: string, id: string) =>
			el.on(event, () => {
				if (!Schema.is(NoteId)(id)) return undefined
				return Message.Open({id})
			})
		)
	}),
	update: ($, message) => $.set(undefined).emit(message)
})

class RunAction extends Command.Service<RunAction>()('Stash/Run', {args: {action: Action}, success: Message}) {}

class Refresh extends Command.Service<Refresh>()('Stash/Retry', {args: {item: Schema.UndefinedOr(NoteItem.json)}}) {}

class Wake extends Command.Service<Wake>()('Stash/Wake', {args: {refresh: Schema.Boolean}, success: Message}) {}

export function makeStash<V extends View.Elements, IO>(
	elements: View.Vocabulary<V>,
	platform: Platform<IO>,
	reads: ReturnType<typeof makeReads>,
	render: (h: View.WithTags<StashMessage, unknown, V>, screen: StashScreen) => View.Content<StashMessage>
) {
	const StoreDraft = Command.make('Stash/StoreDraft', {args: {text: Schema.String}}, request =>
		Effect.sync(() => platform.writeDraft(request.text))
	)

	const layerRun = RunAction.toLayer(
		Effect.map(Effect.context<AtomRegistry.AtomRegistry | IO>(), context => {
			const registry = Context.get(context, AtomRegistry.AtomRegistry)
			function authChanged() {
				return Effect.sync(() => {
					reads.reconnect(registry)
					registry.refresh(platform.account)
				})
			}
			return request =>
				pipe(
					Action.match(request.action, {
						Capture: input => Effect.asVoid(reads.capture(registry, String.trim(input.text))),
						OpenLink: input => platform.openLink(input.url),
						Paste: () =>
							Effect.flatMap(
								platform.paste,
								Option.match({onNone: () => Effect.void, onSome: text => Effect.asVoid(reads.capture(registry, text))})
							),
						Regenerate: input => reads.regenerate(registry, input.id),
						Share: input => platform.share(input.text),
						SignIn: () =>
							Effect.flatMap(platform.signIn, signedIn => {
								if (!signedIn) return Effect.void
								return authChanged()
							}),
						SignOut: () => Effect.andThen(platform.signOut, authChanged())
					}),
					Effect.matchCause({
						onFailure: cause => Message.Settled({action: request.action, problem: problemText(cause)}),
						onSuccess: () => Message.Settled({action: request.action, problem: undefined})
					}),
					Effect.provideContext(context)
				)
		})
	)

	const layerRefresh = Refresh.toLayer(
		AtomRegistry.AtomRegistry.useSync(
			registry => request =>
				Effect.sync(() => {
					registry.refresh(platform.account)
					refreshFailed(registry, reads.notesAtom)
					if (request.item !== undefined) {
						refreshFailed(registry, reads.bodyAtoms(request.item))
						refreshFailed(registry, reads.mediaAtoms(request.item))
					}
				})
		)
	)

	const layerWake = Wake.toLayer(
		AtomRegistry.AtomRegistry.useSync(
			registry => request =>
				Effect.gen(function* () {
					if (request.refresh) registry.refresh(platform.account)
					const account = yield* Effect.option(
						AtomRegistry.getResult(registry, platform.account, {suspendOnWaiting: true})
					)
					if (Option.isNone(account)) return Message.Problem({text: undefined})
					return yield* Effect.match(platform.settleShares, {
						onFailure: error => Message.Problem({text: error.message}),
						onSuccess: rejections =>
							Message.Problem({
								text: pipe(
									Option.liftPredicate(rejections, Array.isReadonlyArrayNonEmpty),
									Option.map(Array.join('\n')),
									Option.getOrUndefined
								)
							})
					})
				})
		)
	)

	return pipe(
		Component.withElements(elements)({
			message: Message,
			model: Model,
			name: 'Stash',
			props: Schema.Struct({route: StashRoute})
		}).make({
			init: $ => ({
				account: AsyncResult.initial(),
				body: AsyncResult.initial(),
				composing: false,
				draft: platform.readDraft(),
				kind: undefined,
				media: AsyncResult.initial(),
				notes: AsyncResult.initial(),
				now: DateTime.nowUnsafe(),
				pending: false,
				problem: undefined,
				revision: 0,
				route: $.props.route,
				selected: undefined,
				tag: undefined
			}),
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
						observe(platform.account, result => Message.Account({result}))
					),
					Subscription.make(
						'clock',
						observe(clockAtom('1 minute'), now => Message.Clock({now}))
					),
					Subscription.make(
						'activation',
						Stream.map(platform.activation, () => Message.Wake())
					),
					admitted &&
						Subscription.make(
							'notes',
							observe(reads.notesAtom, result => Message.Notes({result}))
						),
					item !== undefined &&
						Subscription.make('body', [item.id, $.model.revision], () =>
							observe(reads.bodyAtoms(item), result => Message.Body({id: item.id, result}))
						),
					item !== undefined &&
						Subscription.make('media', [item.id, $.model.revision], () =>
							observe(reads.mediaAtoms(item), result => Message.Media({id: item.id, result}))
						)
				]
			},
			update: {
				Account: ($, input) => {
					if (AsyncResult.isFailure(input.result) && isDeniedCause(input.result.cause)) {
						return $.evolve({
							account: input.result,
							body: AsyncResult.initial(),
							media: AsyncResult.initial(),
							notes: AsyncResult.initial(),
							selected: undefined
						})
					}
					return $.evolve({account: input.result})
				},
				Back: $ => $.run(Command.asNoop(BackToQueue.make({}))),
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
				Choose: ($, input) => {
					const message = selectedAction($.model, input.id)
					if (message === undefined) return $.model
					if (Message.isAnyOf(['Compose'])(message)) return $.evolve({composing: message.open})
					if (Message.isAnyOf(['FilterKind'])(message)) return $.set(select({...$.model, kind: message.kind}))
					if (Message.isAnyOf(['FilterTag'])(message)) return $.set(select({...$.model, tag: message.tag}))
					if (!Message.isAnyOf(['Run'])(message) || $.model.pending) return $.model
					return $.evolve({pending: true, problem: undefined}).run(RunAction.make({action: message.action}))
				},
				Clock: ($, input) => $.evolve({now: input.now}),
				Compose: ($, input) => $.evolve({composing: input.open}),
				DismissProblem: $ => $.evolve({problem: undefined}),
				Draft: ($, input) => $.evolve({draft: input.text}).run(Command.asNoop(StoreDraft.make({text: input.text}))),
				FilterKind: ($, input) => $.set(select({...$.model, kind: input.kind})),
				FilterTag: ($, input) => {
					const next = $.set(select({...$.model, tag: input.tag}))
					if (showsDetail($.model.route) && platform.narrow()) return next.run(Command.asNoop(BackToQueue.make({})))
					return next
				},
				Media: ($, input) => {
					if ($.model.selected?.id !== input.id) return $.model
					return $.evolve({media: input.result})
				},
				Notes: ($, input) => $.set(select({...$.model, notes: input.result})),
				Open: ($, input) => {
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
				Retry: $ => $.run(Command.asNoop(Refresh.make({item: $.model.selected}))),
				Route: ($, input) => {
					const next = $.set(select({...$.model, route: input.route}))
					if (showsDetail(input.route) && !showsDetail($.model.route)) return next.viewTransition(['design-detail-in'])
					if (!showsDetail(input.route) && showsDetail($.model.route)) return next.viewTransition(['design-detail-out'])
					return next.viewTransition(['design-layout'])
				},
				Run: ($, input) => {
					if (
						$.model.pending ||
						(Action.isAnyOf(['Capture'])(input.action) && String.isEmpty(String.trim(input.action.text)))
					) {
						return $.model
					}
					return $.evolve({pending: true, problem: undefined}).run(RunAction.make({action: input.action}))
				},
				Settled: ($, input) => {
					const next = $.evolve({pending: false, problem: input.problem})
					if (input.problem !== undefined) return next
					if (Action.isAnyOf(['SignIn'])(input.action)) return next.run(Wake.make({refresh: false}))
					if (!Action.isAnyOf(['Capture'])(input.action)) return next
					const close = next.evolve({composing: false})
					if ($.model.draft !== input.action.text) return close
					return close.evolve({draft: ''}).run(Command.asNoop(StoreDraft.make({text: ''})))
				},
				Wake: $ => $.run(Wake.make({refresh: true}))
			},
			view: (h, model) =>
				Select(h, {
					onEmit: message => message,
					props: {id: model.selected?.id},
					view: selection => render(h, screenOf(model, selection))
				})
		}),
		Component.provide(Layer.mergeAll(layerRun, layerRefresh, layerWake))
	)
}
