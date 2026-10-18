import {Effect, Schema, pipe} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {Capture, Note, NoteId, NoteItem, NotesError} from '#services/notes/schema.ts'

type Notes = typeof Notes.Type
const Notes = Schema.Struct({notes: Schema.Array(NoteItem), total: Schema.Int})

export const Tools = Toolkit.make(
	Tool.make('list', {
		description: 'List saved notes, newest first, without their long texts.',
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
	Tool.make('search', {
		description:
			'Find notes whose title, summary, text, transcript, link or tags hold every word of the query, newest first; a #word must be a tag.',
		parameters: Schema.Struct({query: Schema.NonEmptyString}),
		success: Notes
	}).annotate(Tool.Readonly, true),
	Tool.make('get', {
		description:
			'Read one note whole: summary, tags, the source text, the text in its images and the transcript with [mm:ss] timestamps.',
		failure: NotesError,
		parameters: Schema.Struct({id: NoteId}),
		success: Note
	}).annotate(Tool.Readonly, true),
	Tool.make('save', {
		description:
			'Save a link or the text of a note. A link saved before returns its existing note. A new note returns at once with status "organizing"; reading, transcribing and tagging take seconds to minutes, so get it again until its status is "ready".',
		failure: NotesError,
		parameters: Schema.Struct({text: Capture.fields.text}),
		success: Note
	}).annotate(Tool.Destructive, false),
	Tool.make('regenerate', {
		description: 'Read and tag a note again from its source.',
		failure: NotesError,
		parameters: Schema.Struct({id: NoteId})
	}),
	Tool.make('remove', {
		description: 'Delete a note with its images and files.',
		failure: NotesError,
		parameters: Schema.Struct({id: NoteId})
	})
)
