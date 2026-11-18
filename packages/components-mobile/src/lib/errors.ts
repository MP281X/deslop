import {Schema} from 'effect'

export class DeviceError extends Schema.TaggedError<DeviceError>()('DeviceError', {
	cause: Schema.Defect(),
	message: Schema.String
}) {}
