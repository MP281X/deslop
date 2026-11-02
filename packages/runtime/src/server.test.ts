import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import type {FileSystem, Path} from 'effect'
import {Boolean, ConfigProvider, Effect, Layer, String, pipe} from 'effect'

import {HttpRouter, HttpServerResponse} from 'effect/http'

import {guard, layerRoutes} from '#server.ts'

import {DEVELOPER} from '#auth/lib/utils.ts'
import {Auth} from '#auth/service.ts'

const handler = Effect.fnUntraced(function* (settings: Record<string, string>) {
	return yield* Effect.acquireRelease(
		Effect.sync(() =>
			HttpRouter.toWebHandler(
				pipe(
					Layer.mergeAll(
						HttpRouter.add('POST', '/write', HttpServerResponse.empty()),
						HttpRouter.add('POST', '/v1/traces', HttpServerResponse.empty()),
						layerRoutes
					),
					Layer.provide(
						Layer.succeedContext(
							Auth.makeContext(
								Auth.of({access: () => Effect.succeed(DEVELOPER), user: () => Effect.succeed(DEVELOPER)})
							)
						)
					),
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
	return yield* Effect.tryPromise(() => web.handler(new Request(url, {headers, method}), context))
})

it.layer(NodeServices.layer)('Server guard', test => {
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
