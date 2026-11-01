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

// Caption records are opaque to Stash; yt-dlp downloads their supported formats.
export type Metadata = typeof Metadata.Type
export const Metadata = Schema.Struct({
	_type: Schema.optionalKey(Schema.String),
	automatic_captions: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Array(Schema.JsonObject)))),
	chapters: Schema.optionalKey(
		Schema.NullOr(Schema.Array(Schema.Struct({start_time: Schema.Finite, title: Schema.String})))
	),
	comments: Schema.optionalKey(Schema.NullOr(Schema.Array(Comment))),
	description: Schema.optionalKey(Schema.NullOr(Schema.String)),
	duration: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
	language: Schema.optionalKey(Schema.NullOr(Schema.String)),
	subtitles: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Array(Schema.JsonObject)))),
	title: Schema.String,
	upload_date: Schema.optionalKey(Schema.NullOr(Schema.String)),
	uploader: Schema.optionalKey(Schema.NullOr(Schema.String))
})

// A video frame with the second it shows.
export type Still = typeof Still.Type
export const Still = Schema.Struct({bytes: Schema.Uint8Array, seconds: Schema.Finite})

export type Probe = typeof Probe.Type
// ffprobe describes subtitle tracks before any speech is sent to a provider.
export const Probe = Schema.Struct({
	format: Schema.optionalKey(Schema.Struct({duration: Schema.optionalKey(Schema.String)})),
	streams: Schema.Array(Schema.Struct({codec_type: Schema.String, index: Schema.Int}))
})

export type CreatorCaptions = typeof CreatorCaptions.Type
// TikTok's creator-caption JSON is not convertible by FFmpeg.
export const CreatorCaptions = Schema.Struct({
	utterances: Schema.Array(Schema.Struct({start_time: Schema.Finite, text: Schema.String}))
})
