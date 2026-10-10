import {Schema, pipe} from 'effect'

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

// A photo, screenshot or video shared or copied from the iPhone; the app sends photos as JPEG.
export type FileType = typeof FileType.Type
export const FileType = Schema.Literals(['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime'])

export type Note = typeof Note.Type
export const Note = Schema.Struct({
	// The post's author or the site's name.
	author: Schema.String,
	// The AI's notes: every useful fact as short lines, or the organized rewrite of a written note.
	body: Schema.optionalKey(Schema.String),
	content: Schema.String,
	createdAt: Schema.Finite,
	// The type of the photo, screenshot or video the note holds, kept on the server; notes from links and text have none.
	file: Schema.optionalKey(FileType),
	id: NoteId,
	// The type of the preview image the server keeps for this note, served at /api/images/<id>.
	image: Schema.optionalKey(ImageType),
	issue: Schema.String,
	// The organizer revision that tagged the note; a note from an older revision is tagged again on start.
	revision: Schema.optionalKey(Schema.Finite),
	// The words visible in the photo, screenshot or video stills, as the AI read them.
	screenText: Schema.optionalKey(Schema.String),
	source: Source,
	status: Schema.Literals(['organizing', 'ready', 'saved']),
	summary: Schema.String,
	tags: Schema.Array(Tag),
	text: Schema.String,
	title: Schema.String,
	// Names, tools and techniques the AI found, for search; notes tagged before topics existed have none.
	topics: Schema.optionalKey(Schema.String),
	// What a video says, from its published captions or local Whisper, one `[mm:ss] text` line per segment.
	transcript: Schema.optionalKey(Schema.String),
	url: Schema.NullOr(Schema.String)
})

export type AiSpend = typeof AiSpend.Type
export const AiSpend = Schema.Struct({month: Schema.String, usd: Schema.Finite})

export type NotesState = typeof NotesState.Type
export const NotesState = Schema.Struct({aiSpend: AiSpend, notes: Schema.Array(Note)})

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
	// The canonical link after short links and redirects: TikTok makes a new short link for every share of one post.
	url: Schema.String,
	// A direct video file the post carries, such as an X post's own or quoted video, for stills.
	video: Schema.optionalKey(Schema.String)
})

export type Organization = typeof Organization.Type
export const Organization = Schema.Struct({
	// Every useful fact as short lines, or the organized rewrite of a written note.
	body: pipe(Schema.String, Schema.check(Schema.isMaxLength(4000))),
	// The words visible in the attached images, in reading order; empty when they show none.
	screenText: pipe(Schema.String, Schema.check(Schema.isMaxLength(4000))),
	summary: pipe(Schema.String, Schema.check(Schema.isMaxLength(160))),
	tags: pipe(Schema.Array(Tag), Schema.check(Schema.isMinLength(1), Schema.isMaxLength(3))),
	title: pipe(Schema.String, Schema.check(Schema.isMinLength(1), Schema.isMaxLength(80))),
	// Names, tools and techniques that search should find, separated by semicolons; tags stay few and reusable.
	topics: pipe(Schema.String, Schema.check(Schema.isMaxLength(400)))
})
