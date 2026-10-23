import {Schema} from 'effect'

export class MediaError extends Schema.TaggedError<MediaError>()('MediaError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type Comment = typeof Comment.Type
export const Comment = Schema.Struct({
	author: Schema.optionalKey(Schema.NullOr(Schema.String)),
	author_is_uploader: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	is_pinned: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	like_count: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
	parent: Schema.optionalKey(Schema.NullOr(Schema.String)),
	text: Schema.String
})

// What yt-dlp prints for a link.
export type Metadata = typeof Metadata.Type
export const Metadata = Schema.Struct({
	_type: Schema.optionalKey(Schema.String),
	automatic_captions: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
	chapters: Schema.optionalKey(
		Schema.NullOr(Schema.Array(Schema.Struct({start_time: Schema.Finite, title: Schema.String})))
	),
	comments: Schema.optionalKey(Schema.NullOr(Schema.Array(Comment))),
	description: Schema.optionalKey(Schema.NullOr(Schema.String)),
	duration: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
	language: Schema.optionalKey(Schema.NullOr(Schema.String)),
	subtitles: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
	title: Schema.String,
	upload_date: Schema.optionalKey(Schema.NullOr(Schema.String)),
	uploader: Schema.optionalKey(Schema.NullOr(Schema.String))
})

// A video frame with the second it shows.
export type Still = typeof Still.Type
export const Still = Schema.Struct({bytes: Schema.Uint8Array, seconds: Schema.Finite})

// What Whisper returns for a recording.
export type Transcription = typeof Transcription.Type
export const Transcription = Schema.Struct({
	chunks: Schema.Array(
		Schema.Struct({text: Schema.String, timestamp: Schema.Tuple([Schema.Finite, Schema.NullOr(Schema.Finite)])})
	)
})
