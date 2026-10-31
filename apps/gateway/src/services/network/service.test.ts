import {NodeHttpClient} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Context, Effect, Layer, MutableList, Result, Schema, pipe} from 'effect'

import {FetchHttpClient, HttpClient} from 'effect/http'

import {AuthError} from '@deslop/runtime/auth/schema'

import {layerUpstream} from '#services/network/service.ts'

class Upstream extends Context.Service<Upstream, HttpClient.HttpClient>()(
	'@deslop/gateway/services/network/service.test/Upstream'
) {}
class Ordinary extends Context.Service<Ordinary, HttpClient.HttpClient>()(
	'@deslop/gateway/services/network/service.test/Ordinary'
) {}

it.effect(
	'keeps the upstream client guarded beside the ordinary one the gateway builds for Auth',
	Effect.fnUntraced(function* () {
		const requests = MutableList.make<{redirect: string; url: string}>()
		const client = Effect.service(HttpClient.HttpClient)
		const services = yield* Layer.build(
			pipe(
				Layer.mergeAll(
					pipe(Layer.effect(Ordinary)(client), Layer.provide(NodeHttpClient.layerFetch)),
					pipe(Layer.effect(Upstream)(client), Layer.provide(layerUpstream))
				),
				Layer.provide(
					Layer.succeed(FetchHttpClient.Fetch, (input, init) => {
						MutableList.append(requests, {redirect: init?.redirect ?? 'unset', url: new Request(input).url})
						// oxlint-disable-next-line no-restricted-properties -- The injected Fetch service must return a Promise<Response>.
						return Effect.runPromise(Effect.succeed(Response.json({ok: true})))
					})
				)
			)
		)
		const upstream = Context.get(services, Upstream)
		assert.isTrue(Result.isFailure(yield* Effect.result(upstream.get('https://127.1/token'))))
		assert.strictEqual(requests.length, 0)
		yield* upstream.post('https://example.com/token')
		yield* Context.get(services, Ordinary).get('http://auth:5000/auth/verify')
		const [toProvider, toAuth] = MutableList.toArray(requests)
		assert.deepStrictEqual(toProvider, {redirect: 'error', url: 'https://example.com/token'})
		assert.strictEqual(toAuth?.url, 'http://auth:5000/auth/verify')
		assert.notStrictEqual(toAuth?.redirect, 'error')
	})
)

it.effect(
	'blocks private and reserved literal addresses before making a fetch and forces redirects off',
	Effect.fnUntraced(function* () {
		const requests = MutableList.make<{init?: RequestInit}>()
		const services = yield* Layer.build(
			pipe(
				layerUpstream,
				Layer.provide(
					Layer.succeed(FetchHttpClient.Fetch, (_input, init) => {
						MutableList.append(requests, {init})
						// oxlint-disable-next-line no-restricted-properties -- The injected Fetch service must return a Promise<Response>.
						return Effect.runPromise(Effect.succeed(Response.json({ok: true})))
					})
				)
			)
		)
		const fetch = Context.get(services, FetchHttpClient.Fetch)
		for (const url of [
			'https://127.1',
			'https://[::1]',
			'https://[::ffff:127.0.0.1]',
			'https://100.68.201.107',
			'https://169.254.169.254',
			'https://192.168.1.1',
			'https://[fc00::1]',
			'https://198.51.100.1',
			'http://example.com'
		]) {
			assert.isTrue(Result.isFailure(yield* Effect.result(Effect.tryPromise(() => fetch(url)))))
		}
		assert.strictEqual(requests.length, 0)
		yield* Effect.tryPromise(() => fetch('https://example.com/mcp', {redirect: 'follow'}))
		assert.strictEqual(requests.length, 1)
		assert.strictEqual(MutableList.toArray(requests)[0]?.init?.redirect, 'error')
	})
)

it.effect(
	'rejects a hostname resolving to the worker network at the socket lookup',
	Effect.fnUntraced(function* () {
		const fetch = Context.get(yield* Layer.build(layerUpstream), FetchHttpClient.Fetch)
		const result = yield* Effect.result(
			Effect.tryPromise({
				catch: cause => AuthError.make({cause, message: 'Fetch failed'}),
				try: () => fetch('https://localhost/mcp')
			})
		)
		assert.isTrue(Result.isFailure(result))
		if (Result.isFailure(result)) assert.isTrue(Schema.is(Schema.Struct({cause: AuthError}))(result.failure.cause))
	})
)
