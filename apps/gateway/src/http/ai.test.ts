import {gzipSync} from 'node:zlib'

import {NodeCrypto, NodeHttpServer, NodeServices} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Boolean,
	Clock,
	ConfigProvider,
	Context,
	Effect,
	Layer,
	Option,
	Queue,
	Redacted,
	Ref,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {Signature} from 'effect/crypto'
import {HttpClient, HttpClientResponse, HttpRouter, HttpServerResponse} from 'effect/http'
import {Jwk, Jwt} from 'effect/jose'
import {Reactivity} from 'effect/reactivity'
import {SqlClient} from 'effect/sql'

import {Auth} from '@deslop/runtime/server/auth'
import {Sessions} from '@deslop/runtime/server/sessions'
import {AccessClaims} from '@deslop/runtime/shared/auth'

import {AiHttpHandlers} from '#http/handlers.ts'
import {AiProxy} from '#services/ai-proxy/service.ts'

const JSON_BODY = '{ "model": "test", "usage": {"input_tokens": 10, "output_tokens": 5} }'
const SSE_BODY =
	'event: message_start\ndata: {"message":{"model":"test","usage":{"input_tokens":10}}}\n\nevent: message_delta\ndata: {"usage":{"output_tokens":5}}\n\n'

const fixture = Effect.fnUntraced(function* (compressed?: HttpClient.HttpClient) {
	const signature = Context.get(yield* Layer.build(NodeCrypto.layer), Signature.Signature)
	const pair = yield* Effect.provideService(
		Jwk.generateKeyPair({algorithm: 'EdDSA', kid: 'test'}),
		Signature.Signature,
		signature
	)
	const signingKey = yield* Effect.provideService(
		Jwk.importPrivate(pair.privateKey, 'EdDSA'),
		Signature.Signature,
		signature
	)
	const down = yield* Ref.make(false)
	const sign = Effect.fnUntraced(function* (expires: number = 600) {
		const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
		return Redacted.value(
			yield* Effect.provideService(
				Jwt.sign(
					AccessClaims,
					{
						aud: 'deslop',
						azp: 'Stash',
						exp: now + expires,
						iat: now,
						iss: 'https://auth.mp281x.xyz/api/auth',
						name: 'Alice',
						sid: 'family',
						sub: 'alice'
					},
					signingKey,
					{kid: 'test', typ: 'at+jwt'}
				),
				Signature.Signature,
				signature
			)
		)
	})
	const calls = yield* Queue.unbounded<{key: string; url: string; body: string}>()
	const pricingDown = yield* Ref.make(false)
	const database = yield* Layer.build(Layer.merge(SqliteClient.layer({filename: ':memory:'}), Reactivity.layer))
	const client = HttpClient.make(request =>
		Effect.gen(function* () {
			if (request.url === 'https://auth.mp281x.xyz/.well-known/jwks.json') {
				if (yield* Ref.get(down)) return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 503}))
				return HttpClientResponse.fromWeb(request, Response.json({keys: [pair.publicKey]}))
			}
			if (compressed !== undefined && String.includes('/gzip')(request.url)) return yield* compressed.get('/gzip')
			if (request.url === 'https://models.dev/api.json') {
				if (yield* Ref.get(pricingDown)) {
					return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 503}))
				}
				return HttpClientResponse.fromWeb(
					request,
					Response.json({anthropic: {models: {test: {cost: {input: 2, output: 4}}}}})
				)
			}
			yield* Queue.offer(calls, {
				body: Boolean.match(request.body._tag === 'Uint8Array', {
					onFalse: () => '',
					onTrue: () => (request.body._tag === 'Uint8Array' && new TextDecoder().decode(request.body.body)) || ''
				}),
				key: request.headers['x-api-key'] ?? '',
				url: request.url
			})
			if (String.includes('/stream')(request.url)) {
				return HttpClientResponse.fromWeb(
					request,
					new Response(SSE_BODY, {headers: {'content-type': 'text/event-stream', 'x-upstream': 'yes'}, status: 201})
				)
			}
			if (String.includes('/cost')(request.url)) {
				return HttpClientResponse.fromWeb(
					request,
					Response.json({usage: {cost: 0.123, input_tokens: 10, output_tokens: 5}})
				)
			}
			return HttpClientResponse.fromWeb(
				request,
				new Response(JSON_BODY, {headers: {'content-type': 'application/json', 'x-upstream': 'yes'}, status: 201})
			)
		})
	)
	const services = pipe(
		AiProxy.layer,
		Layer.provide(Auth.layer),
		Layer.provide(Sessions.layer),
		Layer.provide(
			Layer.mergeAll(
				NodeServices.layer,
				Layer.succeedContext(database),
				Layer.succeed(HttpClient.HttpClient, client),
				NodeCrypto.layer
			)
		)
	)
	const context = yield* Layer.build(services)
	const sql = Context.get(database, SqlClient.SqlClient)
	// Alice's usage after the services made its table, then again after each call of hers is saved.
	const saved = yield* Queue.unbounded<{costUsd: number; unknownCostCalls: number}>()
	yield* Effect.forkScoped(
		Stream.runForEach(
			sql.reactive(
				{aiUsage: ['alice']},
				Effect.flatMap(
					sql`SELECT total(costUsd) AS costUsd, total(unknownCostCalls) AS unknownCostCalls FROM ai_usage WHERE owner = 'alice'`,
					Schema.decodeUnknownEffect(
						Schema.Tuple([Schema.Struct({costUsd: Schema.Finite, unknownCostCalls: Schema.Finite})])
					)
				)
			),
			rows => Queue.offer(saved, rows[0])
		)
	)
	assert.deepStrictEqual(yield* Queue.take(saved), {costUsd: 0, unknownCostCalls: 0})
	const web = yield* Effect.acquireRelease(
		Effect.sync(() =>
			HttpRouter.toWebHandler(
				pipe(
					AiHttpHandlers,
					Layer.provide(services),
					Layer.provide(
						ConfigProvider.layer(
							ConfigProvider.fromUnknown({APP_URL: 'https://gateway.mp281x.xyz', AUTH_URL: 'https://auth.mp281x.xyz'})
						)
					)
				)
			)
		),
		handler => Effect.promise(() => handler.dispose())
	)
	return {
		ai: Context.get(context, AiProxy),
		calls,
		down,
		pricingDown,
		request: (path: string, options?: RequestInit) =>
			Effect.promise(() => web.handler(new Request(`https://gateway.mp281x.xyz${path}`, options))),
		saved,
		sign
	}
})

it.live('forwards JSON and SSE unchanged using the JWT owner key and meters its cost', () =>
	// oxlint-disable-next-line effecttsgo/strict-effect-provide -- This HTTP test entry point owns its configured service lifetime.
	Effect.provide(
		Effect.gen(function* () {
			const f = yield* fixture()
			yield* f.ai.setKey('alice', 'anthropic', Redacted.make('alice-secret'))
			yield* f.ai.setKey('bob', 'anthropic', Redacted.make('bob-secret'))
			const token = yield* f.sign()
			for (const call of [
				{costUsd: 0.00004, path: 'json'},
				{costUsd: 0.00008, path: 'stream'}
			]) {
				const response = yield* f.request(`/ai/anthropic/${call.path}?q=1`, {
					body: '{ "model": "test" }',
					headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json', cookie: 'bob'},
					method: 'POST'
				})
				assert.equal(response.status, 201)
				assert.equal(response.headers.get('x-upstream'), 'yes')
				assert.equal(
					yield* Effect.promise(() => response.text()),
					Boolean.match(call.path === 'json', {onFalse: () => SSE_BODY, onTrue: () => JSON_BODY})
				)
				assert.deepEqual(yield* Queue.take(f.calls), {
					body: '{ "model": "test" }',
					key: 'alice-secret',
					url: `https://api.anthropic.com/${call.path}?q=1`
				})
				const usage = yield* Queue.take(f.saved)
				assert.closeTo(usage.costUsd, call.costUsd, 1e-12)
				assert.strictEqual(usage.unknownCostCalls, 0)
			}
			assert.deepStrictEqual(
				Array.map(yield* f.ai.list('alice'), key => ({...key, lastStatus: Option.getOrUndefined(key.lastStatus)})),
				[{last4: 'cret', lastStatus: 201, provider: 'anthropic'}]
			)
			const response = yield* f.request('/ai/anthropic/cost', {
				body: '{"model":"test"}',
				headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
				method: 'POST'
			})
			yield* Effect.promise(() => response.text())
			// A price the provider reports is taken as it is.
			assert.closeTo((yield* Queue.take(f.saved)).costUsd, 0.12308, 1e-12)
			yield* f.ai.removeKey('alice', 'anthropic')
			const missing = yield* f.request('/ai/anthropic/json', {headers: {authorization: `Bearer ${token}`}})
			assert.equal(missing.status, 402)
			assert.include(yield* Effect.promise(() => missing.text()), 'Add your Anthropic key in Gateway')
		}),
		ConfigProvider.layer(
			ConfigProvider.fromUnknown({APP_URL: 'https://gateway.mp281x.xyz', AUTH_URL: 'https://auth.mp281x.xyz'})
		)
	)
)

it.live('retries a failed pricing refresh on the next call instead of pricing a day as unknown', () =>
	// oxlint-disable-next-line effecttsgo/strict-effect-provide -- This HTTP test entry point owns its configured service lifetime.
	Effect.provide(
		Effect.gen(function* () {
			const f = yield* fixture()
			yield* f.ai.setKey('alice', 'anthropic', Redacted.make('alice-secret'))
			const token = yield* f.sign()
			yield* Ref.set(f.pricingDown, true)
			const first = yield* f.request('/ai/anthropic/json', {
				body: '{"model":"test"}',
				headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
				method: 'POST'
			})
			assert.equal(first.status, 201)
			yield* Effect.promise(() => first.text())
			assert.deepStrictEqual(yield* Queue.take(f.saved), {costUsd: 0, unknownCostCalls: 1})
			yield* Ref.set(f.pricingDown, false)
			const second = yield* f.request('/ai/anthropic/json', {
				body: '{"model":"test"}',
				headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
				method: 'POST'
			})
			assert.equal(second.status, 201)
			yield* Effect.promise(() => second.text())
			const priced = yield* Queue.take(f.saved)
			assert.closeTo(priced.costUsd, 0.00004, 1e-12)
			assert.strictEqual(priced.unknownCostCalls, 1)
		}),
		ConfigProvider.layer(
			ConfigProvider.fromUnknown({APP_URL: 'https://gateway.mp281x.xyz', AUTH_URL: 'https://auth.mp281x.xyz'})
		)
	)
)

it.live('refuses missing, invalid and expired bearers and has no credential-creation endpoint', () =>
	// oxlint-disable-next-line effecttsgo/strict-effect-provide -- This HTTP test entry point owns its configured service lifetime.
	Effect.provide(
		Effect.gen(function* () {
			const f = yield* fixture()
			for (const authorization of [
				'',
				'Bearer invalid',
				'Bearer forged.token.signature',
				`Bearer ${yield* f.sign(-1)}`
			]) {
				const response = yield* f.request('/ai/anthropic/json', {
					headers: {authorization, cookie: '__Host-session=not-a-jwt'}
				})
				assert.equal(response.status, 401)
				assert.deepEqual(yield* Effect.promise(() => response.json()), {error: {message: 'Sign in first'}})
			}
			assert.equal((yield* f.request(Array.join(['', 'ai', 'grants'], '/'), {method: 'POST'})).status, 404)
		}),
		ConfigProvider.layer(
			ConfigProvider.fromUnknown({APP_URL: 'https://gateway.mp281x.xyz', AUTH_URL: 'https://auth.mp281x.xyz'})
		)
	)
)

it.live('answers 503 rather than a refusal while Auth cannot serve its key set', () =>
	// oxlint-disable-next-line effecttsgo/strict-effect-provide -- This HTTP test entry point owns its configured service lifetime.
	Effect.provide(
		Effect.gen(function* () {
			const f = yield* fixture()
			yield* Ref.set(f.down, true)
			const response = yield* f.request('/ai/anthropic/json', {headers: {authorization: `Bearer ${yield* f.sign()}`}})
			assert.equal(response.status, 503)
			assert.equal(response.headers.get('retry-after'), '5')
		}),
		ConfigProvider.layer(
			ConfigProvider.fromUnknown({APP_URL: 'https://gateway.mp281x.xyz', AUTH_URL: 'https://auth.mp281x.xyz'})
		)
	)
)

it.layer(NodeHttpServer.layerTest, {excludeTestServices: true})(test => {
	test.effect(
		'forwards decoded gzip JSON without stale encoding or hop-by-hop headers',
		Effect.fnUntraced(
			function* () {
				const bytes = gzipSync(JSON_BODY)
				yield* Layer.build(
					HttpRouter.serve(
						HttpRouter.add(
							'GET',
							'/gzip',
							HttpServerResponse.uint8Array(bytes, {
								headers: {
									connection: 'x-private',
									'content-encoding': 'gzip',
									'content-length': `${bytes.length}`,
									'content-type': 'application/json',
									'x-private': 'not-forwarded'
								}
							})
						)
					)
				)
				const f = yield* fixture(yield* HttpClient.HttpClient)
				yield* f.ai.setKey('alice', 'anthropic', Redacted.make('alice-secret'))
				const response = yield* f.request('/ai/anthropic/gzip', {
					headers: {'accept-encoding': 'gzip', authorization: `Bearer ${yield* f.sign()}`}
				})
				assert.deepEqual(yield* Effect.promise(() => response.json()), {
					model: 'test',
					usage: {input_tokens: 10, output_tokens: 5}
				})
				for (const name of ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'x-private']) {
					assert.isNull(response.headers.get(name))
				}
			},
			// oxlint-disable-next-line effecttsgo/strict-effect-provide -- This HTTP test entry point owns its configured service lifetime.
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromUnknown({APP_URL: 'https://gateway.mp281x.xyz', AUTH_URL: 'https://auth.mp281x.xyz'})
				)
			)
		)
	)
})
