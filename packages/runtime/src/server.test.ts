import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import type {Path} from 'effect'
import {
	Boolean,
	ConfigProvider,
	Context,
	Deferred,
	Effect,
	Fiber,
	FileSystem,
	Layer,
	Queue,
	Ref,
	String,
	pipe
} from 'effect'

import {HttpClient, HttpClientResponse, HttpRouter, HttpServerResponse} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'
import {TestClock} from 'effect/testing'

import {guard, layerAnnounce, layerKeyValueStore, layerRoutes} from '#server.ts'

import {DEVELOPER} from '#auth/lib/utils.ts'
import {AuthError} from '#auth/schema.ts'
import {Auth} from '#auth/service.ts'

const handler = Effect.fnUntraced(function* (
	settings: Record<string, string>,
	auth: typeof Auth.Service = Auth.of({access: () => Effect.succeed(DEVELOPER), user: () => Effect.succeed(DEVELOPER)})
) {
	return yield* Effect.acquireRelease(
		Effect.sync(() =>
			HttpRouter.toWebHandler(
				pipe(
					Layer.mergeAll(
						HttpRouter.add('POST', '/write', HttpServerResponse.empty()),
						HttpRouter.add('POST', '/v1/traces', HttpServerResponse.empty()),
						layerRoutes
					),
					Layer.provide(Layer.succeedContext(Auth.makeContext(auth))),
					Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromUnknown(settings)))
				),
				{disableLogger: true, middleware: guard}
			)
		),
		web => Effect.promise(() => web.dispose())
	)
})

const send = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof handler>>,
	url: string,
	headers: Record<string, string>
) {
	const method = Boolean.match(String.includes('/auth/')(url), {onFalse: () => 'POST', onTrue: () => 'GET'})
	const context = yield* Effect.context<FileSystem.FileSystem | Path.Path>()
	return yield* Effect.promise(() => web.handler(new Request(url, {headers, method}), context))
})

it.layer(NodeServices.layer)(test => {
	test.effect(
		'cancels a queued storage write without interrupting an atomic write already underway',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			const entered = yield* Deferred.make<void>()
			const release = yield* Deferred.make<void>()
			const waiting = yield* Deferred.make<void>()
			const cancelled = yield* Deferred.make<void>()
			const store = Context.get(
				yield* Layer.build(
					pipe(
						layerKeyValueStore(directory),
						Layer.provide(
							Layer.succeed(
								FileSystem.FileSystem,
								FileSystem.FileSystem.of({
									...fs,
									writeFileString: Effect.fnUntraced(function* (path, value, options) {
										if (String.endsWith('/first.tmp')(path)) {
											yield* Deferred.succeed(entered, undefined)
											yield* Deferred.await(release)
										}
										yield* fs.writeFileString(path, value, options)
									})
								})
							)
						)
					)
				),
				KeyValueStore.KeyValueStore
			)
			yield* Effect.ensuring(
				Effect.gen(function* () {
					const first = yield* Effect.forkScoped(store.set('first', 'committed'))
					yield* Deferred.await(entered)
					const second = yield* Effect.forkScoped(
						pipe(
							Deferred.succeed(waiting, undefined),
							Effect.andThen(store.set('second', 'cancelled')),
							Effect.onInterrupt(() => Deferred.succeed(cancelled, undefined))
						)
					)
					yield* Deferred.await(waiting)
					const stopping = yield* Effect.forkChild(Fiber.interrupt(second))
					yield* TestClock.adjust(1)
					assert.isTrue(yield* Deferred.isDone(cancelled))
					yield* Fiber.join(stopping)
					const stopFirst = yield* Effect.forkChild(Fiber.interrupt(first))
					yield* Deferred.succeed(release, undefined)
					yield* Fiber.join(stopFirst)
					assert.strictEqual(yield* store.get('first'), 'committed')
					assert.isUndefined(yield* store.get('second'))
				}),
				Deferred.succeed(release, undefined)
			)
		})
	)
})

it.effect('does not keep announcing an app Auth permanently rejects', () =>
	Effect.scoped(
		Effect.gen(function* () {
			const attempts = yield* Ref.make(0)
			const requests = yield* Queue.unbounded<void>()
			const client = HttpClient.make(request =>
				Effect.gen(function* () {
					yield* Ref.update(attempts, count => count + 1)
					yield* Queue.offer(requests, undefined)
					return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 403}))
				})
			)
			yield* Layer.build(
				pipe(
					layerAnnounce,
					Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
					Layer.provide(
						ConfigProvider.layer(
							ConfigProvider.fromUnknown({
								APP_URL: 'https://desktop.example.ts.net:5102',
								AUTH_URL: 'https://auth.example.com'
							})
						)
					)
				)
			)
			yield* TestClock.adjust('2 seconds')
			yield* Queue.take(requests)
			yield* TestClock.adjust('5 minutes')
			assert.strictEqual(yield* Ref.get(attempts), 1)
		})
	)
)

it.effect('bounds a stalled announcement and respects Auth retry-after before recovering', () =>
	Effect.scoped(
		Effect.gen(function* () {
			const attempts = yield* Ref.make(0)
			const interrupted = yield* Ref.make(false)
			const requests = yield* Queue.unbounded<void>()
			const client = HttpClient.make(request =>
				Effect.gen(function* () {
					const attempt = yield* Ref.getAndUpdate(attempts, count => count + 1)
					yield* Queue.offer(requests, undefined)
					if (attempt === 0) return yield* Effect.ensuring(Effect.never, Ref.set(interrupted, true))
					return HttpClientResponse.fromWeb(
						request,
						new Response(undefined, {
							headers: {'retry-after': '120'},
							status: Boolean.match(attempt === 1, {onFalse: () => 200, onTrue: () => 503})
						})
					)
				})
			)
			yield* Layer.build(
				pipe(
					layerAnnounce,
					Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
					Layer.provide(
						ConfigProvider.layer(
							ConfigProvider.fromUnknown({APP_URL: 'https://scope.example.com', AUTH_URL: 'https://auth.example.com'})
						)
					)
				)
			)
			yield* TestClock.adjust('2 seconds')
			yield* Queue.take(requests)
			yield* TestClock.adjust('10 seconds')
			assert.isTrue(yield* Ref.get(interrupted))
			yield* TestClock.adjust('1 minute')
			yield* Queue.take(requests)
			yield* TestClock.adjust('119 seconds')
			assert.strictEqual(yield* Ref.get(attempts), 2)
			yield* TestClock.adjust('1 second')
			yield* Queue.take(requests)
			yield* TestClock.adjust('5 minutes')
			assert.strictEqual(yield* Ref.get(attempts), 3)
		})
	)
)

it.layer(NodeServices.layer)('Server guard', test => {
	test.effect('keeps an authorization outage distinct from signing out', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const outage = Effect.fail(AuthError.make({error: 'temporarily_unavailable', message: 'Retry later'}))
				const web = yield* handler(
					{APP_URL: 'http://localhost:5000'},
					Auth.of({access: () => outage, user: () => outage})
				)
				const response = yield* send(web, 'http://localhost:5000/auth/user', {host: 'localhost:5000'})
				assert.strictEqual(response.status, 503)
				assert.strictEqual(response.headers.get('retry-after'), '5')
			})
		)
	)

	test.effect('reads immutable release metadata once for runtime discovery requests', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem
				const reads = yield* Ref.make(0)
				const context = Context.add(yield* Effect.context<FileSystem.FileSystem | Path.Path>(), FileSystem.FileSystem, {
					...fs,
					readFileString: () =>
						Effect.andThen(
							Ref.update(reads, count => count + 1),
							Effect.succeed('{"config":{"port":5000},"name":"@deslop/fixture","version":"0.1.12"}')
						)
				})
				const web = yield* handler({APP_URL: 'http://localhost:5000'})
				for (const path of ['/api/runtime', '/api/runtime']) {
					const response = yield* Effect.promise(() =>
						web.handler(new Request(`http://localhost:5000${path}`, {headers: {host: 'localhost:5000'}}), context)
					)
					assert.deepStrictEqual(yield* Effect.promise(() => response.json()), {
						name: 'fixture',
						traces: '',
						version: '0.1.12'
					})
				}
				assert.strictEqual(yield* Ref.get(reads), 1)
			})
		)
	)

	test.effect('without an issuer, serves only loopback, IP and canonical hosts, and never redirects to sign-in', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const web = yield* handler({APP_URL: 'https://dev.example.ts.net:25270'})
				for (const host of [
					'localhost:5000',
					'127.0.0.1:5000',
					'[::1]:5000',
					'100.68.201.107',
					'dev.example.ts.net:25270'
				]) {
					assert.strictEqual((yield* send(web, `http://${host}/write`, {host})).status, 204, host)
				}
				assert.strictEqual(
					(yield* send(web, 'http://rebound.example.com/write', {host: 'rebound.example.com'})).status,
					403
				)
				const signIn = yield* send(web, 'https://dev.example.ts.net:25270/auth/sign-in', {
					host: 'dev.example.ts.net:25270'
				})
				assert.strictEqual(signIn.status, 503)
				assert.isNull(signIn.headers.get('location'))
			})
		)
	)

	test.effect('with an issuer, serves any host but only its own origin, and returns from Auth to this app only', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const web = yield* handler({APP_URL: 'https://scope.example.com', AUTH_URL: 'https://auth.example.com'})
				const host = 'scope.example.com'
				assert.strictEqual(
					(yield* send(web, 'https://other.example.ts.net/write', {host: 'other.example.ts.net'})).status,
					204
				)
				assert.strictEqual((yield* send(web, `https://${host}/write`, {host, origin: `https://${host}`})).status, 204)
				assert.strictEqual(
					(yield* send(web, `https://${host}/write`, {host, origin: 'https://evil.example.com'})).status,
					403
				)
				assert.strictEqual(
					(yield* send(web, `https://${host}/write`, {
						host,
						origin: 'https://evil.example.com',
						'sec-fetch-site': 'same-origin'
					})).status,
					204
				)
				assert.strictEqual(
					(yield* send(web, `https://${host}/v1/traces`, {host, origin: 'https://evil.example.com'})).status,
					204
				)
				const accepted = yield* send(
					web,
					`https://${host}/auth/sign-in?next=https%3A%2F%2Fscope.example.com%2Fdetail`,
					{host}
				)
				assert.strictEqual(
					accepted.headers.get('location'),
					'https://auth.example.com/?next=https%3A%2F%2Fscope.example.com%2Fdetail'
				)
				assert.strictEqual(
					(yield* send(web, `https://${host}/auth/sign-out`, {host})).headers.get('location'),
					'https://auth.example.com/?sign-out=&next=https%3A%2F%2Fscope.example.com%2F'
				)
				assert.strictEqual(
					(yield* send(web, `https://${host}/auth/sign-in?next=https%3A%2F%2Fevil.example.com`, {host})).status,
					400
				)
			})
		)
	)
})
