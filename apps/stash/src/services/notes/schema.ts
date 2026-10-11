import {Schema, Struct, pipe} from 'effect'

export class NotesError extends Schema.TaggedError<NotesError>()('NotesError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type NoteId = typeof NoteId.Type
export const NoteId = pipe(Schema.String, Schema.check(Schema.isUUID()))

export type Tag = typeof Tag.Type
export const Tag = pipe(Schema.String, Schema.check(Schema.isMinLength(1), Schema.isMaxLength(40)))

export type Source = typeof Source.Type
export const Source = Schema.Literals(['TikTok', 'X', 'Website', 'Note'])

export type ImageType = typeof ImageType.Type
export const ImageType = Schema.Literals(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export type Image = {bytes: Uint8Array; type: ImageType}

export type FileType = typeof FileType.Type
export const FileType = Schema.Literals(['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime'])

export type Note = typeof Note.Type
export const Note = Schema.Struct({
	author: Schema.String,
	body: Schema.optionalKey(Schema.String),
	content: Schema.String,
	createdAt: Schema.Finite,
	file: Schema.optionalKey(FileType),
	id: NoteId,
	image: Schema.optionalKey(ImageType),
	issue: Schema.String,
	screenText: Schema.optionalKey(Schema.String),
	source: Source,
	status: Schema.Literals(['organizing', 'ready', 'failed']),
	summary: Schema.String,
	tags: Schema.Array(Tag),
	text: Schema.String,
	title: Schema.String,
	topics: Schema.optionalKey(Schema.String),
	transcript: Schema.optionalKey(Schema.String),
	url: Schema.NullOr(Schema.String)
})

export type NoteItem = typeof NoteItem.Type
export const NoteItem = Note.mapFields(Struct.omit(['body', 'content', 'screenText', 'text', 'transcript']))

export type NotesEvent = typeof NotesEvent.Type
export const NotesEvent = Schema.Struct({
	removed: Schema.Array(NoteId),
	reset: Schema.Boolean,
	upserted: Schema.Array(NoteItem)
})

export type Capture = typeof Capture.Type
export const Capture = Schema.Struct({
	id: NoteId,
	text: pipe(Schema.String, Schema.check(Schema.isMinLength(1), Schema.isMaxLength(20_000)))
})

export type Extraction = typeof Extraction.Type
export const Extraction = Schema.Struct({
	author: Schema.String,
	image: Schema.Option(Schema.String),
	text: Schema.String,
	title: Schema.String,
	url: Schema.String,
	video: Schema.optionalKey(Schema.String)
})

export type Organization = typeof Organization.Type
export const Organization = Schema.Struct({
	body: pipe(Schema.String, Schema.check(Schema.isMaxLength(4000))),
	screenText: pipe(Schema.String, Schema.check(Schema.isMaxLength(4000))),
	summary: pipe(Schema.String, Schema.check(Schema.isMaxLength(160))),
	tags: pipe(Schema.Array(Tag), Schema.check(Schema.isMinLength(1), Schema.isMaxLength(3))),
	title: pipe(Schema.String, Schema.check(Schema.isMinLength(1), Schema.isMaxLength(80))),
	topics: pipe(Schema.String, Schema.check(Schema.isMaxLength(400)))
})
