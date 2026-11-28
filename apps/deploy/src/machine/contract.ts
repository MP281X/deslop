import {Schema} from 'effect'

export class DeployError extends Schema.TaggedError<DeployError>()('DeployError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}
