import {Option, Schema, pipe} from 'effect'

import {Model} from 'effect/schema'

export type ApnsToken = typeof ApnsToken.Type
export const ApnsToken = pipe(Schema.String.check(Schema.isPattern(/^[0-9a-f]{32,512}$/iu)), Schema.brand('ApnsToken'))

// A token addresses one device and kind; the bundle selects Apple's production or sandbox transport.
export class Device extends Model.Class<Device>('Device')({
	bundle: Schema.String,
	kind: Schema.Literals(['alert', 'start']),
	token: Model.Sensitive(Schema.RedactedFromValue(ApnsToken))
}) {
	static readonly table = 'devices'
}

const answerFields = {channel: Schema.Option(Schema.String), reason: Schema.Option(Schema.String), status: Schema.Int}
export type ApnsAnswer = typeof ApnsAnswer.Type
export const ApnsAnswer = Schema.TaggedUnion({
	Accepted: answerFields,
	DeadToken: answerFields,
	Refused: answerFields,
	Retry: answerFields
})

export function apnsAnswer(answer: {channel: Option.Option<string>; reason: Option.Option<string>; status: number}) {
	if (answer.status >= 200 && answer.status < 300) return ApnsAnswer.cases.Accepted.make(answer)
	if (
		answer.status === 410 ||
		Option.exists(answer.reason, reason => reason === 'BadDeviceToken' || reason === 'Unregistered')
	) {
		return ApnsAnswer.cases.DeadToken.make(answer)
	}
	if (answer.status === 429 || answer.status >= 500) return ApnsAnswer.cases.Retry.make(answer)
	return ApnsAnswer.cases.Refused.make(answer)
}
