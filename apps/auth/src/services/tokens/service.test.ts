import {NodeCrypto} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {Array, ConfigProvider, Effect, Layer, Option, Order, Schema, pipe} from 'effect'

import {Digest} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {Reactivity} from 'effect/reactivity'
import {TestClock} from 'effect/testing'

import {ClientId} from '@deslop/runtime/shared/auth'

import {CredentialOwner, Origin} from '#services/tokens/schema.ts'
import {Tokens} from '#services/tokens/service.ts'

const VERIFIER = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
const USER = Schema.decodeSync(CredentialOwner)({incarnation: 'fixture', user: {id: 'github:42', name: 'octocat'}})
const ORIGIN = Schema.decodeSync(Origin)({})

const tokensLayer = pipe(
	Tokens.layer,
	Layer.provide(Layer.merge(SqliteClient.layer({filename: ':memory:'}), Reactivity.layer)),
	Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({APP_URL: 'https://issuer.mp281x.xyz'}))),
	Layer.provideMerge(NodeCrypto.layer)
)

const exchange = Effect.gen(function* () {
	const tokens = yield* Tokens
	const digest = yield* Digest.Digest
	const code = yield* tokens.issue(
		{
			challenge: Base64Url.encode(yield* digest.digest(Digest.sha256, new TextEncoder().encode(VERIFIER))),
			clientId: ClientId.make('fixture'),
			clientName: 'Fixture',
			parent: Option.none(),
			redirectUri: 'http://127.0.0.1/callback',
			state: Option.none()
		},
		USER
	)
	return {
		redeem: tokens.exchange(
			{
				client_id: ClientId.make('fixture'),
				code,
				code_verifier: VERIFIER,
				grant_type: 'authorization_code',
				redirect_uri: Option.none()
			},
			ORIGIN,
			Effect.succeed
		)
	}
})

it.layer(tokensLayer)(test => {
	test.effect(
		'grants an authorization code once across concurrent exchanges',
		Effect.fnUntraced(function* () {
			const fixture = yield* exchange
			assert.deepStrictEqual(
				pipe(
					yield* Effect.all([fixture.redeem, fixture.redeem], {concurrency: 'unbounded'}),
					Array.map(result => result._tag),
					Array.sort(Order.String)
				),
				['Granted', 'Replayed']
			)
		})
	)

	test.effect(
		'expires an authorization code after one minute',
		Effect.fnUntraced(function* () {
			const fixture = yield* exchange
			yield* TestClock.adjust('2 minutes')
			assert.strictEqual((yield* Effect.flip(fixture.redeem)).error, 'invalid_grant')
		})
	)
})
