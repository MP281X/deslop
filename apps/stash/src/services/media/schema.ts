import {Schema} from 'effect'

export class MediaError extends Schema.TaggedError<MediaError>()('MediaError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}
