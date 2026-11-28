import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'
import {Model} from 'effect/schema'

import {ApnsToken, Device} from '@deslop/runtime/shared/apns'

import {ChapterIdentity} from '#chapters/contract.ts'

export type ChapterBundle = typeof ChapterBundle.Type
export const ChapterBundle = Schema.Literals(['xyz.mp281x.opm', 'xyz.mp281x.opm.dev'])

export class ChapterPushError extends Schema.TaggedError<ChapterPushError>()('PushError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export const PushRpcs = RpcGroup.make(
	Rpc.make('push.register', {
		error: ChapterPushError,
		payload: Device.insert.mapFields(fields => ({...fields, bundle: ChapterBundle, kind: Schema.Literal('start')}))
	})
)

// A device a chapter is announced to, taken from the registered devices in the transaction that saves the chapter; done once Apple's answer is final.
export class ChapterDelivery extends Model.Class<ChapterDelivery>('Delivery')({
	...ChapterIdentity.fields,
	done: Schema.BooleanFromBit,
	token: Model.Sensitive(Schema.RedactedFromValue(ApnsToken))
}) {
	static readonly table = 'deliveries'
}
