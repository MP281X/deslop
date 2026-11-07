import {NodeCrypto} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Context, Effect, Layer, Ref, String, pipe} from 'effect'

import {Digest} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {Headers} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'
import {TestClock} from 'effect/testing'

import {SESSION_COOKIE} from '#services/tokens/lib/utils.ts'
import {Tokens} from '#services/tokens/service.ts'

const RESOURCE = 'https://scope.mp281x.xyz/mcp'
const VERIFIER = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
const USER = {incarnation: 'fixture', user: {id: 'github:42', name: 'octocat'}}

const open = Effect.gen(function* () {
	const store = yield* KeyValueStore.KeyValueStore
	yield* store.clear
	const failing = yield* Ref.make(false)
	const tokens = Context.get(
		yield* Layer.build(
			pipe(
				Tokens.layer,
				Layer.provide(
					Layer.succeed(
						KeyValueStore.KeyValueStore,
						KeyValueStore.make({
							...store,
							set: (key, value) =>
								Effect.flatMap(Ref.get(failing), fail => {
									if (fail) {
										return Effect.fail(
											new KeyValueStore.KeyValueStoreError({key, message: 'Disk unavailable', method: 'set'})
										)
									}
									return store.set(key, value)
								})
						})
					)
				)
			)
		),
		Tokens
	)
	const digest = yield* Digest.Digest
	const code = yield* tokens.issue(
		{
			challenge: Base64Url.encode(yield* digest.digest(Digest.sha256, new TextEncoder().encode(VERIFIER))),
			clientId: 'fixture',
			clientName: 'Fixture',
			redirectUri: 'http://127.0.0.1/callback',
			resources: [RESOURCE]
		},
		USER
	)
	return {
		exchange: tokens.exchange(
			{client_id: 'fixture', code, code_verifier: VERIFIER, grant_type: 'authorization_code'},
			{},
			user => Effect.succeed(user)
		),
		failing,
		tokens
	}
})

it.layer(Layer.merge(NodeCrypto.layer, KeyValueStore.layerMemory))(test => {
	test.effect(
		'accepts only a matching browser credential for replacement or sign-out',
		Effect.fnUntraced(function* () {
			const fixture = yield* open
			const browser = yield* fixture.tokens.startSession(USER, {}, 'GitHub', '')
			const granted = yield* fixture.exchange
			if (granted._tag !== 'Granted') return assert.fail('Expected a grant')
			for (const previous of [
				`${Array.headNonEmpty(String.split(browser.token, '.'))}.forged`,
				granted.tokens.access_token,
				granted.tokens.refresh_token
			]) {
				yield* fixture.tokens.startSession(USER, {}, 'Passkey', previous)
				yield* fixture.tokens.endSession(Headers.fromInput({cookie: `${SESSION_COOKIE}=${previous}`}))
				assert.deepStrictEqual(
					yield* fixture.tokens.session(Headers.fromInput({cookie: `${SESSION_COOKIE}=${browser.token}`})),
					USER
				)
				assert.deepStrictEqual(
					yield* fixture.tokens.access(
						Headers.fromInput({authorization: `Bearer ${granted.tokens.access_token}`}),
						RESOURCE
					),
					USER
				)
			}
		})
	)

	test.effect(
		'does not consume an authorization code before its grant is persisted',
		Effect.fnUntraced(function* () {
			const fixture = yield* open
			yield* Ref.set(fixture.failing, true)
			assert.strictEqual((yield* Effect.flip(fixture.exchange)).error, 'temporarily_unavailable')
			yield* Ref.set(fixture.failing, false)
			assert.strictEqual((yield* fixture.exchange)._tag, 'Granted')
			assert.strictEqual((yield* fixture.exchange)._tag, 'Replayed')
		})
	)

	test.effect(
		'keeps a valid bearer usable when last-use bookkeeping cannot be saved',
		Effect.fnUntraced(function* () {
			const fixture = yield* open
			const granted = yield* fixture.exchange
			if (granted._tag !== 'Granted') return assert.fail('Expected a grant')
			yield* TestClock.adjust('2 minutes')
			yield* Ref.set(fixture.failing, true)
			assert.deepStrictEqual(
				yield* fixture.tokens.access(
					Headers.fromInput({authorization: `Bearer ${granted.tokens.access_token}`}),
					RESOURCE
				),
				USER
			)
		})
	)
})
