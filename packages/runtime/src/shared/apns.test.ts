import {assert, it} from '@effect/vitest'

import {Option} from 'effect'

import {apnsAnswer} from './apns.ts'

function answer(status: number, reason?: string) {
	return apnsAnswer({channel: Option.none(), reason: Option.fromUndefinedOr(reason), status})._tag
}

it('separates accepted delivery, retry, dead tokens and permanent refusal', () => {
	assert.deepStrictEqual(
		[
			answer(200),
			answer(429),
			answer(500),
			answer(503),
			answer(410),
			answer(400, 'BadDeviceToken'),
			answer(400, 'Unregistered'),
			answer(403),
			answer(400, 'TopicDisallowed')
		],
		['Accepted', 'Retry', 'Retry', 'Retry', 'DeadToken', 'DeadToken', 'DeadToken', 'Refused', 'Refused']
	)
})
