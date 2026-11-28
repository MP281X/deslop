import {MarkdownParser} from '@effect/ui/html'

import type {DateTime} from 'effect'
import {Array, Boolean, Equal, Function, Option, Result, Schema, String, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import type {ToolbarAction} from '@deslop/components/model'
import {blockingFailure, isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {AuthError} from '@deslop/runtime/shared/auth'
import {Account} from '@deslop/runtime/shared/schema'

import {StashRoute, noteOf} from '#reads'

import {Kind, Note, NoteItem, TagName} from './contract.ts'
import {
	isWebLink,
	issueOf,
	kindOf,
	kinds,
	pathsOf,
	rowOf,
	savedOf,
	sourceLabelOf,
	subjectOf,
	tagCounts,
	webLinksOnly
} from './shared.ts'

const ReadAccount = AsyncResult.Schema({error: AuthError, success: Account})
const ReadNotes = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(NoteItem.json)})
const ReadBody = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Struct({body: Note.json.fields.body})})
const ReadMedia = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Finite})

// What the screen keeps of the notes: the reads, the note open and the filters on the queue, the draft and what the last action said.
export const notesFields = {
	account: ReadAccount,
	body: ReadBody,
	composing: Schema.Boolean,
	draft: Schema.String,
	kind: Schema.UndefinedOr(Kind),
	media: ReadMedia,
	notes: ReadNotes,
	pending: Schema.Boolean,
	problem: Schema.UndefinedOr(Schema.String),
	revision: Schema.Int,
	route: StashRoute,
	selected: Schema.UndefinedOr(NoteItem.json),
	tag: Schema.UndefinedOr(TagName)
}

export type NotesModel = typeof NotesModel.Type
export const NotesModel = Schema.Struct(notesFields)

export function parseBody(body: string) {
	return Result.map(
		Result.try({catch: Function.identity, try: () => MarkdownParser.parseMarkdown(webLinksOnly(body))}),
		document => ({blocks: document.blocks})
	)
}

function allNotes(state: NotesModel) {
	return Option.getOrElse(AsyncResult.value(state.notes), Array.empty<NoteItem>)
}

function visibleNotes(state: NotesModel) {
	return Array.filter(
		allNotes(state),
		note =>
			(state.kind === undefined || kindOf(note) === state.kind) &&
			(state.tag === undefined || Array.contains(note.tags, state.tag))
	)
}

// The note the route names, or the newest one the queue shows when it names none; a new note starts from empty reads.
export function select<Model extends NotesModel>(model: Model) {
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

// The reads the shell judges: the account when it holds a refusal or an outage with nothing kept, and the notes only when they were refused.
export function gatedReads(state: NotesModel) {
	return [
		...Boolean.match(Option.isSome(blockingFailure(state.account)), {onFalse: () => [], onTrue: () => [state.account]}),
		...pipe(
			blockingFailure(state.notes),
			Option.exists(isDeniedCause),
			Boolean.match({onFalse: () => [], onTrue: () => [state.notes]})
		)
	]
}

function readerRetry(state: NotesModel) {
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

function reader(state: NotesModel, now: DateTime.Utc) {
	const note = state.selected
	if (note === undefined) return undefined
	const notes = allNotes(state)
	return {
		body: Option.getOrUndefined(Option.flatMap(AsyncResult.value(state.body), full => full.body)),
		denied: denied(state.body) || denied(state.media),
		id: note.id,
		kind: kindOf(note),
		loading: AsyncResult.isInitial(state.body) && note.status === 'ready',
		pictures: pathsOf(
			note.id,
			Option.isSome(note.image),
			Option.getOrElse(AsyncResult.value(state.media), Function.constant(0))
		),
		related: pipe(
			notes,
			Array.filter(item => item.id !== note.id && Array.some(item.tags, tag => Array.contains(note.tags, tag))),
			Array.take(4),
			Array.map(item => rowOf(item, now))
		),
		retry: readerRetry(state),
		saved: savedOf(note, now),
		source: sourceLabelOf(note),
		status: readerStatus(note),
		statusFailed: note.status === 'failed',
		summary: note.summary,
		tags: Array.map(note.tags, tag => ({count: Array.countBy(notes, item => Array.contains(item.tags, tag)), tag})),
		title: note.title
	}
}

function queueNote(state: NotesModel) {
	if (Option.isSome(blockingFailure(state.notes))) return 'Couldn’t load notes'
	if (AsyncResult.isFailure(state.notes)) return 'Notes may be out of date'
	if (AsyncResult.isInitial(state.notes) || Array.isReadonlyArrayNonEmpty(visibleNotes(state))) return undefined
	if (state.kind !== undefined || state.tag !== undefined) return 'No notes match'
	return 'No saved notes'
}

function detailActions(state: NotesModel) {
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

function queueActions(state: NotesModel) {
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

function saveDisabled(state: NotesModel) {
	return state.pending || String.isEmpty(String.trim(state.draft))
}

// What the screen draws of the notes: the queue and the note beside it, the sheet that writes one, and the toolbars.
export function notesScreen(state: NotesModel, now: DateTime.Utc) {
	const detail = reader(state, now)
	const id = noteOf(state.route)
	return {
		composeActions: [
			{disabled: state.pending, id: 'compose-cancel', label: 'Cancel', symbol: 'xmark'},
			{disabled: saveDisabled(state), id: 'compose-save', label: 'Save', symbol: 'checkmark'}
		] satisfies readonly ToolbarAction[],
		composing: state.composing,
		detail,
		detailActions: detailActions(state),
		detailFailed: Option.isSome(blockingFailure(state.notes)),
		detailLoading: AsyncResult.isInitial(state.notes),
		detailMissing: id !== undefined && detail === undefined && AsyncResult.isSuccess(state.notes),
		draft: state.draft,
		failed: Option.exists(blockingFailure(state.account), cause => !isDeniedCause(cause) && !needsSignInCause(cause)),
		list: {loading: AsyncResult.isInitial(state.notes), rows: Array.map(visibleNotes(state), note => rowOf(note, now))},
		pending: state.pending,
		queueActions: queueActions(state),
		queueMessage: queueNote(state),
		queueRetryable: AsyncResult.isFailure(state.notes),
		report: state.problem,
		saveDisabled: saveDisabled(state),
		tag: state.tag,
		tags: tagCounts(allNotes(state))
	}
}
