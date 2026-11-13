import {Effect, Schema, Struct, pipe} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {CurrentUser} from '@deslop/runtime/shared/auth'

import {Capture, NoteId, NoteItem, NotesCursor, NotesError} from '#services/notes/schema.ts'

export type NoteSummary = typeof NoteSummary.Type
const NoteSummary = Schema.Struct({
	...Struct.pick(NoteItem.json.fields, ['id', 'status', 'summary', 'tags', 'title', 'url']),
	saved: Schema.String
})

type SavedNote = typeof SavedNote.Type
const SavedNote = Schema.Struct({
	...NoteSummary.fields,
	...Struct.pick(NoteItem.json.fields, ['author', 'issue']),
	body: Schema.optionalKey(Schema.String),
	content: Schema.optionalKey(Schema.String),
	nextOffset: Schema.optionalKey(Schema.Natural),
	screenText: Schema.optionalKey(Schema.String),
	text: Schema.optionalKey(Schema.String),
	topics: Schema.optionalKey(Schema.String),
	transcript: Schema.optionalKey(Schema.String)
})

export const ToolContracts = Toolkit.make(
	Tool.make('search_notes', {
		description:
			'Find saved reading by words or #tag, newest first; omit query for recent notes. Pass nextCursor unchanged to continue, or read_note(id) for the selected note.',
		failure: NotesError,
		parameters: Schema.Struct({
			cursor: Schema.optionalKey(NotesCursor),
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
		success: Schema.Struct({
			nextCursor: Schema.optionalKey(NotesCursor),
			notes: Schema.Array(NoteSummary),
			total: Schema.Int
		})
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Strict, true),
	Tool.make('read_note', {
		description:
			'Read a saved note: metadata and organized body by default, or saved text when no body exists. Select a source section explicitly; pass nextOffset as offset with the same section to continue (transcript keeps [mm:ss] times).',
		failure: NotesError,
		parameters: Schema.Struct({
			id: NoteId.annotate({description: 'A known note id, or one from search_notes.'}),
			limit: pipe(
				Schema.Int.check(Schema.isBetween({maximum: 20_000, minimum: 1})),
				Schema.withDecodingDefaultTypeKey<typeof Schema.Int>(Effect.succeed(8000))
			),
			offset: pipe(Schema.Natural, Schema.withDecodingDefaultTypeKey<typeof Schema.Natural>(Effect.succeed(0))),
			section: pipe(
				Schema.Literals(['body', 'text', 'content', 'screenText', 'transcript', 'topics']),
				Schema.withDecodingDefaultTypeKey<
					Schema.Literals<readonly ['body', 'text', 'content', 'screenText', 'transcript', 'topics']>
				>(Effect.succeed('body' as const))
			)
		}),
		success: SavedNote
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Strict, true),
	Tool.make('save_note', {
		dependencies: [CurrentUser],
		description:
			'Save a link or text, or retry a failed save; an existing nonfailed note is returned unchanged, otherwise organizing. Use read_note(id) to inspect progress.',
		failure: NotesError,
		parameters: Schema.Struct({text: Capture.fields.text.annotate({description: 'The link or text to save.'})}),
		success: NoteSummary
	})
		.annotate(Tool.Destructive, false)
		.annotate(Tool.Strict, true),
	Tool.make('remove_note', {
		description: 'Use when the user asks to delete a saved note; removes it by the id search_notes returns.',
		failure: NotesError,
		parameters: Schema.Struct({id: NoteId.annotate({description: 'A note id from search_notes.'})}),
		success: Schema.Struct({id: NoteId})
	})
		.annotate(Tool.Destructive, true)
		.annotate(Tool.Strict, true)
)
