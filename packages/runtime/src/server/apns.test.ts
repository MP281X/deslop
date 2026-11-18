import {assert, it} from '@effect/vitest'

import {Option} from 'effect'

import {deviceHeaders, tooLargeAnswer} from '#server/apns.ts'
import {APNS_PAYLOAD_BYTES} from '#shared/apns.ts'

it('answers a body past Apple’s limit as too large, and leaves one at the limit to Apple', () => {
	assert.deepStrictEqual(
		[
			Option.map(tooLargeAnswer(APNS_PAYLOAD_BYTES), answer => answer._tag),
			Option.map(tooLargeAnswer(APNS_PAYLOAD_BYTES + 1), answer => answer._tag)
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
