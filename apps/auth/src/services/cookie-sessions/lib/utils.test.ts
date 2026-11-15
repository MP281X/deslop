import {assert, describe, it} from '@effect/vitest'

import {returnable} from './utils.ts'

describe('browser return URLs', () => {
	it.each([
		['https://mp281x.xyz/path', true],
		['https://gateway.mp281x.xyz/path?x=1', true],
		['https://nested.gateway.mp281x.xyz/', true],
		['http://gateway.mp281x.xyz/', false],
		['https://mp281x.xyz.attacker.example/', false],
		['https://notmp281x.xyz/', false],
		['https://person@gateway.mp281x.xyz/', false],
		['/relative', false]
	])('%s', (next, allowed) => {
		assert.strictEqual(returnable(next, 'https://auth.mp281x.xyz', false), allowed)
	})

	it('limits local sign-in to the same origin', () => {
		assert.strictEqual(returnable('http://localhost:5101/path', 'http://localhost:5101', true), true)
		assert.strictEqual(returnable('http://localhost:5102/path', 'http://localhost:5101', true), false)
	})
})
