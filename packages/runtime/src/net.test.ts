import {assert, it} from '@effect/vitest'

import {Array} from 'effect'

import {isIpAddress, isPublicAddress} from '#net.ts'

it('takes only the addresses the internet routes to as public', () => {
	assert.isTrue(
		Array.every(['1.1.1.1', '8.8.8.8', '2606:4700::1111', '2a00:1450:4001::1', '::ffff:8.8.8.8'], isPublicAddress)
	)
	assert.isFalse(
		Array.some(
			[
				'0.1.2.3',
				'10.0.0.1',
				'100.64.0.1',
				'127.0.0.1',
				'169.254.1.1',
				'172.16.0.1',
				'192.0.2.1',
				'192.31.196.1',
				'192.52.193.1',
				'192.88.99.1',
				'192.168.0.1',
				'192.175.48.1',
				'198.18.0.1',
				'198.51.100.1',
				'203.0.113.1',
				'224.0.0.1',
				'240.0.0.1',
				'255.255.255.255',
				'::',
				'::1',
				'::ffff:10.0.0.1',
				'100::1',
				'64:ff9b::1',
				'2001::1',
				'2001:2::1',
				'2001:db8::1',
				'2002::1',
				'2002:0a00:0001::1',
				'2620:4f:8000::1',
				'3fff::1',
				'5f00::1',
				'fc00::1',
				'fe80::1',
				'fec0::1',
				'ff02::1'
			],
			isPublicAddress
		)
	)
	assert.isFalse(isIpAddress('example.org'))
	assert.isTrue(isIpAddress('2001:db8::1'))
})
