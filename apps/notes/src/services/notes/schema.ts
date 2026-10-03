import {Schema, pipe} from 'effect'

export class NotesError extends Schema.TaggedError<NotesError>()('NotesError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type Note = typeof Note.Type
export const Note = Schema.Struct({
	content: Schema.String,
	createdAt: Schema.Finite,
	id: Schema.String,
	issue: Schema.String,
	raw: Schema.String,
	source: Schema.Literals(['TikTok', 'X', 'Website', 'Note']),
	status: Schema.Literals(['saved', 'organizing', 'ready']),
	summary: Schema.String,
	tags: Schema.Array(Schema.String),
	title: Schema.String,
	url: Schema.NullOr(Schema.String)
})

export type NotesState = typeof NotesState.Type
export const NotesState = Schema.Struct({
	aiReserved: pipe(Schema.Finite, Schema.check(Schema.isBetween({maximum: 0.25, minimum: 0}))),
	notes: Schema.Array(Note)
})

export type Capture = typeof Capture.Type
export const Capture = Schema.Struct({
	text: pipe(Schema.String, Schema.check(Schema.isMinLength(1), Schema.isMaxLength(20000)))
})

export type EditNote = typeof EditNote.Type
export const EditNote = Schema.Struct({
	id: Schema.String,
	tags: pipe(
		Schema.Array(pipe(Schema.String, Schema.check(Schema.isMaxLength(40)))),
		Schema.check(Schema.isMaxLength(12))
	),
	title: pipe(Schema.String, Schema.check(Schema.isMinLength(1), Schema.isMaxLength(200)))
})

export type Organization = typeof Organization.Type
export const Organization = Schema.Struct({
	summary: pipe(Schema.String, Schema.check(Schema.isMaxLength(1000))),
	tags: pipe(
		Schema.Array(pipe(Schema.String, Schema.check(Schema.isMinLength(1), Schema.isMaxLength(40)))),
		Schema.check(Schema.isMaxLength(6))
	),
	title: pipe(Schema.String, Schema.check(Schema.isMinLength(1), Schema.isMaxLength(200)))
})
type Completion = typeof Completion.Type
export const Completion = Schema.Struct({
	choices: Schema.Array(Schema.Struct({message: Schema.Struct({content: Schema.String})}))
})

type OEmbed = typeof OEmbed.Type
export const OEmbed = Schema.Struct({html: Schema.optional(Schema.String), title: Schema.optional(Schema.String)})
