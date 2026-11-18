import {Boolean, Option, Result, Schema, pipe} from 'effect'

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

export type ApnsPushType = typeof ApnsPushType.Type
const ApnsPushType = Schema.Literals(['alert', 'liveactivity'])
export type ApnsPriority = typeof ApnsPriority.Type
const ApnsPriority = Schema.Literals([5, 10])

// What Apple reads beside a device push's body; a later alert with the same collapse id replaces the one on the phone.
export function deviceHeaders(
	bundle: string,
	type: ApnsPushType,
	priority: ApnsPriority,
	collapseId?: string
): Record<string, string> {
	return {
		'apns-priority': `${priority}`,
		'apns-push-type': type,
		'apns-topic': Boolean.match(type === 'liveactivity', {
			onFalse: () => bundle,
			onTrue: () => `${bundle}.push-type.liveactivity`
		}),
		...Option.match(Option.fromUndefinedOr(collapseId), {onNone: () => ({}), onSome: id => ({'apns-collapse-id': id})})
	}
}

const answerFields = {channel: Schema.Option(Schema.String), reason: Schema.Option(Schema.String), status: Schema.Int}
export type ApnsAnswer = typeof ApnsAnswer.Type
// `TooLarge` is the payload's fault, never the token's: no device or channel is retired for it.
export const ApnsAnswer = Schema.TaggedUnion({
	Accepted: answerFields,
	DeadToken: answerFields,
	Refused: answerFields,
	Retry: answerFields,
	TooLarge: answerFields
})

// Apple's notification body limit is 4096 bytes; a larger one is answered without asking Apple.
export function tooLargeAnswer(bytes: number) {
	return pipe(
		bytes,
		Option.liftPredicate(size => size > 4096),
		Option.map(() =>
			ApnsAnswer.cases.TooLarge.make({channel: Option.none(), reason: Option.some('PayloadTooLarge'), status: 413})
		)
	)
}

// A channel that Apple did not confirm deleting is still Apple's, so an unstarted activity keeps naming it.
export function unconfirmedChannel(channel: string, deleted: Result.Result<ApnsAnswer, unknown>) {
	return Option.liftPredicate(
		channel,
		() => Result.isFailure(deleted) || ApnsAnswer.isAnyOf(['Retry'])(deleted.success)
	)
}

export function apnsAnswer(answer: {channel: Option.Option<string>; reason: Option.Option<string>; status: number}) {
	if (answer.status >= 200 && answer.status < 300) return ApnsAnswer.cases.Accepted.make(answer)
	if (answer.status === 413 || Option.contains(answer.reason, 'PayloadTooLarge')) {
		return ApnsAnswer.cases.TooLarge.make(answer)
	}
	// An expired provider token is our signature's fault: the token is renewed and the device kept.
	if (Option.contains(answer.reason, 'ExpiredProviderToken')) return ApnsAnswer.cases.Retry.make(answer)
	if (
		answer.status === 410 ||
		Option.exists(answer.reason, reason => reason === 'BadDeviceToken' || reason === 'Unregistered')
	) {
		return ApnsAnswer.cases.DeadToken.make(answer)
	}
	if (answer.status === 429 || answer.status >= 500) return ApnsAnswer.cases.Retry.make(answer)
	return ApnsAnswer.cases.Refused.make(answer)
}
