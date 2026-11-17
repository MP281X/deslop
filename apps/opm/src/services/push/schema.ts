import {Schema} from 'effect'

import {Model} from 'effect/schema'

import {ApnsToken} from '@deslop/runtime/shared/apns'

import {ChapterIdentity} from '#services/chapters/schema.ts'

export type Bundle = typeof Bundle.Type
export const Bundle = Schema.Literals(['xyz.mp281x.opm', 'xyz.mp281x.opm.dev'])

export class PushError extends Schema.TaggedError<PushError>()('PushError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export class Delivery extends Model.Class<Delivery>('Delivery')({
	...ChapterIdentity.fields,
	token: Model.Sensitive(Schema.RedactedFromValue(ApnsToken))
}) {
	static readonly table = 'deliveries'
}
