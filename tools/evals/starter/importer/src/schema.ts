import {Schema} from 'effect'

export type Row = typeof Row.Type
export const Row = Schema.Struct({id: Schema.String, source: Schema.String, title: Schema.String})

export type Progress = typeof Progress.Type
export const Progress = Schema.Struct({file: Schema.String, id: Schema.String})

export class ImportError extends Schema.TaggedError<ImportError>()('ImportError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}
