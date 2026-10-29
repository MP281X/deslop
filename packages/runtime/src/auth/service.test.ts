import {assert, it} from '@effect/vitest'

import type {Schema} from 'effect'
import {Boolean, Context, Effect, Exit, Fiber, Layer, Ref, pipe} from 'effect'

import {Headers, HttpClient, HttpClientResponse, HttpRouter, HttpServerResponse} from 'effect/http'
import {Rpc, RpcMessage} from 'effect/rpc'
import {TestClock} from 'effect/testing'

import {Auth, HttpAuth, layerMcpAuth} from './service.ts'

import {RpcAuth} from '#auth/lib/utils.ts'
import {AuthError} from '#auth/schema.ts'

it.effect('ends a running RPC once its credentials are rejected, not while the issuer is down', () =>
	Effect.scoped(
		Effect.gen(function* () {
			const verdict = yield* Ref.make<AuthError['error'] | 'valid'>('valid')
			const user = Effect.flatMap(Ref.get(verdict), current => {
				if (current === 'valid') return Effect.succeed({id: 'github:42', name: 'octocat'})
				return Effect.fail(AuthError.make({error: current, message: 'rejected'}))
			})
			const watch = yield* Effect.forkScoped(
				Context.get(Auth.makeContext(Auth.of({access: () => user, user: () => user})), RpcAuth)(Effect.never, {
					client: new Rpc.ServerClient(0),
					headers: Headers.empty,
					payload: undefined,
					requestId: RpcMessage.RequestId(0),
					rpc: Rpc.make('watch')
				})
			)
			yield* TestClock.adjust('5 minutes')
			yield* Ref.set(verdict, 'temporarily_unavailable')
			yield* TestClock.adjust('5 minutes')
			assert.isUndefined(watch.pollUnsafe())
			yield* Ref.set(verdict, 'invalid_grant')
			yield* TestClock.adjust('5 minutes')
			assert.isTrue(Exit.hasFails(yield* Fiber.await(watch)))
		})
	)
)

it.effect(
	'distinguishes OAuth discovery, rejected credentials and an unavailable issuer',
	Effect.fnUntraced(function* () {
		const upstream = yield* Ref.make<{status: number; body: Schema.JsonObject}>({body: {}, status: 401})
		const calls = yield* Ref.make(0)
		const client = HttpClient.make(request =>
			Effect.gen(function* () {
				yield* Ref.update(calls, count => count + 1)
				const response = yield* Ref.get(upstream)
				return HttpClientResponse.fromWeb(request, Response.json(response.body, {status: response.status}))
			})
		)
		const web = yield* Effect.acquireRelease(
			Effect.sync(() =>
				HttpRouter.toWebHandler(
					pipe(
						Layer.merge(
							pipe(
								HttpRouter.add('POST', '/ingest', HttpServerResponse.empty({status: 200})),
								Layer.provide(HttpAuth.layer)
							),
							pipe(
								HttpRouter.add('GET', '/mcp', HttpServerResponse.empty({status: 200})),
								Layer.provide(layerMcpAuth('https://scope.mp281x.xyz/mcp'))
							)
						),
						Layer.provide(Auth.layer('https://otel.mp281x.xyz')),
						Layer.provide(Layer.succeed(HttpClient.HttpClient, client))
					),
					{disableLogger: true}
				)
			),
			value => Effect.promise(() => value.dispose())
		)
		const discovery = yield* Effect.tryPromise(() => web.handler(new Request('https://scope.mp281x.xyz/mcp')))
		assert.strictEqual(discovery.status, 401)
		assert.include(discovery.headers.get('www-authenticate') ?? '', 'resource_metadata=')
		assert.notInclude(discovery.headers.get('www-authenticate') ?? '', 'invalid_token')
		assert.strictEqual(yield* Ref.get(calls), 0)

		const request = Effect.fnUntraced(function* (path: string) {
			return yield* Effect.tryPromise(() =>
				web.handler(
					new Request(`https://scope.mp281x.xyz${path}`, {
						headers: {authorization: 'Bearer rejected-or-valid-probe'},
						method: Boolean.match(path === '/mcp', {onFalse: () => 'POST', onTrue: () => 'GET'})
					})
				)
			)
		})
		const rejected = yield* request('/mcp')
		assert.strictEqual(rejected.status, 401)
		assert.include(rejected.headers.get('www-authenticate') ?? '', 'error="invalid_token"')
		assert.strictEqual((yield* request('/ingest')).status, 401)

		yield* Ref.set(upstream, {body: {}, status: 503})
		const unavailable = yield* request('/mcp')
		assert.strictEqual(unavailable.status, 503)
		assert.strictEqual(unavailable.headers.get('retry-after'), '5')
		assert.isFalse(unavailable.headers.has('www-authenticate'))
		assert.strictEqual((yield* request('/ingest')).status, 503)

		// A malformed successful verification is an issuer fault, not evidence that the token is invalid.
		yield* Ref.set(upstream, {body: {}, status: 200})
		assert.strictEqual((yield* request('/mcp')).status, 503)
		yield* Ref.set(upstream, {body: {id: '42', name: 'authorized'}, status: 200})
		assert.strictEqual((yield* request('/mcp')).status, 200)
		assert.strictEqual((yield* request('/ingest')).status, 200)
	})
)
