import {assert, describe, it} from '@effect/vitest'

import {Option} from 'effect'

import {browserOf, deviceOf, returnTarget} from './utils.ts'

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

describe('session clients', () => {
	it.each([
		[
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
			['Safari', 'iPhone']
		],
		[
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
			['Chrome', 'iPhone']
		],
		[
			'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
			['Safari', 'iPad']
		],
		[
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
			['Edge', 'Mac']
		],
		[
			'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
			['Chrome', 'Android']
		],
		['Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0', ['Firefox', 'Linux']],
		[
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 OPR/115.0',
			['Opera', 'Windows']
		],
		['curl/8.5.0', ['Browser', undefined]],
		['Browser', ['Browser', undefined]]
	])('%s', (agent, client) => {
		assert.deepStrictEqual([browserOf(agent), Option.getOrUndefined(deviceOf(agent))], client)
	})
})
