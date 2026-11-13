import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {Array, ConfigProvider, Context, Effect, Fiber, Layer, Stream} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import {Reactivity} from 'effect/reactivity'

import {AppOrigin} from '#services/apps/schema.ts'
import {Apps} from '#services/apps/service.ts'

const SERVERS: Record<string, {auth: string; name: string; status?: number}> = {
	'https://broken.mp281x.xyz': {auth: 'not a URL', name: 'broken'},
	'https://elsewhere.mp281x.xyz': {auth: 'https://auth.example.com', name: 'elsewhere'},
	'https://restarting.mp281x.xyz': {auth: 'https://auth.mp281x.xyz', name: 'restarting', status: 503},
	'https://scope.mp281x.xyz': {auth: 'https://auth.mp281x.xyz', name: 'scope'},
	'https://stash.mp281x.xyz': {auth: 'https://auth.mp281x.xyz', name: 'stash'},
	'https://stranger.example.com': {auth: 'https://auth.mp281x.xyz', name: 'stranger'}
}

const servers = HttpClient.make(request =>
	Effect.sync(() => {
		const url = new URL(request.url)
		const server = SERVERS[url.origin]
		if (server === undefined) return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 404}))
		if (url.pathname === '/api/runtime') {
			return HttpClientResponse.fromWeb(
				request,
				Response.json(
					{auth: server.auth, name: server.name, traces: '', version: '0.1.1'},
					{status: server.status ?? 200}
				)
			)
		}
		return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 404}))
	})
)

const layer = Layer.provide(
	Apps.layer,
	Layer.mergeAll(
		SqliteClient.layer({filename: ':memory:'}),
		Reactivity.layer,
		Layer.succeed(HttpClient.HttpClient, servers),
		ConfigProvider.layer(ConfigProvider.fromUnknown({APP_URL: 'https://auth.mp281x.xyz'}))
	)
)

it.effect(
	'keeps a restarting app announcement retryable',
	Effect.fnUntraced(function* () {
		const apps = Context.get(yield* Layer.build(layer), Apps)
		assert.strictEqual(
			(yield* Effect.flip(apps.register(AppOrigin.make('https://restarting.mp281x.xyz')))).error,
			'temporarily_unavailable'
		)
	})
)

it.effect(
	'lists an app whose server names this Auth',
	Effect.fnUntraced(function* () {
		const apps = Context.get(yield* Layer.build(layer), Apps)
		const watching = yield* Effect.forkScoped(Stream.runCollect(Stream.take(apps.watch, 4)))
		yield* Effect.yieldNow
		yield* apps.register(AppOrigin.make('https://stash.mp281x.xyz'))
		yield* apps.register(AppOrigin.make('https://scope.mp281x.xyz'))
		// Announcing again, as each restart does, keeps one row.
		yield* apps.register(AppOrigin.make('https://scope.mp281x.xyz'))
		assert.deepStrictEqual(
			Array.map(yield* Fiber.join(watching), catalog => Array.map(catalog, app => app.origin)),
			[
				[],
				['https://stash.mp281x.xyz'],
				['https://scope.mp281x.xyz', 'https://stash.mp281x.xyz'],
				['https://scope.mp281x.xyz', 'https://stash.mp281x.xyz']
			]
		)
	})
)

it.effect(
	'refuses an app that signs in elsewhere, one off the parent domain, one with a malformed issuer and one that does not answer',
	Effect.fnUntraced(function* () {
		const apps = Context.get(yield* Layer.build(layer), Apps)
		for (const origin of [
			'https://broken.mp281x.xyz',
			'https://elsewhere.mp281x.xyz',
			'https://stranger.example.com',
			'https://missing.mp281x.xyz'
		]) {
			assert.strictEqual((yield* Effect.flip(apps.register(AppOrigin.make(origin))))._tag, 'AuthError', origin)
		}
		assert.deepStrictEqual(yield* Effect.flatMap(Stream.runHead(apps.watch), Effect.fromOption), [])
	})
)
