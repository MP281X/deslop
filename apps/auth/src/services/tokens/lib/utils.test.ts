import {assert, it} from '@effect/vitest'

import {Option} from 'effect'

import {Headers} from 'effect/http'

import {allowedRedirect, fromAuth, matchingRedirect, returnable} from './utils.ts'

it('accepts loopback callbacks on any port, and no other web callback', () => {
	const client = {name: 'Codex', redirects: ['http://127.0.0.1:1234/callback']} as const
	assert.isTrue(Option.isSome(matchingRedirect(client, Option.some('http://127.0.0.1:5678/callback'))))
	assert.isTrue(Option.isNone(matchingRedirect(client, Option.some('http://127.0.0.1:5678/elsewhere'))))
	for (const invalid of [
		'https://desktop.tailnet-8c4c.ts.net:23475/auth/callback',
		'http://127.0.0.1:1234/callback?next=elsewhere',
		'https://evil.test/auth/callback'
	]) {
		assert.isFalse(allowedRedirect(invalid), invalid)
	}
	assert.isFalse(returnable('https://desktop.tailnet-8c4c.ts.net:23475/', 'https://auth.mp281x.xyz'))
})

it('takes requests from Auth’s own origin, and in development from the host serving the preview', () => {
	const preview = {host: 'desktop.tailnet-8c4c.ts.net:23475', origin: 'https://desktop.tailnet-8c4c.ts.net:23475'}
	assert.isTrue(fromAuth(Headers.fromInput({origin: 'https://auth.mp281x.xyz'}), false))
	assert.isFalse(fromAuth(Headers.fromInput(preview), false))
	assert.isTrue(fromAuth(Headers.fromInput(preview), true))
	assert.isFalse(fromAuth(Headers.fromInput({...preview, origin: 'https://evil.test'}), true))
	assert.isFalse(fromAuth(Headers.fromInput({host: preview.host}), true))
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
