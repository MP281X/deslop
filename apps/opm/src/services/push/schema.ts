import {Schema} from 'effect'

import {Model} from 'effect/schema'

import {ApnsToken} from '@deslop/runtime/shared/apns'

import {ChapterIdentity} from '#services/chapters/schema.ts'

export type ChapterBundle = typeof ChapterBundle.Type
export const ChapterBundle = Schema.Literals(['xyz.mp281x.opm', 'xyz.mp281x.opm.dev'])

export class ChapterPushError extends Schema.TaggedError<ChapterPushError>()('PushError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export class ChapterDelivery extends Model.Class<ChapterDelivery>('Delivery')({
	...ChapterIdentity.fields,
	token: Model.Sensitive(Schema.RedactedFromValue(ApnsToken))
}) {
	static readonly table = 'deliveries'
}
