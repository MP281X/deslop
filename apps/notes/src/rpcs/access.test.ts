import {assert, it} from '@effect/vitest'

import {Effect, Layer, Ref, pipe} from 'effect'

import {HttpRouter, HttpServerResponse} from 'effect/http'

import {Access} from '#rpcs/access.ts'

it.effect('rejects foreign origins and mismatched hosts before executing a private route', () =>
	Effect.gen(function* () {
		const calls = yield* Ref.make(0)
		const route = HttpRouter.add(
			'GET',
			'/api/private',
			Effect.gen(function* () {
				yield* Ref.update(calls, count => count + 1)
				return HttpServerResponse.text('private notes')
			})
		)
		const application = yield* Effect.acquireRelease(
			Effect.sync(() => HttpRouter.toWebHandler(pipe(route, Layer.provide(Access)))),
			server => Effect.promise(() => server.dispose())
		)
		for (const headers of [
			new Headers({host: '127.0.0.1:5017', origin: 'https://attacker.example'}),
			new Headers({host: 'attacker.example', origin: 'http://127.0.0.1:5017'}),
			new Headers({host: '127.0.0.1:5017'})
		]) {
			const response = yield* Effect.promise(() =>
				application.handler(new Request('http://127.0.0.1:5017/api/private', {headers}))
			)
			assert.strictEqual(response.status, 403)
		}
		assert.strictEqual(yield* Ref.get(calls), 0)
		const response = yield* Effect.promise(() =>
			application.handler(
				new Request('http://127.0.0.1:5017/api/private', {
					headers: {host: '127.0.0.1:5017', origin: 'http://127.0.0.1:5017'}
				})
			)
		)
		assert.strictEqual(response.status, 200)
		assert.strictEqual(yield* Effect.promise(() => response.text()), 'private notes')
		assert.strictEqual(yield* Ref.get(calls), 1)
	})
)
