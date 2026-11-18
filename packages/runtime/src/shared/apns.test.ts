import {assert, it} from '@effect/vitest'

import {Option} from 'effect'

import {apnsAnswer, deviceHeaders, tooLargeAnswer} from './apns.ts'

function answer(status: number, reason?: string) {
	return apnsAnswer({channel: Option.none(), reason: Option.fromUndefinedOr(reason), status})._tag
}

it('separates accepted delivery, retry, dead tokens, oversized payloads and permanent refusal', () => {
	assert.deepStrictEqual(
		[
			answer(200),
			answer(429),
			answer(500),
			answer(503),
			answer(410),
			answer(400, 'BadDeviceToken'),
			answer(400, 'Unregistered'),
			answer(403, 'ExpiredProviderToken'),
			answer(413, 'PayloadTooLarge'),
			answer(403),
			answer(400, 'TopicDisallowed')
		],
		[
			'Accepted',
			'Retry',
			'Retry',
			'Retry',
			'DeadToken',
			'DeadToken',
			'DeadToken',
			'Retry',
			'TooLarge',
			'Refused',
			'Refused'
		]
	)
})

it('answers a body past Apple’s limit as too large, and leaves one at the limit to Apple', () => {
	assert.deepStrictEqual(
		[
			Option.map(tooLargeAnswer(4096), outcome => outcome._tag),
			Option.map(tooLargeAnswer(4097), outcome => outcome._tag)
		],
		[Option.none(), Option.some('TooLarge')]
	)
})

it('sends a collapse id as Apple’s collapse header, and none when the alert has none', () => {
	assert.deepStrictEqual(
		[
			deviceHeaders('xyz.example.app', 'alert', 10, 'onepunch:200')['apns-collapse-id'],
			deviceHeaders('xyz.example.app', 'alert', 10)['apns-collapse-id']
		],
		['onepunch:200', undefined]
	)
})
