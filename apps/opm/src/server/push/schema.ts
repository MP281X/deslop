import {Schema} from 'effect'

import {Model} from 'effect/schema'

import {ApnsToken} from '@deslop/runtime/shared/apns'

import {ChapterIdentity} from '#contracts'

// A device a chapter is announced to, taken from the registered devices in the transaction that saves the chapter; done once Apple's answer is final.
export class ChapterDelivery extends Model.Class<ChapterDelivery>('Delivery')({
	...ChapterIdentity.fields,
	done: Schema.BooleanFromBit,
	token: Model.Sensitive(Schema.RedactedFromValue(ApnsToken))
}) {
	static readonly table = 'deliveries'
}
