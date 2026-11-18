import {assert, it} from '@effect/vitest'

import {upgradeOnlyHeaders} from './http.ts'

it('keeps identity headers from the upgrade request and drops them from frames', () => {
	assert.deepStrictEqual(
		upgradeOnlyHeaders([
			['cookie', 'session'],
			['x-deslop-client', '100.64.0.1'],
			['x-deslop-frame', ''],
			['X-Deslop-Client', '100.64.0.2'],
			['x-deslop-user', 'github:1'],
			['x-probe-caller', 'member']
		]),
		[
			['cookie', 'session'],
			['x-deslop-client', '100.64.0.1'],
			['x-probe-caller', 'member']
		]
	)
	assert.deepStrictEqual(upgradeOnlyHeaders([['x-deslop-user', 'github:1']]), [])
})
