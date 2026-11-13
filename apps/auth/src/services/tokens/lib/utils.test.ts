import {assert, it} from '@effect/vitest'

import {Option} from 'effect'

import {Headers} from 'effect/http'

import {addressGroup, allowedRedirect, clientAddress, matchingRedirect, returnable} from './utils.ts'

it('trusts the last forwarded address and falls back to the socket peer', () => {
	assert.deepStrictEqual(
		clientAddress(Headers.fromInput({'x-forwarded-for': 'forged,  203.0.113.2 '}), Option.some('127.0.0.1')),
		Option.some('203.0.113.2')
	)
	assert.deepStrictEqual(
		clientAddress(Headers.fromInput({'x-forwarded-for': ''}), Option.some('127.0.0.1')),
		Option.some('127.0.0.1')
	)
	assert.deepStrictEqual(clientAddress(Headers.empty, Option.none()), Option.none())
})

it('shares an IPv6 quota across a prefix and treats mapped IPv4 as IPv4', () => {
	assert.strictEqual(addressGroup('2001:db8:1234:5678::1'), addressGroup('2001:db8:1234:5678:ffff::2'))
	assert.strictEqual(addressGroup('::ffff:192.0.2.3'), '192.0.2.3')
	assert.strictEqual(addressGroup('192.0.2.4'), '192.0.2.4')
})

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
