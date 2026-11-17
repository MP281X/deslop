// oxlint-disable-next-line effecttsgo/node-builtin-import -- NodeHttpServer requires the native server constructor at the application boundary.
import {createServer} from 'node:http'
import {fileURLToPath} from 'node:url'

import {NodeHttpServer} from '@effect/platform-node'

import {Array, ByteSize, Config, Effect, FileSystem, Layer, Option, Path, Result, String, pipe} from 'effect'

import {McpProtocol, McpServer} from 'effect/ai'
import {
	HttpIncomingMessage,
	HttpClient,
	FetchHttpClient,
	HttpMiddleware,
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
	HttpStaticServer
} from 'effect/http'
import {RpcSerialization, RpcServer} from 'effect/rpc'
import type {Rpc, RpcGroup} from 'effect/rpc'

import {Auth, HttpAuth, localAuth} from '#server/auth.ts'
import {McpStream, layerStructuredTools} from '#server/mcp.ts'
import {appName, packageMetadata} from '#server/package.ts'
import {failureOptions} from '#shared/auth.ts'
import {RpcStream, layerRpcStream} from '#shared/rpc.ts'
import {ACCOUNT_PATH, Account, MANIFEST_PATH, MCP_PATH, RPC_PATH, RUNTIME_PATH, RuntimeConfig} from '#shared/schema.ts'
import {layerOtlp} from '#shared/telemetry.ts'

const LOOPBACK = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[\da-f:.]+\])$/iu
const OTLP = ['/v1/traces', '/v1/logs']

// One cross-site check per app: a foreign Origin is refused except for OTLP, and without an issuer only loopback, IP and canonical hosts are served.
export const crossSiteGuard = HttpMiddleware.make(app =>
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest
		const host = request.headers['host'] ?? ''
		const origin = Option.fromNullishOr(request.headers['origin'])
		if (yield* localAuth) {
			const canonical = new URL(yield* Config.String('APP_URL')).hostname
			if (
				!Option.exists(
					Option.liftThrowable(() => new URL(`http://${host}`))(),
					url => url.hostname === canonical || Option.isSome(String.match(LOOPBACK)(url.hostname))
				)
			) {
				return HttpServerResponse.empty({status: 403})
			}
		}
		const foreign = Option.exists(
			origin,
			value => !Option.exists(Option.liftThrowable(() => new URL(value).host)(), originHost => originHost === host)
		)
		if (
			foreign &&
			request.headers['sec-fetch-site'] !== 'same-origin' &&
			!Array.contains(OTLP, Array.headNonEmpty(String.split(request.url, '?')))
		) {
			return HttpServerResponse.empty({status: 403})
		}
		return yield* app
	})
)

// Binary RPC frames for every client; public endpoints such as client registration read their body before any sign-in, and streamed uploads keep their own limit.
export const layerServerProtocol = Layer.mergeAll(
	RpcSerialization.layerSchemaBinary(),
	Layer.succeed(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(10)),
	Layer.effect(
		HttpMiddleware.TracerDisabledWhen,
		Effect.map(HttpMiddleware.TracerDisabledWhen, previous => request => {
			const path = Array.headNonEmpty(String.split(request.url, '?'))
			return (
				previous(request) ||
				(path === RPC_PATH && String.toLowerCase(request.headers['upgrade'] ?? '') === 'websocket') ||
				String.startsWith('/assets/')(path) ||
				Array.contains(['/icon', '/favicon.ico', '/apple-touch-icon.png', MANIFEST_PATH], path)
			)
		})
	)
)

// With a domain, traces and logs go to Scope under the package name its web and iOS clients also use.
export const layerTelemetry = Layer.unwrap(
	Effect.gen(function* () {
		const metadata = yield* packageMetadata
		return Option.match(yield* Config.option(Config.String('OTEL_URL')), {
			onNone: () => Layer.empty,
			onSome: url => layerOtlp(`${metadata.name}-server`, url, 'server', metadata.version)
		})
	})
)

export const layerRoutes = HttpRouter.use(router =>
	Effect.gen(function* () {
		const auth = yield* Auth
		const issuer = yield* Config.option(Config.String('AUTH_URL'))
		const traces = yield* Config.option(Config.String('OTEL_URL'))
		const canonical = yield* Config.String('APP_URL')
		const metadata = yield* Effect.cached(packageMetadata)
		yield* router.add(
			'GET',
			RUNTIME_PATH,
			Effect.gen(function* () {
				const release = yield* metadata
				return yield* HttpServerResponse.schemaJson(RuntimeConfig)({
					auth: issuer,
					name: String.replace('@deslop/', '')(release.name),
					traces,
					version: release.version
				})
			})
		)
		yield* router.add(
			'GET',
			ACCOUNT_PATH,
			Effect.gen(function* () {
				const account = yield* Effect.result(auth.account((yield* HttpServerRequest.HttpServerRequest).headers))
				if (Result.isFailure(account)) return HttpServerResponse.empty(failureOptions(account.failure, 401))
				return yield* HttpServerResponse.schemaJson(Account)(account.success, {headers: {'cache-control': 'no-store'}})
			})
		)
		// Sign-in and sign-out happen at Auth, whose cookie every app on its domain reads.
		for (const origin of Option.toArray(issuer)) {
			yield* router.add(
				'GET',
				'/auth/sign-in',
				Effect.map(HttpServerRequest.HttpServerRequest, request =>
					HttpServerResponse.redirect(
						`${new URL('/sign-in', origin).href}?${new URLSearchParams({
							next: new URL(request.url, 'http://local').searchParams.get('next') ?? canonical
						})}`
					)
				)
			)
			const client = yield* HttpClient.HttpClient
			yield* router.add(
				'POST',
				'/auth/sign-out',
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					if (request.headers['origin'] !== new URL(canonical).origin) {
						return HttpServerResponse.text('Invalid sign-out origin; no changes committed', {status: 403})
					}
					const target = new URL('/sign-out', origin)
					target.search = new URLSearchParams({
						next: new URL(request.url, canonical).searchParams.get('next') ?? canonical
					}).toString()
					return yield* pipe(
						client.post(target.href, {
							headers: {cookie: request.headers['cookie'] ?? '', origin: new URL(origin).origin}
						}),
						Effect.provideService(FetchHttpClient.RequestInit, {redirect: 'manual'}),
						Effect.timeout('10 seconds'),
						Effect.map(HttpServerResponse.fromClientResponse),
						Effect.tapError(() => Effect.logWarning('Auth did not confirm sign-out')),
						Effect.catch(() =>
							Effect.succeed(
								HttpServerResponse.text('Auth sign-out was not confirmed; the shared session may remain', {status: 503})
							)
						)
					)
				})
			)
		}
	})
)

export function layerIcon(icon: string) {
	const response = Effect.succeed(
		HttpServerResponse.text(icon, {contentType: 'image/svg+xml', headers: {'cache-control': 'public, max-age=86400'}})
	)
	return Layer.mergeAll(HttpRouter.add('GET', '/icon', response), HttpRouter.add('GET', '/favicon.ico', response))
}

export const layerWeb = Layer.unwrap(
	Effect.gen(function* () {
		const client = fileURLToPath(new URL('./client', import.meta.url))
		if (!(yield* (yield* FileSystem.FileSystem).exists((yield* Path.Path).join(client, 'index.html')))) {
			return Layer.empty
		}
		const name = String.capitalize(yield* appName)
		return Layer.mergeAll(
			HttpRouter.add(
				'GET',
				MANIFEST_PATH,
				Effect.succeed(
					HttpServerResponse.jsonUnsafe(
						{
							background_color: '#0d0c0c',
							display: 'standalone',
							// Only the tiled raster: an installed icon must be opaque, and /icon is transparent.
							icons: [{purpose: 'any', src: '/apple-touch-icon.png', type: 'image/png'}],
							id: '/',
							name,
							scope: '/',
							short_name: name,
							start_url: '/',
							theme_color: '#0d0c0c'
						},
						{contentType: 'application/manifest+json', headers: {'cache-control': 'no-cache'}}
					)
				)
			),
			HttpStaticServer.layer({
				cacheControl: 'public, max-age=31536000, immutable',
				prefix: '/assets',
				root: `${client}/assets`
			}),
			HttpStaticServer.layer({cacheControl: 'no-cache', index: 'index.html', root: client, spa: true})
		)
	})
)

export function layerRpc<Rpcs extends Rpc.Any, E, R>(options: {
	disableTracing?: boolean
	group: RpcGroup.RpcGroup<Rpcs>
	handlers: Layer.Layer<Rpc.ToHandler<Rpcs>, E, R>
}) {
	return pipe(
		RpcServer.layerHttp({
			disableTracing: options.disableTracing,
			// Marked for every server before its handler or auth check runs, so a subscription is never read as a failed call.
			group: options.group.middleware(RpcStream),
			path: RPC_PATH,
			protocol: 'websocket'
		}),
		Layer.provide(options.handlers),
		Layer.provide(layerRpcStream)
	)
}

// Codex speaks MCP's stateless 2026-07-28 revision; Claude still opens a session, which it ends with DELETE. Callers are named as on every route: by tailnet, Auth's cookie or an app's on-behalf claim.
export function layerMcp<E, R>(options: {instructions: string; registrations: Layer.Layer<never, E, R>}) {
	return Layer.unwrap(
		Effect.gen(function* () {
			const metadata = yield* packageMetadata
			return Layer.provide(
				McpServer.layerHttp({
					allowSessionTermination: true,
					icons: [{src: new URL('/icon', yield* Config.String('APP_URL')).href}],
					instructions: options.instructions,
					name: yield* appName,
					path: MCP_PATH,
					protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18],
					registrations: Layer.provide(options.registrations, layerStructuredTools),
					version: metadata.version
				}),
				Layer.merge(HttpAuth.layer, McpStream.layer)
			)
		})
	)
}

export const layerNodeHttpServer = NodeHttpServer.layerConfig(createServer, {
	gracefulShutdownTimeout: Config.succeed('1500 millis'),
	host: Config.String('HOST'),
	port: Config.Port('PORT')
})
