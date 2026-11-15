import {assert, describe, it} from '@effect/vitest'

import {returnable, sessionLabel} from './utils.ts'

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

describe('session labels', () => {
	it.each([
		[
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
			'Safari on iPhone'
		],
		[
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
			'Chrome on iPhone'
		],
		[
			'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
			'Safari on iPad'
		],
		[
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
			'Edge on Mac'
		],
		[
			'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
			'Chrome on Android'
		],
		['Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0', 'Firefox on Linux'],
		[
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 OPR/115.0',
			'Opera on Windows'
		],
		['curl/8.5.0', 'Browser'],
		['Browser', 'Browser']
	])('%s', (agent, label) => {
		assert.strictEqual(sessionLabel(agent), label)
	})
})
