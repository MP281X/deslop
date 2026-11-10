import {assert, it} from '@effect/vitest'

import {ConfigProvider, Context, Effect, Layer, Stream, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

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

const layer = pipe(
	Apps.layer,
	Layer.provide(
		Layer.mergeAll(
			KeyValueStore.layerMemory,
			Layer.succeed(HttpClient.HttpClient, servers),
			ConfigProvider.layer(ConfigProvider.fromUnknown({APP_URL: 'https://auth.mp281x.xyz'}))
		)
	)
)

it.effect(
	'keeps a restarting app announcement retryable',
	Effect.fnUntraced(function* () {
		const apps = Context.get(yield* Layer.build(layer), Apps)
		assert.strictEqual(
			(yield* Effect.flip(apps.register('https://restarting.mp281x.xyz'))).error,
			'temporarily_unavailable'
		)
	})
)

it.effect(
	'lists an app whose server names this Auth',
	Effect.fnUntraced(function* () {
		const apps = Context.get(yield* Layer.build(layer), Apps)
		yield* apps.register('https://stash.mp281x.xyz')
		yield* apps.register('https://scope.mp281x.xyz')
		// Announcing again, as each restart does, keeps one row.
		yield* apps.register('https://scope.mp281x.xyz')
		assert.deepStrictEqual(yield* Effect.flatMap(Stream.runHead(apps.catalog), Effect.fromOption), [
			{name: 'scope', origin: 'https://scope.mp281x.xyz'},
			{name: 'stash', origin: 'https://stash.mp281x.xyz'}
		])
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
			assert.strictEqual((yield* Effect.flip(apps.register(origin)))._tag, 'AuthError', origin)
		}
		assert.deepStrictEqual(yield* Effect.flatMap(Stream.runHead(apps.catalog), Effect.fromOption), [])
	})
)
