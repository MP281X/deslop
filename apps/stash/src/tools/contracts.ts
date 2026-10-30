import {Effect, Schema, pipe} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {Capture, Note, NoteId, NotesError, Tag} from '#services/notes/schema.ts'

export type NoteRow = typeof NoteRow.Type
// A note as a search lists it: what an agent needs to pick one, with the long texts left to read_note.
const NoteRow = Schema.Struct({
	id: NoteId,
	saved: Schema.String,
	status: Note.fields.status,
	summary: Schema.String,
	tags: Schema.Array(Tag),
	title: Schema.String,
	url: Schema.optionalKey(Schema.String)
})

export const Tools = Toolkit.make(
	Tool.make('search_notes', {
		description:
			'Saved notes holding every word of the query in their title, summary, text or tags (#word must be a tag), newest first; without a query, the newest.',
		parameters: Schema.Struct({
			limit: pipe(
				Schema.Int,
				Schema.check(Schema.isBetween({maximum: 50, minimum: 1})),
				Schema.withDecodingDefaultTypeKey(Effect.succeed(20))
			),
			offset: pipe(
				Schema.Int,
				Schema.check(Schema.isBetween({maximum: 10_000, minimum: 0})),
				Schema.withDecodingDefaultTypeKey(Effect.succeed(0))
			),
			query: Schema.optionalKey(Schema.String)
		}),
		success: Schema.Struct({notes: Schema.Array(NoteRow), total: Schema.Int})
	}).annotate(Tool.Readonly, true),
	Tool.make('read_note', {
		description:
			'One note whole: summary, tags, source text, text in its images and the transcript with [mm:ss] times.',
		failure: NotesError,
		parameters: Schema.Struct({id: NoteId.annotate({description: 'A note id from search_notes.'})}),
		success: Note
	}).annotate(Tool.Readonly, true),
	Tool.make('save_note', {
		description:
			'Save a link or a text, or retry one whose earlier save failed. It returns at once with status "organizing"; read_note shows "ready" or "failed" once reading, transcribing and tagging finish.',
		failure: NotesError,
		parameters: Schema.Struct({text: Capture.fields.text}),
		success: NoteRow
	}).annotate(Tool.Destructive, false)
)
