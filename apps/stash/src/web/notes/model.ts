import {Command, UiSchema} from '@effect/ui'

import {Array, Cause, Effect, Equal, Option, Predicate, Schema, String, pipe} from 'effect'

import {HttpClient} from 'effect/http'
import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {signInUrl} from '@deslop/runtime/shared/auth'
import {Account} from '@deslop/runtime/shared/schema'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'
import {nativeSignIn, nativeSignOut} from '@deslop/ui/native'
import {refreshFailed} from '@deslop/ui/state'

import {Kind, Note, NoteId, NoteItem, NotesError, TagName} from '#contracts'

import {paste} from '#web/notes/clipboard.ts'
import {kindOf} from '#web/notes/kinds.ts'
import {StashNative, atDevice} from '#web/notes/native.ts'
import {capture, mediaAtom, noteAtom, notesAtom, regenerate} from '#web/notes/notes.ts'
import {account, installed} from '#web/notes/session.ts'
import {StashRoute} from '#web/routes.ts'

const DRAFT_KEY = 'stash.draft'

const ReadAccount = AsyncResult.Schema({error: Schema.Unknown, success: Account})
const ReadNotes = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(NoteItem.json)})
const ReadBody = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Struct({body: Note.json.fields.body})})
const ReadMedia = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Finite})

type Panel = typeof Panel.Type
const Panel = Schema.Literals(['queue', 'note'])

export type Model = typeof Model.Type
export const Model = Schema.Struct({
	account: ReadAccount,
	body: ReadBody,
	composing: Schema.Boolean,
	draft: Schema.String,
	kind: Schema.UndefinedOr(Kind),
	listHidden: Schema.Boolean,
	media: ReadMedia,
	narrow: Schema.Boolean,
	notes: ReadNotes,
	now: DateTimeUtcFromFiniteMillis,
	panel: Schema.UndefinedOr(Panel),
	pending: Schema.Boolean,
	problem: Schema.UndefinedOr(Schema.String),
	revision: Schema.Int,
	route: StashRoute,
	selected: Schema.UndefinedOr(NoteItem.json),
	tag: Schema.UndefinedOr(TagName)
})

type Action = typeof Action.Type
export const Action = Schema.TaggedUnion({
	Capture: {text: Schema.String},
	OpenLink: {url: Schema.String},
	Paste: {},
	Regenerate: {id: NoteId},
	Share: {text: Schema.String},
	SignIn: {},
	SignOut: {}
})
export type Message = typeof Message.Type
export const Message = UiSchema.TaggedEnum({
	Account: {result: ReadAccount},
	Activate: {},
	Awake: {},
	Body: {id: NoteId, result: ReadBody},
	Clock: {now: DateTimeUtcFromFiniteMillis},
	Compose: {open: Schema.Boolean},
	DismissProblem: {},
	Draft: {text: Schema.String},
	FilterKind: {kind: Schema.UndefinedOr(Kind)},
	FilterTag: {tag: Schema.UndefinedOr(TagName)},
	Media: {id: NoteId, result: ReadMedia},
	Notes: {result: ReadNotes},
	Open: {id: NoteId},
	Panel: {panel: Panel},
	PanelClosed: {panel: Panel},
	Posture: {narrow: Schema.Boolean},
	Problem: {text: Schema.String},
	Retry: {},
	Route: {route: StashRoute},
	Run: {action: Action},
	Settled: {action: Action, problem: Schema.UndefinedOr(Schema.String)},
	Sidebar: {}
})

export function visibleNotes(model: Model) {
	return pipe(
		AsyncResult.value(model.notes),
		Option.getOrElse(Array.empty<NoteItem>),
		Array.filter(
			note =>
				(model.kind === undefined || kindOf(note) === model.kind) &&
				(model.tag === undefined || Array.contains(note.tags, model.tag))
		)
	)
}

export function select(model: Model): Model {
	const selected = Option.getOrUndefined(
		StashRoute.match(model.route, {
			Home: route =>
				Option.match(Option.fromUndefinedOr(route.search.note), {
					onNone: () => Array.head(visibleNotes(model)),
					onSome: id =>
						Option.flatMap(AsyncResult.value(model.notes), items => Array.findFirst(items, note => note.id === id))
				}),
			NotFound: () => Option.none()
		})
	)
	if (Equal.equals(selected, model.selected)) return model
	const next = {...model, revision: model.revision + 1, selected}
	if (selected?.id === model.selected?.id) return next
	return {...next, body: AsyncResult.initial(), media: AsyncResult.initial()}
}

export function readDraft() {
	return localStorage.getItem(DRAFT_KEY) ?? ''
}

export const StoreDraft = Command.make('Stash/StoreDraft', {args: {text: Schema.String}}, input =>
	Effect.sync(() => localStorage.setItem(DRAFT_KEY, input.text))
)

function share(text: string) {
	if (installed) return atDevice('The share sheet could not open.', () => StashNative.share({text}))
	if (Predicate.hasProperty(navigator, 'share')) {
		return Effect.catchIf(
			Effect.tryPromise({
				catch: cause => NotesError.make({cause, message: 'The share sheet could not open.'}),
				try: () => navigator.share({text})
			}),
			error => error.cause instanceof DOMException && error.cause.name === 'AbortError',
			() => Effect.void
		)
	}
	return atDevice('The note could not be copied.', () => navigator.clipboard.writeText(text))
}

function refreshAccount(registry: AtomRegistry.AtomRegistry) {
	return Effect.sync(() => {
		registry.refresh(account)
		if (AsyncResult.isFailure(registry.get(notesAtom))) registry.refresh(notesAtom)
	})
}

function signIn(registry: AtomRegistry.AtomRegistry) {
	if (!installed) return Effect.sync(() => location.assign(signInUrl(location.href)))
	return Effect.flatMap(nativeSignIn, signedIn => {
		if (signedIn) return refreshAccount(registry)
		return Effect.void
	})
}

export class RunAction extends Command.Service<RunAction>()('Stash/RunAction', {
	args: {action: Action},
	success: Message
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.all({client: HttpClient.HttpClient, registry: AtomRegistry.AtomRegistry}, {concurrency: 1}),
			context => input =>
				Effect.matchCause(
					Action.match(input.action, {
						Capture: action => Effect.asVoid(capture(context.registry, String.trim(action.text))),
						OpenLink: action =>
							atDevice('The link could not be opened.', () => StashNative.openLink({url: action.url})),
						Paste: () => paste(context.registry, context.client),
						Regenerate: action => regenerate(context.registry, action.id),
						Share: action => share(action.text),
						SignIn: () => signIn(context.registry),
						SignOut: () => Effect.andThen(nativeSignOut, refreshAccount(context.registry))
					}),
					{
						onFailure: cause => {
							const error = Cause.squash(cause)
							if (Predicate.hasProperty(error, 'message') && Predicate.isString(error.message)) {
								return Message.Settled({action: input.action, problem: error.message})
							}
							return Message.Settled({action: input.action, problem: 'Stash could not complete this action.'})
						},
						onSuccess: () => Message.Settled({action: input.action, problem: undefined})
					}
				)
		)
	)
}

export class Refresh extends Command.Service<Refresh>()('Stash/Refresh', {
	args: {item: Schema.UndefinedOr(NoteItem.json)},
	success: Schema.Void
}) {
	static readonly layer = this.toLayer(
		AtomRegistry.AtomRegistry.useSync(
			registry => input =>
				Effect.sync(() => {
					registry.refresh(account)
					refreshFailed(registry, notesAtom)
					if (Predicate.isNotUndefined(input.item)) {
						refreshFailed(registry, noteAtom(input.item))
						refreshFailed(registry, mediaAtom(input.item.id))
					}
				})
		)
	)
}

// Read the account after each activation, so a queued share is only sent under an admitted session.
export class Wake extends Command.Service<Wake>()('Stash/Wake', {args: {refresh: Schema.Boolean}, success: Message}) {
	static readonly layer = this.toLayer(
		AtomRegistry.AtomRegistry.useSync(
			registry => input =>
				Effect.gen(function* () {
					if (input.refresh) registry.refresh(account)
					if (
						Option.isNone(yield* Effect.option(AtomRegistry.getResult(registry, account, {suspendOnWaiting: true})))
					) {
						return Message.Awake()
					}
					return yield* Effect.match(
						atDevice('Queued shares could not be sent.', () => StashNative.settleShares()),
						{
							onFailure: error => Message.Problem({text: error.message}),
							onSuccess: result => {
								if (Array.isArrayNonEmpty(result.rejections)) {
									return Message.Problem({text: Array.join(result.rejections, '\n')})
								}
								return Message.Awake()
							}
						}
					)
				})
		)
	)
}
