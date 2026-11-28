import {Schema, Struct, pipe} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'
import {Model} from 'effect/schema'

import {RpcAuth, User, UserId} from '@deslop/runtime/shared/auth'

export class NotesError extends Schema.TaggedError<NotesError>()('NotesError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String,
	// Invalid, TooLarge and Removed are final answers to a capture, so a sender never queues it again.
	reason: Schema.optional(Schema.Literals(['Unreachable', 'UnreadablePhoto', 'Invalid', 'TooLarge', 'Removed']))
}) {}

export type NoteId = typeof NoteId.Type
export const NoteId = pipe(Schema.String, Schema.check(Schema.isUUID()), Schema.brand('NoteId'))

export type TagName = typeof TagName.Type
export const TagName = pipe(Schema.NonEmptyString.check(Schema.isMaxLength(40)), Schema.brand('TagName'))

export type Source = typeof Source.Type
export const Source = Schema.Literals(['TikTok', 'X', 'Website', 'Note'])

export type Kind = typeof Kind.Type
export const Kind = Schema.Literals(['tiktok', 'x', 'youtube', 'web', 'note', 'file'])

export type ImageType = typeof ImageType.Type
export const ImageType = Schema.Literals(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export type FileType = typeof FileType.Type
export const FileType = Schema.Literals(['image/jpeg', 'video/mp4', 'video/quicktime'])

// One row of `notes`, and what the server, the web and the phone know a note by: absent is `Option.none()` in code, NULL in the row and a missing key on the wire.
export class Note extends Model.Class<Note>('Note')({
	author: Model.FieldOption(Schema.String),
	body: Model.FieldOption(Schema.String),
	content: Schema.String,
	createdAt: Model.DateTimeInsertFromNumber,
	file: Model.FieldOption(FileType),
	// A capture brings the id its device made, so a retried upload saves one note.
	id: NoteId,
	image: Model.FieldOption(ImageType),
	issue: Model.FieldOption(Schema.String),
	// Whose AI keys organize the note, so a restart resumes it on their behalf; it never leaves the server.
	requester: Model.Sensitive(User.fields.id),
	screenText: Model.FieldOption(Schema.String),
	source: Source,
	status: Schema.Literals(['organizing', 'ready', 'failed']),
	summary: Schema.String,
	text: Schema.String,
	title: Schema.String,
	topics: Model.FieldOption(Schema.String),
	transcript: Model.FieldOption(Schema.String),
	url: Model.FieldOption(Schema.String)
}) {
	static readonly table = 'notes'
}

// What the list shows per note: the note without its long texts and requester, and its tags in the order the AI gave them.
export class NoteItem extends Model.Class<NoteItem>('NoteItem')({
	...Struct.omit(Model.fields(Note), ['body', 'content', 'requester', 'screenText', 'text', 'topics', 'transcript']),
	tags: Model.Field({json: Schema.Array(TagName), select: Schema.fromJsonString(Schema.Array(TagName))})
}) {}

type NotesEvent = typeof NotesEvent.Type
const NotesEvent = Schema.Struct({
	removed: Schema.Array(NoteId),
	reset: Schema.Boolean,
	upserted: Schema.Array(NoteItem.json)
})

export type Capture = typeof Capture.Type
export const Capture = Schema.Struct({id: NoteId, text: Schema.NonEmptyString.check(Schema.isMaxLength(20_000))})

// Latest committed change per id, including tombstones, for incremental list readers.
export class NoteChangeVersion extends Model.Class<NoteChangeVersion>('NoteChangeVersion')({
	id: NoteId,
	version: Schema.Int
}) {
	static readonly table = 'note_changes'
}

// A capture id whose note was deleted, or joined another note; a resend of it never brings the note back.
export class RetiredNote extends Model.Class<RetiredNote>('RetiredNote')({
	id: NoteId,
	mergedInto: Model.FieldOption(NoteId)
}) {
	static readonly table = 'retired_notes'
}

export type TagDefinition = typeof TagDefinition.Type
// A tag and what belongs under it, as the AI defines it.
export const TagDefinition = Schema.Struct({
	definition: Schema.NonEmptyString.check(Schema.isMaxLength(240)),
	tag: TagName
})

export type Image = typeof Image.Type
export const Image = Schema.Struct({bytes: Schema.Uint8Array, type: ImageType})

export type Picture = typeof Picture.Type
export const Picture = Schema.Struct({...Image.fields, label: Schema.String})

export type NoteChangeResult = typeof NoteChangeResult.Type
export const NoteChangeResult = Schema.TaggedUnion({
	Changed: {note: Schema.Struct(Note.fields)},
	Removed: {},
	Unchanged: {}
})

// A tag and what belongs under it, so the AI reuses tags by meaning; the definition is the first one the tag was given.
export class Tag extends Model.Class<Tag>('Tag')({
	definition: Model.FieldOption(TagDefinition.fields.definition),
	name: TagName
}) {
	static readonly table = 'tags'
}

// A note's tag, at the place the AI gave it.
export class NoteTag extends Model.Class<NoteTag>('NoteTag')({noteId: NoteId, position: Schema.Int, tag: TagName}) {
	static readonly table = 'note_tags'
}

// Where a page of notes, newest first, continues.
export type NotesCursor = typeof NotesCursor.Type
export const NotesCursor = Schema.Struct(Struct.pick(Note.json.fields, ['createdAt', 'id']))

export type Extraction = typeof Extraction.Type
export const Extraction = Schema.Struct({
	author: Schema.Option(Schema.String),
	image: Schema.Option(Schema.String),
	slides: Schema.OptionFromOptionalKey(Schema.Array(Schema.String)),
	text: Schema.String,
	title: Schema.String,
	url: Schema.String,
	video: Schema.OptionFromOptionalKey(Schema.String)
})

// A tag in use and how many notes carry it, so the AI reuses tags by meaning instead of by name.
export type TagEntry = typeof TagEntry.Type
export const TagEntry = Schema.Struct({...Tag.fields, count: Schema.Int})

export type Organization = typeof Organization.Type
export const Organization = Schema.Struct({
	body: Schema.String.check(Schema.isMaxLength(40_000)),
	definitions: Schema.Array(TagDefinition),
	screenText: Schema.String,
	summary: Schema.String.check(Schema.isMaxLength(400)),
	tags: Schema.Array(TagName).check(Schema.isMinLength(1), Schema.isMaxLength(3)),
	title: Schema.NonEmptyString.check(Schema.isMaxLength(90)),
	topics: Schema.String.check(Schema.isMaxLength(1000))
})

export type NoteChange = typeof NoteChange.Type
export const NoteChange = Schema.TaggedUnion({
	empty: {},
	extract: {extraction: Schema.Result(Extraction, NotesError)},
	fail: {issue: Schema.String},
	image: {image: ImageType},
	issue: {issue: Schema.String},
	// `read` is the saved text the organization was written from.
	organize: {
		organization: Schema.Struct(Struct.pick(Organization.fields, ['body', 'screenText', 'summary', 'title', 'topics'])),
		read: Schema.String
	},
	remove: {into: Schema.Option(NoteId)},
	resolve: {url: Schema.String},
	// Organizing again on behalf of whoever asked, whose keys pay for it.
	retry: {requester: UserId},
	share: {capture: Capture},
	stop: {},
	video: {content: Schema.Option(Schema.String), transcript: Schema.Option(Schema.String)}
})

export const NotesRpcs = RpcGroup.make(
	Rpc.make('notes.events', {error: NotesError, stream: true, success: NotesEvent}),
	Rpc.make('notes.body', {
		error: NotesError,
		payload: Schema.Struct({id: NoteId}),
		success: Schema.Struct(Struct.pick(Note.json.fields, ['body']))
	}),
	Rpc.make('notes.media', {error: NotesError, payload: Schema.Struct({id: NoteId}), success: Schema.Finite}),
	Rpc.make('notes.capture', {error: NotesError, payload: Capture, success: NoteItem.json}),
	Rpc.make('notes.regenerate', {error: NotesError, payload: Schema.Struct({id: NoteId})})
).middleware(RpcAuth)
