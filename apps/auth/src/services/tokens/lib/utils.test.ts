import {assert, it} from '@effect/vitest'

import {Option} from 'effect'

import {allowedRedirect, matchingRedirect, returnable} from './utils.ts'

it('accepts exact worker preview callbacks without widening cookie returns or loopback matching', () => {
	const callback = 'https://dev.tailnet-8c4c.ts.net:26493/auth/callback'
	assert.isTrue(allowedRedirect(callback))
	assert.isTrue(allowedRedirect('https://desktop.tailnet-8c4c.ts.net:20000/auth/callback'))
	assert.isTrue(allowedRedirect('https://dev.tailnet-8c4c.ts.net:29999/auth/callback'))
	for (const invalid of [
		'https://dev.tailnet-8c4c.ts.net:19999/auth/callback',
		'https://dev.tailnet-8c4c.ts.net:30000/auth/callback',
		'http://dev.tailnet-8c4c.ts.net:26493/auth/callback',
		'https://dev.tailnet-8c4c.ts.net.evil.test:26493/auth/callback',
		'https://dev.other-tailnet.ts.net:26493/auth/callback',
		'https://evil@dev.tailnet-8c4c.ts.net:26493/auth/callback',
		'https://dev.tailnet-8c4c.ts.net:26493/elsewhere',
		`${callback}?next=elsewhere`,
		`${callback}#elsewhere`
	]) {
		assert.isFalse(allowedRedirect(invalid), invalid)
	}
	const client = {name: 'Stash preview', redirects: [callback]} as const
	assert.isTrue(Option.isSome(matchingRedirect(client, Option.some(callback))))
	assert.isTrue(
		Option.isNone(matchingRedirect(client, Option.some('https://dev.tailnet-8c4c.ts.net:26494/auth/callback')))
	)
	assert.isFalse(returnable(callback, 'https://auth.mp281x.xyz'))
	assert.isTrue(allowedRedirect('http://127.0.0.1:1234/callback'))
})

it('accepts the gateway’s per-server callback and nothing around it', () => {
	assert.isTrue(allowedRedirect('https://gateway.mp281x.xyz/oauth/callback/stash'))
	for (const invalid of [
		'https://gateway.mp281x.xyz/oauth/callback',
		'https://gateway.mp281x.xyz/oauth/callback/',
		'https://gateway.mp281x.xyz/oauth/callback/stash/elsewhere',
		'https://gateway.mp281x.xyz/oauth/callback/stash?next=elsewhere',
		'https://gateway.mp281x.xyz/oauth/callback/stash#elsewhere',
		'https://gateway.mp281x.xyz.evil.test/oauth/callback/stash',
		'https://evil.test/oauth/callback/stash',
		'https://auth.mp281x.xyz/oauth/callback/stash'
	]) {
		assert.isFalse(allowedRedirect(invalid), invalid)
	}
})
