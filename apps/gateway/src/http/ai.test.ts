import {gzipSync} from 'node:zlib'

import {NodeCrypto, NodeHttpServer} from '@effect/platform-node'
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
	Predicate,
	Queue,
	Redacted,
	Ref,
	Schema,
	String,
	pipe
} from 'effect'

import {Signature} from 'effect/crypto'
import {HttpClient, HttpClientResponse, HttpRouter, HttpServerResponse} from 'effect/http'
import {Jwk, Jwt} from 'effect/jose'
import {KeyValueStore} from 'effect/persistence'

import {AccessClaims} from '@deslop/runtime/auth/schema'
import {Auth} from '@deslop/runtime/auth/service'
import {Sessions} from '@deslop/runtime/auth/sessions'

import {AiHttpHandlers} from '#http/handlers.ts'
import {AiUsageEntry} from '#services/ai/schema.ts'
import {AiProxy} from '#services/ai/service.ts'

const APP = 'Stash'
const JSON_BODY = '{ "model": "test", "usage": {"input_tokens": 10, "output_tokens": 5} }'
const SSE_BODY =
	'event: message_start\ndata: {"message":{"model":"test","usage":{"input_tokens":10}}}\n\nevent: message_delta\ndata: {"usage":{"output_tokens":5}}\n\n'

const fixture = Effect.fnUntraced(function* (compressed?: HttpClient.HttpClient) {
	const signature = Context.get(yield* Layer.build(NodeCrypto.layer), Signature.Signature)
	const pair = yield* pipe(
		Jwk.generateKeyPair({algorithm: 'EdDSA', kid: 'test'}),
		Effect.provideService(Signature.Signature, signature)
	)
	const signingKey = yield* pipe(
		Jwk.importPrivate(pair.privateKey, 'EdDSA'),
		Effect.provideService(Signature.Signature, signature)
	)
	const down = yield* Ref.make(false)
	const sign = Effect.fnUntraced(function* (expires: number = 600) {
		const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
		return Redacted.value(
			yield* pipe(
				Jwt.sign(
					AccessClaims,
					{
						aud: 'deslop',
						azp: APP,
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
				Effect.provideService(Signature.Signature, signature)
			)
		)
	})
	const saved = yield* Queue.unbounded<AiUsageEntry>()
	const calls = yield* Queue.unbounded<{key: string; url: string; body: string}>()
	const base = Context.get(yield* Layer.build(KeyValueStore.layerMemory), KeyValueStore.KeyValueStore)
	const store = KeyValueStore.make({
		...base,
		set: Effect.fnUntraced(function* (key, value) {
			return yield* pipe(
				base.set(key, value),
				Effect.tap(() => {
					if (String.startsWith('ai-usage/')(key) && Predicate.isString(value)) {
						return Queue.offer(
							saved,
							Option.getOrThrow(Array.last(Schema.decodeSync(Schema.fromJsonString(Schema.Array(AiUsageEntry)))(value)))
						)
					}
					return Effect.void
				})
			)
		})
	})
	const client = HttpClient.make(request =>
		Effect.gen(function* () {
			if (request.url === 'https://auth.mp281x.xyz/.well-known/jwks.json') {
				if (yield* Ref.get(down)) return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 503}))
				return HttpClientResponse.fromWeb(request, Response.json({keys: [pair.publicKey]}))
			}
			if (compressed !== undefined && String.includes('/gzip')(request.url)) return yield* compressed.get('/gzip')
			if (request.url === 'https://models.dev/api.json') {
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
				Layer.succeed(KeyValueStore.KeyValueStore, store),
				Layer.succeed(HttpClient.HttpClient, client),
				NodeCrypto.layer
			)
		)
	)
	const context = yield* Layer.build(services)
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
		request: (path: string, options?: RequestInit) =>
			Effect.promise(() => web.handler(new Request(`https://gateway.mp281x.xyz${path}`, options))),
		saved,
		sign
	}
})

it.live('forwards JSON and SSE unchanged using the JWT owner key and meters its client label', () =>
	pipe(
		Effect.gen(function* () {
			const f = yield* fixture()
			yield* f.ai.setKey('alice', 'anthropic', Redacted.make('alice-secret'))
			yield* f.ai.setKey('bob', 'anthropic', Redacted.make('bob-secret'))
			const token = yield* f.sign()
			for (const path of ['json', 'stream']) {
				const response = yield* f.request(`/ai/anthropic/${path}?q=1`, {
					body: '{ "model": "test" }',
					headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json', cookie: 'bob'},
					method: 'POST'
				})
				assert.equal(response.status, 201)
				assert.equal(response.headers.get('x-upstream'), 'yes')
				assert.equal(
					yield* Effect.promise(() => response.text()),
					Boolean.match(path === 'json', {onFalse: () => SSE_BODY, onTrue: () => JSON_BODY})
				)
				assert.deepEqual(yield* Queue.take(f.calls), {
					body: '{ "model": "test" }',
					key: 'alice-secret',
					url: `https://api.anthropic.com/${path}?q=1`
				})
				const entry = yield* Queue.take(f.saved)
				assert.equal(entry.costSource, 'models.dev')
				assert.equal(entry.costUsd, 0.00004)
				assert.equal(entry.app, APP)
			}
			const keys = yield* f.ai.keys('alice')
			assert.deepEqual(keys, [{addedAt: keys[0]?.addedAt ?? 0, last4: 'cret', lastStatus: 201, provider: 'anthropic'}])
			assert.equal(keys[0]?.lastStatus, 201)
			const response = yield* f.request('/ai/anthropic/cost', {
				body: '{"model":"test"}',
				headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
				method: 'POST'
			})
			yield* Effect.promise(() => response.text())
			const cost = yield* Queue.take(f.saved)
			assert.equal(cost.costSource, 'provider')
			assert.equal(cost.costUsd, 0.123)
			yield* f.ai.removeKey('alice', 'anthropic')
			const missing = yield* f.request('/ai/anthropic/json', {headers: {authorization: `Bearer ${token}`}})
			assert.equal(missing.status, 402)
			assert.include(yield* Effect.promise(() => missing.text()), 'Add your Anthropic key in Gateway')
		}),
		// oxlint-disable-next-line effecttsgo/strict-effect-provide -- This HTTP test entry point owns its configured service lifetime.
		Effect.provide(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({APP_URL: 'https://gateway.mp281x.xyz', AUTH_URL: 'https://auth.mp281x.xyz'})
			)
		)
	)
)

it.live('refuses missing, invalid and expired bearers and has no credential-creation endpoint', () =>
	pipe(
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
		// oxlint-disable-next-line effecttsgo/strict-effect-provide -- This HTTP entry point owns the configured service lifetime.
		Effect.provide(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({APP_URL: 'https://gateway.mp281x.xyz', AUTH_URL: 'https://auth.mp281x.xyz'})
			)
		)
	)
)

it.live('answers 503 rather than a refusal while Auth cannot serve its key set', () =>
	pipe(
		Effect.gen(function* () {
			const f = yield* fixture()
			yield* Ref.set(f.down, true)
			const response = yield* f.request('/ai/anthropic/json', {headers: {authorization: `Bearer ${yield* f.sign()}`}})
			assert.equal(response.status, 503)
			assert.equal(response.headers.get('retry-after'), '5')
		}),
		// oxlint-disable-next-line effecttsgo/strict-effect-provide -- This HTTP entry point owns the configured service lifetime.
		Effect.provide(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({APP_URL: 'https://gateway.mp281x.xyz', AUTH_URL: 'https://auth.mp281x.xyz'})
			)
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
			// oxlint-disable-next-line effecttsgo/strict-effect-provide -- This gzip HTTP test entry point owns its configured service lifetime.
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromUnknown({APP_URL: 'https://gateway.mp281x.xyz', AUTH_URL: 'https://auth.mp281x.xyz'})
				)
			)
		)
	)
})
