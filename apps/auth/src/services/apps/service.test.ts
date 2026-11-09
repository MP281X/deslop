import {assert, it} from '@effect/vitest'

import {ConfigProvider, Context, Effect, Layer, Stream, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import {Apps} from '#services/apps/service.ts'

const SERVERS: Record<string, {auth: string; name: string; web: boolean; status?: number; manifestStatus?: number}> = {
	'https://broken.mp281x.xyz': {auth: 'not a URL', name: 'broken', web: true},
	'https://elsewhere.mp281x.xyz': {auth: 'https://auth.example.com', name: 'elsewhere', web: true},
	'https://limited.mp281x.xyz': {auth: 'https://auth.mp281x.xyz', manifestStatus: 429, name: 'limited', web: true},
	'https://restarting.mp281x.xyz': {auth: 'https://auth.mp281x.xyz', name: 'restarting', status: 503, web: true},
	'https://scope.mp281x.xyz': {auth: 'https://auth.mp281x.xyz', name: 'scope', web: true},
	'https://stash.mp281x.xyz': {auth: 'https://auth.mp281x.xyz', name: 'stash', web: false},
	'https://stranger.example.com': {auth: 'https://auth.mp281x.xyz', name: 'stranger', web: true},
	'https://unavailable.mp281x.xyz': {
		auth: 'https://auth.mp281x.xyz',
		manifestStatus: 503,
		name: 'unavailable',
		web: true
	}
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
		if (url.pathname === '/manifest.webmanifest' && server.web) {
			return HttpClientResponse.fromWeb(
				request,
				Response.json({name: server.name}, {status: server.manifestStatus ?? 200})
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
	'does not turn an unavailable web manifest into an iOS launcher or a malformed issuer into a defect',
	Effect.fnUntraced(function* () {
		const apps = Context.get(yield* Layer.build(layer), Apps)
		for (const origin of ['https://unavailable.mp281x.xyz', 'https://limited.mp281x.xyz']) {
			assert.strictEqual((yield* Effect.flip(apps.register(origin))).error, 'temporarily_unavailable')
		}
		assert.strictEqual((yield* Effect.flip(apps.register('https://broken.mp281x.xyz')))._tag, 'AuthError')
		assert.deepStrictEqual(yield* Effect.flatMap(Stream.runHead(apps.catalog), Effect.fromOption), [])
	})
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
	'lists an app whose server names this Auth, opening a web app at its site and an iOS app by its scheme',
	Effect.fnUntraced(function* () {
		const apps = Context.get(yield* Layer.build(layer), Apps)
		yield* apps.register('https://stash.mp281x.xyz')
		yield* apps.register('https://scope.mp281x.xyz')
		// Announcing again, as each restart does, keeps one row.
		yield* apps.register('https://scope.mp281x.xyz')
		assert.deepStrictEqual(yield* Effect.flatMap(Stream.runHead(apps.catalog), Effect.fromOption), [
			{name: 'scope', open: 'https://scope.mp281x.xyz', origin: 'https://scope.mp281x.xyz'},
			{name: 'stash', open: 'stash://', origin: 'https://stash.mp281x.xyz'}
		])
	})
)

it.effect(
	'refuses an app that signs in elsewhere, one off the parent domain and one that does not answer',
	Effect.fnUntraced(function* () {
		const apps = Context.get(yield* Layer.build(layer), Apps)
		for (const origin of [
			'https://elsewhere.mp281x.xyz',
			'https://stranger.example.com',
			'https://missing.mp281x.xyz'
		]) {
			assert.isTrue((yield* Effect.exit(apps.register(origin)))._tag === 'Failure', origin)
		}
		assert.deepStrictEqual(yield* Effect.flatMap(Stream.runHead(apps.catalog), Effect.fromOption), [])
	})
)
