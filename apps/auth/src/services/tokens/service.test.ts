import {NodeCrypto} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {Array, ConfigProvider, Context, Effect, Layer, String, pipe} from 'effect'

import {Digest} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {Headers} from 'effect/http'
import {Jwks, Jwt} from 'effect/jose'
import {Reactivity} from 'effect/reactivity'
import {SqlClient} from 'effect/sql'
import {TestClock} from 'effect/testing'

import {AccessClaims, SESSION_COOKIE} from '@deslop/runtime/shared/auth'

import {AppGrant} from '#services/tokens/schema.ts'
import {Tokens} from '#services/tokens/service.ts'

const VERIFIER = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
const USER = {incarnation: 'fixture', user: {id: 'github:42', name: 'octocat'}}

const open = Effect.gen(function* () {
	const context = yield* Layer.build(
		pipe(
			Tokens.layer,
			Layer.provideMerge(Layer.merge(SqliteClient.layer({filename: ':memory:'}), Reactivity.layer)),
			Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({APP_URL: 'https://issuer.mp281x.xyz/nested'})))
		)
	)
	const tokens = Context.get(context, Tokens)
	const sql = Context.get(context, SqlClient.SqlClient)
	const digest = yield* Digest.Digest
	const code = yield* tokens.issue(
		{
			challenge: Base64Url.encode(yield* digest.digest(Digest.sha256, new TextEncoder().encode(VERIFIER))),
			clientId: 'fixture',
			clientName: 'Fixture',
			redirectUri: 'http://127.0.0.1/callback'
		},
		USER
	)
	return {
		exchange: tokens.exchange(
			{client_id: 'fixture', code, code_verifier: VERIFIER, grant_type: 'authorization_code'},
			{},
			user => Effect.succeed(user)
		),
		// The database refuses one kind of write to the app grants, as a full disk would, until `recover`.
		fail: (write: 'INSERT' | 'UPDATE') =>
			sql`CREATE TEMP TRIGGER refuse BEFORE ${sql.literal(write)} ON ${sql(AppGrant.table)} BEGIN SELECT RAISE(ABORT, 'Disk unavailable'); END`,
		recover: sql`DROP TRIGGER temp.refuse`,
		tokens
	}
})

it.layer(NodeCrypto.layer)(test => {
	test.effect(
		'uses the configured Auth origin as the token issuer',
		Effect.fnUntraced(function* () {
			const fixture = yield* open
			const granted = yield* fixture.exchange
			if (granted._tag !== 'Granted') return assert.fail('Expected a grant')
			assert.strictEqual(
				(yield* Effect.provideService(
					Jwt.verifyWithKeySet(AccessClaims, granted.tokens.access_token, {
						algorithms: ['EdDSA'],
						audience: 'deslop',
						issuer: 'https://issuer.mp281x.xyz/api/auth',
						typ: 'at+jwt'
					}),
					Jwks.Jwks,
					yield* Jwks.makeLocal(fixture.tokens.jwks)
				)).claims.iss,
				'https://issuer.mp281x.xyz/api/auth'
			)
		})
	)

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
					yield* fixture.tokens.verify(Headers.fromInput({authorization: `Bearer ${granted.tokens.access_token}`})),
					USER
				)
			}
		})
	)

	test.effect(
		'does not consume an authorization code before its grant is persisted',
		Effect.fnUntraced(function* () {
			const fixture = yield* open
			yield* fixture.fail('INSERT')
			assert.strictEqual((yield* Effect.flip(fixture.exchange)).error, 'temporarily_unavailable')
			yield* fixture.recover
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
			yield* fixture.fail('UPDATE')
			assert.deepStrictEqual(
				yield* fixture.tokens.verify(Headers.fromInput({authorization: `Bearer ${granted.tokens.access_token}`})),
				USER
			)
		})
	)
})
