import {assert, it} from '@effect/vitest'

import {Array} from 'effect'

import {isPublicAddress} from '#shared/net.ts'

it('permits public destinations and refuses local or reserved addresses', () => {
	assert.isTrue(Array.every(['8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8'], isPublicAddress))
	assert.isFalse(
		Array.some(['127.0.0.1', '192.168.1.2', '::1', 'fc00::1', '::ffff:10.0.0.1', '192.0.2.1'], isPublicAddress)
	)
})
