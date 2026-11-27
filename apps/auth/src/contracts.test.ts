import {assert, describe, it} from '@effect/vitest'

import {Option} from 'effect'

import {returnTarget} from '#contracts'

describe('browser return URLs', () => {
	it.each([
		['https://mp281x.xyz/path', 'https://mp281x.xyz/path'],
		['https://gateway.mp281x.xyz/path?x=1', 'https://gateway.mp281x.xyz/path?x=1'],
		['https://nested.gateway.mp281x.xyz/', 'https://nested.gateway.mp281x.xyz/'],
		['https://gateway.mp281x.xyz/?q=a\nb', 'https://gateway.mp281x.xyz/?q=ab'],
		['http://gateway.mp281x.xyz/', undefined],
		['https://mp281x.xyz.attacker.example/', undefined],
		['https://notmp281x.xyz/', undefined],
		['https://person@gateway.mp281x.xyz/', undefined],
		['/relative', undefined]
	])('%s', (next, target) => {
		assert.strictEqual(Option.getOrUndefined(returnTarget(next, 'https://auth.mp281x.xyz', false)), target)
	})

	it('limits local sign-in to the same origin', () => {
		assert.isTrue(Option.isSome(returnTarget('http://localhost:5101/path', 'http://localhost:5101', true)))
		assert.isTrue(Option.isNone(returnTarget('http://localhost:5102/path', 'http://localhost:5101', true)))
	})
})
