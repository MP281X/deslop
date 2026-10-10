import {Schema} from 'effect'

export class MediaError extends Schema.TaggedError<MediaError>()('MediaError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type Transcript = typeof Transcript.Type
export const Transcript = Schema.Struct({
	// Published captions, or speech recognized locally with Whisper.
	source: Schema.Literals(['captions', 'whisper']),
	// One `[mm:ss] text` line per caption or speech segment.
	text: Schema.String
})
