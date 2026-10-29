import {Effect, Schema, pipe} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {Capture, Note, NoteId, NoteItem, NotesError, TagEntry} from '#services/notes/schema.ts'

type Notes = typeof Notes.Type
const Notes = Schema.Struct({notes: Schema.Array(NoteItem), total: Schema.Int})

export const Tools = Toolkit.make(
	Tool.make('search_notes', {
		description:
			'Find saved notes whose title, summary, text, transcript, link or tags hold every word of the query, newest first; a #word must be a tag. Call it when the user refers to something they saved or read.',
		parameters: Schema.Struct({query: Schema.NonEmptyString}),
		success: Notes
	}).annotate(Tool.Readonly, true),
	Tool.make('list_notes', {
		description: 'List saved notes, newest first, without their long texts; page with offset.',
		parameters: Schema.Struct({
			limit: pipe(
				Schema.Int,
				Schema.check(Schema.isBetween({maximum: 200, minimum: 1})),
				Schema.withDecodingDefaultTypeKey(Effect.succeed(50))
			),
			offset: pipe(Schema.Natural, Schema.withDecodingDefaultTypeKey(Effect.succeed(0)))
		}),
		success: Notes
	}).annotate(Tool.Readonly, true),
	Tool.make('list_tags', {
		description:
			'List the tags in use, most used first, each with its note count and what belongs under it; search a tag with #tag in search_notes.',
		success: Schema.Struct({tags: Schema.Array(TagEntry)})
	}).annotate(Tool.Readonly, true),
	Tool.make('read_note', {
		description:
			'Read one note whole: summary, tags, the source text, the text in its images and the transcript with [mm:ss] timestamps.',
		failure: NotesError,
		parameters: Schema.Struct({id: NoteId}),
		success: Note
	}).annotate(Tool.Readonly, true),
	Tool.make('save_note', {
		description:
			'Save a link or a text. A link saved before returns its existing note. A new note returns at once with status "organizing"; reading, transcribing and tagging take seconds to minutes. Read it again with read_note, waiting between reads, until its status is "ready" or "failed"; a failed note says why in issue, and reprocess_note retries it.',
		failure: NotesError,
		parameters: Schema.Struct({text: Capture.fields.text}),
		success: Note
	}).annotate(Tool.Destructive, false),
	Tool.make('reprocess_note', {
		description:
			'Read, transcribe and tag a note again from its source, when it failed or its summary or tags are wrong. It returns once the work starts; follow it with read_note until the status is "ready" or "failed".',
		failure: NotesError,
		parameters: Schema.Struct({id: NoteId})
	}),
	Tool.make('delete_note', {
		description: 'Delete a note with its images and files.',
		failure: NotesError,
		parameters: Schema.Struct({id: NoteId})
	})
)
