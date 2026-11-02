import {Schema} from 'effect'

export class AppError extends Schema.TaggedError<AppError>()('AppError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}
