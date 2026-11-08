import {assert, it} from '@effect/vitest'

import type {Schema} from 'effect'
import {Boolean, ConfigProvider, Context, Effect, Exit, Fiber, Layer, Ref, String, pipe} from 'effect'

import {Headers, HttpClient, HttpClientResponse, HttpRouter, HttpServerResponse} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'
import {Rpc, RpcMessage} from 'effect/rpc'
import {TestClock} from 'effect/testing'

import {Auth, HttpAuth, layerMcpAuth} from './service.ts'

import {AiGateway} from '#ai/service.ts'
import {CurrentUser, DEVELOPER, RpcAuth} from '#auth/lib/utils.ts'
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
						Layer.provide(Auth.layer),
						Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
						Layer.provide(
							ConfigProvider.layer(
								ConfigProvider.fromUnknown({APP_URL: 'https://scope.mp281x.xyz', AUTH_URL: 'https://auth.mp281x.xyz'})
							)
						)
					),
					{disableLogger: true}
				)
			),
			value => Effect.promise(() => value.dispose())
		)
		const discovery = yield* Effect.promise(() => web.handler(new Request('https://scope.mp281x.xyz/mcp')))
		assert.strictEqual(discovery.status, 401)
		assert.include(discovery.headers.get('www-authenticate') ?? '', 'resource_metadata=')
		assert.notInclude(discovery.headers.get('www-authenticate') ?? '', 'invalid_token')
		assert.strictEqual(yield* Ref.get(calls), 0)

		const request = Effect.fnUntraced(function* (path: string) {
			return yield* Effect.promise(() =>
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

it.effect(
	'signs every request in as the developer without an issuer, never reaching one',
	Effect.fnUntraced(function* () {
		const calls = yield* Ref.make(0)
		const client = HttpClient.make(request =>
			Effect.as(
				Ref.update(calls, count => count + 1),
				HttpClientResponse.fromWeb(request, new Response(undefined, {status: 401}))
			)
		)
		const web = yield* Effect.acquireRelease(
			Effect.sync(() =>
				HttpRouter.toWebHandler(
					pipe(
						Layer.merge(
							pipe(
								HttpRouter.add(
									'GET',
									'/me',
									Effect.map(CurrentUser, user => HttpServerResponse.text(user.name))
								),
								Layer.provide(HttpAuth.layer)
							),
							pipe(
								HttpRouter.add(
									'GET',
									'/mcp',
									Effect.map(CurrentUser, user => HttpServerResponse.text(user.name))
								),
								Layer.provide(layerMcpAuth('https://scope.mp281x.xyz/mcp'))
							)
						),
						Layer.provide(Auth.layer),
						Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
						Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({})))
					),
					{disableLogger: true}
				)
			),
			value => Effect.promise(() => value.dispose())
		)
		for (const path of ['/me', '/mcp']) {
			const response = yield* Effect.promise(() =>
				web.handler(new Request(`https://desktop.tailnet-8c4c.ts.net:23475${path}`))
			)
			assert.strictEqual(response.status, 200)
			assert.strictEqual(yield* Effect.promise(() => response.text()), DEVELOPER.name)
		}
		assert.strictEqual(yield* Ref.get(calls), 0)
	})
)

it.effect(
	'enrolls each signed-in person with Gateway from page, MCP and RPC requests',
	Effect.fnUntraced(function* () {
		const minted = yield* Ref.make<string[]>([])
		const client = HttpClient.make(request =>
			Effect.gen(function* () {
				if (String.endsWith('/ai/grants')(request.url)) {
					yield* Ref.update(minted, list => [
						...list,
						request.headers['authorization'] ?? request.headers['cookie'] ?? ''
					])
					return HttpClientResponse.fromWeb(request, Response.json({token: 'grant'}))
				}
				const id = Boolean.match(String.includes('/verify')(request.url), {
					onFalse: () => `github:${request.headers['cookie']}`,
					onTrue: () => 'github:mcp'
				})
				return HttpClientResponse.fromWeb(request, Response.json({id, name: id}))
			})
		)
		// Wired as the runtime's server wires an app: Auth beneath the routes, Gateway merged around both.
		function services<A, E, R>(routes: Layer.Layer<A, E, R>) {
			return pipe(
				routes,
				Layer.provideMerge(Auth.layer),
				Layer.provideMerge(pipe(AiGateway.layer, Layer.provide(KeyValueStore.layerMemory))),
				Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
				Layer.provide(
					ConfigProvider.layer(
						ConfigProvider.fromUnknown({
							APP_URL: 'https://stash.mp281x.xyz',
							AUTH_URL: 'https://auth.mp281x.xyz',
							GATEWAY_URL: 'https://gateway.mp281x.xyz'
						})
					)
				)
			)
		}
		const web = yield* Effect.acquireRelease(
			Effect.sync(() =>
				HttpRouter.toWebHandler(
					services(
						Layer.merge(
							pipe(
								HttpRouter.add('GET', '/me', HttpServerResponse.empty({status: 200})),
								Layer.provide(HttpAuth.layer)
							),
							pipe(
								HttpRouter.add('GET', '/mcp', HttpServerResponse.empty({status: 200})),
								Layer.provide(layerMcpAuth('https://stash.mp281x.xyz/mcp'))
							)
						)
					),
					{disableLogger: true}
				)
			),
			value => Effect.promise(() => value.dispose())
		)
		yield* Effect.promise(() => web.handler(new Request('https://stash.mp281x.xyz/me', {headers: {cookie: 'page'}})))
		yield* Effect.promise(() =>
			web.handler(new Request('https://stash.mp281x.xyz/mcp', {headers: {authorization: 'Bearer mcp'}}))
		)
		// The handler's own outcome is irrelevant; it only has to end so the RPC does too.
		yield* Effect.exit(
			Context.get(yield* Layer.build(services(Layer.empty)), RpcAuth)(Effect.die('handled'), {
				client: new Rpc.ServerClient(0),
				headers: Headers.fromInput({cookie: 'app'}),
				payload: undefined,
				requestId: RpcMessage.RequestId(0),
				rpc: Rpc.make('save')
			})
		)
		assert.deepStrictEqual(yield* Ref.get(minted), ['page', 'Bearer mcp', 'app'])
	})
)
