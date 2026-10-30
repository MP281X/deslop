import {assert, it} from '@effect/vitest'

import {Context, Effect, Layer, MutableList, Result, Schema, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'

import {AuthError} from '@deslop/runtime/auth/schema'

import {layerPublicFetch} from '#services/network/service.ts'

it.effect(
	'blocks private and reserved literal addresses before making a fetch and forces redirects off',
	Effect.fnUntraced(function* () {
		const requests = MutableList.make<{init?: RequestInit}>()
		const services = yield* Layer.build(
			pipe(
				layerPublicFetch,
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
		const fetch = Context.get(yield* Layer.build(layerPublicFetch), FetchHttpClient.Fetch)
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
