import {Effect, Schema, Struct, pipe} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {CurrentUser} from '@deslop/runtime/auth/utils'

import {Capture, Note, NoteId, NotesError, Tag} from '#services/notes/schema.ts'

export type NoteRow = typeof NoteRow.Type
const NoteRow = Schema.Struct({
	id: NoteId,
	saved: Schema.String,
	status: Note.fields.status,
	summary: Schema.String,
	tags: Schema.Array(Tag),
	title: Schema.String,
	url: Schema.optionalKey(Schema.String)
})

const NoteView = Note.mapFields(Struct.omit(['createdAt', 'file', 'id', 'image', 'requester', 'source']))

export const Tools = Toolkit.make(
	Tool.make('search_notes', {
		description:
			'Use when the user asks about something they saved or read; returns matching notes newest first, each with its id, saved date, title, summary, tags, status and url (a #word matches a tag; without a query, the newest).',
		parameters: Schema.Struct({
			limit: pipe(
				Schema.Int,
				Schema.check(Schema.isBetween({maximum: 50, minimum: 1})),
				Schema.withDecodingDefaultTypeKey(Effect.succeed(20)),
				Schema.annotate({description: 'How many notes to return, newest first.'})
			),
			query: Schema.optionalKey(
				Schema.String.annotate({description: 'Words every result must contain; a #word matches a tag.'})
			)
		}),
		success: Schema.Struct({notes: Schema.Array(NoteRow), total: Schema.Int})
	}).annotate(Tool.Readonly, true),
	Tool.make('read_note', {
		description:
			'Use when the user asks about one saved note; returns its title, author, url, summary, tags, topics, text, body, screen text and transcript with [mm:ss] times.',
		failure: NotesError,
		parameters: Schema.Struct({id: NoteId.annotate({description: 'A note id from search_notes.'})}),
		success: NoteView
	}).annotate(Tool.Readonly, true),
	Tool.make('save_note', {
		dependencies: [CurrentUser],
		description:
			"Use when the user shares a link or text to keep, or asks to retry a failed save; returns at once with status 'organizing', and read_note shows 'ready' or 'failed' once reading, transcribing and tagging finish.",
		failure: NotesError,
		parameters: Schema.Struct({text: Capture.fields.text.annotate({description: 'The link or text to save.'})}),
		success: NoteRow
	}).annotate(Tool.Destructive, false),
	Tool.make('remove_note', {
		description: 'Use when the user asks to delete a saved note; removes it by the id search_notes returns.',
		failure: NotesError,
		parameters: Schema.Struct({id: NoteId.annotate({description: 'A note id from search_notes.'})})
	}).annotate(Tool.Destructive, true)
)
