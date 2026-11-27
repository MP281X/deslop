import {Command, Component, Router, Subscription, UiSchema} from '@effect/ui'
import type {View} from '@effect/ui'

import {
	Array,
	Boolean,
	Cause,
	DateTime,
	Effect,
	Equal,
	Function,
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
import {clockAtom} from '@deslop/runtime/client/clock'
import {blockingFailure, isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {AuthError} from '@deslop/runtime/shared/auth'
import {Account} from '@deslop/runtime/shared/schema'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {Kind, Note, NoteId, NoteItem, NotesError, TagName} from '#contracts'

import {kindOf, kinds, sourceLabelOf, subjectOf, tagCounts} from '#screens/kinds.ts'
import {isWebLink, issueOf, pathsOf, rowOf, savedOf} from '#screens/note.ts'
import type {makeReads} from '#screens/reads.ts'
import {BackToQueue, StashRoute, showsDetail} from '#screens/routes.ts'

const ReadAccount = AsyncResult.Schema({error: AuthError, success: Account})
const ReadNotes = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(NoteItem.json)})
const ReadBody = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Struct({body: Note.json.fields.body})})
const ReadMedia = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Finite})

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
type Model = typeof Model.Type

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

type Platform = {
	account: Atom.Atom<AsyncResult.AsyncResult<Account, AuthError>>
	activation: Stream.Stream<void>
	narrow: () => boolean
	openLink: (url: string) => Effect.Effect<void, NotesError>
	paste: Effect.Effect<string | undefined, NotesError>
	readDraft: () => string
	settleShares: Effect.Effect<readonly string[], NotesError>
	share: (text: string) => Effect.Effect<void, NotesError>
	signIn: Effect.Effect<boolean, AuthError>
	signOut: Effect.Effect<void, AuthError>
	writeDraft: (text: string) => void
}

function observe<A, M>(atom: Atom.Atom<A>, read: (value: A) => M) {
	return Stream.unwrap(
		AtomRegistry.AtomRegistry.useSync(registry => pipe(registry, AtomRegistry.toStream(atom), Stream.map(read)))
	)
}

function refreshFailed<A, E>(registry: AtomRegistry.AtomRegistry, atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>) {
	if (AsyncResult.isFailure(registry.get(atom))) registry.refresh(atom)
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

function select(model: Model): Model {
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
	const failure = pipe(
		blockingFailure(state.account),
		Option.orElse(() => Option.filter(blockingFailure(state.notes), isDeniedCause))
	)
	return Option.match(failure, {
		onNone: Function.constUndefined,
		onSome: cause => {
			if (needsSignInCause(cause)) return {message: 'Sign in to Stash', signIn: true}
			if (isDeniedCause(cause)) return {message: 'Access denied', signIn: false}
			return {message: 'Couldn’t connect to Stash', signIn: false}
		}
	})
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

function detailActions(state: Model): readonly ToolbarAction[] {
	if (state.selected === undefined) return []
	return [
		{disabled: state.pending, id: 'share', label: 'Share', symbol: 'square.and.arrow.up'},
		{
			id: 'note-options',
			label: 'Note options',
			menu: [
				...Array.fromOption(
					Option.map(Option.filter(state.selected.url, isWebLink), () => ({id: 'open-link', label: 'Open link'}))
				),
				{disabled: state.pending, id: 'regenerate', label: 'Regenerate'}
			],
			symbol: 'ellipsis'
		}
	]
}

function queueActions(state: Model): readonly ToolbarAction[] {
	return [
		{disabled: state.pending, id: 'paste', label: 'Paste link', symbol: 'doc.on.clipboard'},
		{id: 'compose', label: 'New note', symbol: 'square.and.pencil'},
		{
			id: 'queue-options',
			label: 'Queue options',
			menu: [
				{id: 'source-all', label: 'All sources', checked: state.kind === undefined},
				...Array.map(Kind.literals, kind => ({id: `source-${kind}`, label: kinds[kind], checked: state.kind === kind})),
				{id: 'all-tags', label: 'All tags', checked: state.tag === undefined},
				...Array.map(tagCounts(allNotes(state)), ({tag}) => ({
					id: `tag-${tag}`,
					label: tag,
					checked: state.tag === tag
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
	]
}

function selectedAction(state: Model, id: string) {
	if (id === 'compose') return Message.Compose({open: true})
	if (id === 'compose-cancel') return dismissCompose
	if (id === 'compose-save' && !saveDisabled(state)) return saveDraft(state)
	if (id === 'paste') return Message.Run({action: Action.cases.Paste.make({})})
	if (id === 'sign-out') return Message.Run({action: Action.cases.SignOut.make({})})
	if (id === 'source-all') return Message.FilterKind({kind: undefined})
	if (id === 'all-tags') return Message.FilterTag({tag: undefined})
	const kind = String.slice('source-'.length)(id)
	if (String.startsWith('source-')(id) && Schema.is(Kind)(kind)) return Message.FilterKind({kind})
	const tag = String.slice('tag-'.length)(id)
	if (String.startsWith('tag-')(id) && Schema.is(TagName)(tag)) return Message.FilterTag({tag})

	const note = state.selected
	if (note === undefined) return undefined
	if (id === 'regenerate') return Message.Run({action: Action.cases.Regenerate.make({id: note.id})})
	if (id === 'share') {
		const text = Option.getOrUndefined(note.url) ?? (note.summary || note.title)
		return Message.Run({action: Action.cases.Share.make({text})})
	}
	if (id === 'open-link') return Option.map(Option.filter(note.url, isWebLink), openLink).pipe(Option.getOrUndefined)
	return undefined
}

export const dismissCompose = Message.Compose({open: false})
export const dismissProblem = Message.DismissProblem()
export const retry = Message.Retry()
export const signIn = Message.Run({action: Action.cases.SignIn.make({})})
export const editDraft = (text: string) => Message.Draft({text})
export const openLink = (url: string) => Message.Run({action: Action.cases.OpenLink.make({url})})

type SelectionParts = Selection & {choose: ToolbarOptions['choose']; dismiss: Selection['back']}

function saveDisabled(state: Model) {
	return state.pending || String.isEmpty(String.trim(state.draft))
}

function saveDraft(state: Model) {
	return Message.Run({action: Action.cases.Capture.make({text: state.draft})})
}

function screenOf(state: Model, selection: SelectionParts) {
	const detail = reader(state)
	const opened = showsDetail(state.route)
	const id = StashRoute.match(state.route, {Home: route => route.search.note, NotFound: Function.constUndefined})
	return {
		access: gate(state),
		composing: state.composing,
		composeToolbar: {
			actions: [
				{disabled: state.pending, id: 'compose-cancel', label: 'Cancel', symbol: 'xmark'},
				{disabled: saveDisabled(state), id: 'compose-save', label: 'Save', symbol: 'checkmark'}
			],
			choose: selection.choose
		} satisfies ToolbarOptions,
		detail,
		detailLoading: AsyncResult.isInitial(state.notes),
		detailMissing: id !== undefined && detail === undefined && AsyncResult.isSuccess(state.notes),
		detailFailed: Option.isSome(blockingFailure(state.notes)),
		dismiss: selection.dismiss,
		draft: state.draft,
		filter: (tag: TagName | undefined) =>
			Message.FilterTag({
				tag: Option.fromUndefinedOr(tag).pipe(
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
		tags: tagCounts(allNotes(state)),
		tag: state.tag,
		toolbar: {detail: detailActions(state), queue: {actions: queueActions(state), choose: selection.choose}}
	}
}

export type StashScreen = ReturnType<typeof screenOf>
export type Reader = NonNullable<StashScreen['detail']>

const Select = Component.define({
	events: Message,
	message: Message,
	model: Schema.Null,
	name: 'StashSelection',
	props: Schema.Struct({id: Schema.UndefinedOr(Schema.String)})
}).make({
	init: Function.constNull,
	parts: p => ({
		back: p.part((el, event: string) => el.on(event, Message.Back())),
		choose: p.part((el, event: string, identify: (payload: unknown) => string | undefined) =>
			el.on(event, payload => {
				const id = identify(payload)
				if (id === undefined) return undefined
				return Message.Choose({id})
			})
		),
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
	update: ($, message) => $.set(null).emit(message)
})

export function makeStash<V extends View.Elements, R>(
	elements: View.Vocabulary<V>,
	platform: Platform,
	reads: ReturnType<typeof makeReads>,
	render: (h: View.WithTags<StashMessage, unknown, V>, screen: StashScreen) => View.Content<StashMessage, R>
) {
	const StoreDraft = Command.make('Stash/StoreDraft', {args: {text: Schema.String}}, ({text}) =>
		Effect.sync(() => platform.writeDraft(text))
	)

	const RunAction = Command.make('Stash/Run', {args: {action: Action}, success: Message}, ({action}) =>
		AtomRegistry.AtomRegistry.use(registry =>
			Effect.matchCause(
				Action.match(action, {
					Capture: input => Effect.asVoid(reads.capture(registry, String.trim(input.text))),
					OpenLink: input => platform.openLink(input.url),
					Paste: () =>
						Effect.flatMap(platform.paste, text => {
							if (text === undefined) return Effect.void
							return Effect.asVoid(reads.capture(registry, text))
						}),
					Regenerate: input => reads.regenerate(registry, input.id),
					Share: input => platform.share(input.text),
					SignIn: () =>
						Effect.flatMap(platform.signIn, signedIn => {
							if (!signedIn) return Effect.void
							return Effect.sync(() => {
								reads.reconnect(registry)
								registry.refresh(platform.account)
							})
						}),
					SignOut: () =>
						Effect.andThen(
							platform.signOut,
							Effect.sync(() => {
								reads.reconnect(registry)
								registry.refresh(platform.account)
							})
						)
				}),
				{
					onFailure: cause => Message.Settled({action, problem: problemText(cause)}),
					onSuccess: () => Message.Settled({action, problem: undefined})
				}
			)
		)
	)

	const Refresh = Command.make('Stash/Retry', {args: {item: Schema.UndefinedOr(NoteItem.json)}}, ({item}) =>
		AtomRegistry.AtomRegistry.useSync(registry => {
			registry.refresh(platform.account)
			refreshFailed(registry, reads.notes)
			if (item !== undefined) {
				refreshFailed(registry, reads.body(item))
				refreshFailed(registry, reads.media(item))
			}
		})
	)

	const Wake = Command.make('Stash/Wake', {args: {refresh: Schema.Boolean}, success: Message}, ({refresh}) =>
		AtomRegistry.AtomRegistry.use(registry =>
			Effect.gen(function* () {
				if (refresh) registry.refresh(platform.account)
				const account = yield* Effect.option(
					AtomRegistry.getResult(registry, platform.account, {suspendOnWaiting: true})
				)
				if (Option.isNone(account)) return Message.Problem({text: undefined})
				return yield* Effect.match(platform.settleShares, {
					onFailure: error => Message.Problem({text: error.message}),
					onSuccess: rejections =>
						Message.Problem({
							text: Boolean.match(Array.isArrayNonEmpty(rejections), {
								onFalse: Function.constUndefined,
								onTrue: () => Array.join(rejections, '\n')
							})
						})
				})
			})
		)
	)

	return Component.withElements(elements)({
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
			const state = $.model
			const admitted =
				Option.isSome(AsyncResult.value(state.account)) &&
				!(AsyncResult.isFailure(state.account) && isDeniedCause(state.account.cause))
			const item = Option.fromUndefinedOr(state.selected).pipe(
				Option.filter(() => admitted),
				Option.getOrUndefined
			)
			return [
				Router.subscription(StashRoute, state.route, route => Message.Route({route})),
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
						observe(reads.notes, result => Message.Notes({result}))
					),
				item !== undefined &&
					Subscription.make('body', [item.id, state.revision], () =>
						observe(reads.body(item), result => Message.Body({id: item.id, result}))
					),
				item !== undefined &&
					Subscription.make('media', [item.id, state.revision], () =>
						observe(reads.media(item), result => Message.Media({id: item.id, result}))
					)
			]
		},
		update: {
			Account: ($, {result}) => {
				if (AsyncResult.isFailure(result) && isDeniedCause(result.cause)) {
					return $.evolve({
						account: result,
						body: AsyncResult.initial(),
						media: AsyncResult.initial(),
						notes: AsyncResult.initial(),
						selected: undefined
					})
				}
				return $.evolve({account: result})
			},
			Back: $ => $.run(Command.asNoop(BackToQueue.make({}))),
			Body: ($, {id, result}) => {
				if ($.model.selected?.id !== id || (AsyncResult.isInitial(result) && !AsyncResult.isInitial($.model.body)))
					return $.model
				if (AsyncResult.isFailure(result) && !isDeniedCause(result.cause)) {
					return $.evolve({body: AsyncResult.failureWithPrevious(result.cause, {previous: Option.some($.model.body)})})
				}
				return $.evolve({body: result})
			},
			Choose: ($, {id}) => {
				const message = selectedAction($.model, id)
				if (message === undefined) return $.model
				if (Message.isAnyOf(['Compose'])(message)) return $.evolve({composing: message.open})
				if (Message.isAnyOf(['FilterKind'])(message)) return $.set(select({...$.model, kind: message.kind}))
				if (Message.isAnyOf(['FilterTag'])(message)) return $.set(select({...$.model, tag: message.tag}))
				if (!Message.isAnyOf(['Run'])(message) || $.model.pending) return $.model
				return $.evolve({pending: true, problem: undefined}).run(RunAction.make({action: message.action}))
			},
			Clock: ($, {now}) => $.evolve({now}),
			Compose: ($, {open}) => $.evolve({composing: open}),
			DismissProblem: $ => $.evolve({problem: undefined}),
			Draft: ($, {text}) => $.evolve({draft: text}).run(Command.asNoop(StoreDraft.make({text}))),
			FilterKind: ($, {kind}) => $.set(select({...$.model, kind})),
			FilterTag: ($, {tag}) => {
				const next = $.set(select({...$.model, tag}))
				if (showsDetail($.model.route) && platform.narrow()) return next.run(Command.asNoop(BackToQueue.make({})))
				return next
			},
			Media: ($, {id, result}) => {
				if ($.model.selected?.id !== id) return $.model
				return $.evolve({media: result})
			},
			Notes: ($, {result}) => $.set(select({...$.model, notes: result})),
			Open: ($, {id}) => {
				const route = StashRoute.Home({search: {note: id, pane: 'detail'}})
				const navigate = Boolean.match(showsDetail($.model.route), {
					onFalse: () => Router.push(StashRoute, route),
					onTrue: () => Router.replace(StashRoute, route)
				})
				return $.evolve({composing: false}).run(Command.asNoop(navigate))
			},
			Problem: ($, {text}) => {
				if (text === undefined) return $.model
				return $.evolve({problem: text})
			},
			Retry: $ => $.run(Command.asNoop(Refresh.make({item: $.model.selected}))),
			Route: ($, {route}) => {
				const next = $.set(select({...$.model, route}))
				if (showsDetail(route) && !showsDetail($.model.route)) return next.viewTransition(['design-detail-in'])
				if (!showsDetail(route) && showsDetail($.model.route)) return next.viewTransition(['design-detail-out'])
				return next.viewTransition(['design-layout'])
			},
			Run: ($, {action}) => {
				if ($.model.pending || (Action.isAnyOf(['Capture'])(action) && String.isEmpty(String.trim(action.text))))
					return $.model
				return $.evolve({pending: true, problem: undefined}).run(RunAction.make({action}))
			},
			Settled: ($, {action, problem}) => {
				const next = $.evolve({pending: false, problem})
				if (problem !== undefined) return next
				if (Action.isAnyOf(['SignIn'])(action)) return next.run(Wake.make({refresh: false}))
				if (!Action.isAnyOf(['Capture'])(action)) return next
				const close = next.evolve({composing: false})
				if ($.model.draft !== action.text) return close
				return close.evolve({draft: ''}).run(Command.asNoop(StoreDraft.make({text: ''})))
			},
			Wake: $ => $.run(Wake.make({refresh: true}))
		},
		view: (h, model) =>
			Select(h, {
				props: {id: model.selected?.id},
				onEmit: message => message,
				view: selection => render(h, screenOf(model, selection))
			})
	})
}
