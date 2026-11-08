import {assert, it} from '@effect/vitest'

import {Option} from 'effect'

import {allowedRedirect, matchingRedirect, returnable} from './utils.ts'

it('accepts loopback callbacks on any port, but not arbitrary web callbacks', () => {
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

it('accepts only exact first-party web callbacks and returns to Auth itself', () => {
	assert.isTrue(allowedRedirect('https://scope.mp281x.xyz/auth/callback'))
	assert.isTrue(
		returnable('https://auth.mp281x.xyz/api/auth/oauth2/authorize?state=example', 'https://auth.mp281x.xyz')
	)
	for (const invalid of [
		'https://nested.scope.mp281x.xyz/auth/callback',
		'https://-scope.mp281x.xyz/auth/callback',
		'https://scope-.mp281x.xyz/auth/callback',
		'http://scope.mp281x.xyz/auth/callback',
		'https://scope.mp281x.xyz:443/auth/callback',
		'https://scope.mp281x.xyz/auth/callback/',
		'https://scope.mp281x.xyz/auth/callback?next=elsewhere',
		'https://scope.mp281x.xyz/auth/callback#fragment',
		'https://scope.mp281x.xyz.evil.test/auth/callback'
	]) {
		assert.isFalse(allowedRedirect(invalid), invalid)
	}
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
