import {assert, it} from '@effect/vitest'

import {ConfigProvider, Effect, Layer, pipe} from 'effect'

import {HttpRouter, HttpServerResponse} from 'effect/http'

import {localGuard} from '#server.ts'

it.effect('guards localhost hosts/origins and preserves a same-app sign-in destination', () =>
	Effect.scoped(
		Effect.gen(function* () {
			const web = yield* Effect.acquireRelease(
				Effect.sync(() =>
					HttpRouter.toWebHandler(
						pipe(
							HttpRouter.add('POST', '/write', HttpServerResponse.empty()),
							Layer.provideMerge(
								ConfigProvider.layer(
									ConfigProvider.fromUnknown({
										APP_URL: 'https://scope.example.com',
										AUTH_URL: 'https://auth.example.com',
										OTEL_URL: ''
									})
								)
							)
						),
						{disableLogger: true, middleware: localGuard}
					)
				),
				value => Effect.promise(() => value.dispose())
			)
			function send(path: string, host: string, origin: string) {
				return Effect.tryPromise(() =>
					web.handler(new Request(`https://scope.example.com${path}`, {headers: {host, origin}, method: 'POST'}))
				)
			}
			assert.strictEqual((yield* send('/write', 'scope.example.com', 'https://scope.example.com')).status, 204)
			assert.strictEqual((yield* send('/write', 'scope.example.com', 'https://evil.example.com')).status, 403)
			assert.strictEqual((yield* send('/write', 'evil.example.com', 'https://evil.example.com')).status, 403)
			const accepted = yield* Effect.tryPromise(() =>
				web.handler(
					new Request('https://scope.example.com/auth/sign-in?next=https%3A%2F%2Fscope.example.com%2Fdetail', {
						headers: {host: 'scope.example.com'}
					})
				)
			)
			assert.strictEqual(
				accepted.headers.get('location'),
				'https://auth.example.com/?next=https%3A%2F%2Fscope.example.com%2Fdetail'
			)
			const rejected = yield* Effect.tryPromise(() =>
				web.handler(
					new Request('https://scope.example.com/auth/sign-in?next=https%3A%2F%2Fevil.example.com', {
						headers: {host: 'scope.example.com'}
					})
				)
			)
			assert.strictEqual(rejected.status, 400)
		})
	)
)
