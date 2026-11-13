import {Schema, pipe} from 'effect'

import {DurationFromSeconds} from '@deslop/runtime/shared/time'

export class MediaError extends Schema.TaggedError<MediaError>()('MediaError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type Comment = typeof Comment.Type
export const Comment = Schema.Struct({
	author: Schema.OptionFromOptionalNullOr(Schema.String),
	author_is_uploader: Schema.OptionFromOptionalNullOr(Schema.Boolean),
	is_pinned: Schema.OptionFromOptionalNullOr(Schema.Boolean),
	like_count: Schema.OptionFromOptionalNullOr(Schema.Finite),
	parent: Schema.OptionFromOptionalNullOr(Schema.String),
	text: Schema.String
})

// Caption records are opaque to Stash; yt-dlp downloads their supported formats.
export type Metadata = typeof Metadata.Type
export const Metadata = Schema.Struct({
	_type: Schema.OptionFromOptionalKey(Schema.String),
	automatic_captions: Schema.OptionFromOptionalNullOr(Schema.Record(Schema.String, Schema.Array(Schema.JsonObject))),
	chapters: Schema.OptionFromOptionalNullOr(
		Schema.Array(Schema.Struct({start_time: DurationFromSeconds, title: Schema.String}))
	),
	comments: Schema.OptionFromOptionalNullOr(Schema.Array(Comment)),
	description: Schema.OptionFromOptionalNullOr(Schema.String),
	duration: Schema.OptionFromOptionalNullOr(DurationFromSeconds),
	language: Schema.OptionFromOptionalNullOr(Schema.String),
	subtitles: Schema.OptionFromOptionalNullOr(Schema.Record(Schema.String, Schema.Array(Schema.JsonObject))),
	title: Schema.String,
	upload_date: Schema.OptionFromOptionalNullOr(Schema.String),
	uploader: Schema.OptionFromOptionalNullOr(Schema.String)
})

export type Still = typeof Still.Type
export const Still = Schema.Struct({bytes: Schema.Uint8Array, seconds: DurationFromSeconds})

export type Probe = typeof Probe.Type
export const Probe = Schema.Struct({
	format: Schema.OptionFromOptionalKey(
		Schema.Struct({
			duration: Schema.OptionFromOptionalKey(pipe(Schema.FiniteFromString, Schema.decodeTo(DurationFromSeconds)))
		})
	),
	streams: Schema.Array(Schema.Struct({codec_type: Schema.String, index: Schema.Int}))
})

export type CreatorCaptions = typeof CreatorCaptions.Type
// TikTok's creator-caption JSON is not convertible by FFmpeg.
export const CreatorCaptions = Schema.Struct({
	utterances: Schema.Array(Schema.Struct({start_time: Schema.DurationFromMillis, text: Schema.String}))
})
