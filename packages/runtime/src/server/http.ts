import {createServer} from 'node:http'
import {fileURLToPath} from 'node:url'

import {NodeHttpServer} from '@effect/platform-node'

import {Array, ByteSize, Config, Effect, FileSystem, Layer, Option, Path, Result, Schedule, String, pipe} from 'effect'

import {McpProtocol, McpServer} from 'effect/ai'
import {
	HttpClient,
	HttpClientRequest,
	HttpIncomingMessage,
	HttpMiddleware,
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
	HttpStaticServer
} from 'effect/http'
import {RpcSerialization, RpcServer} from 'effect/rpc'
import type {Rpc, RpcGroup} from 'effect/rpc'

import {Auth, layerMcpAuth, localAuth} from '#server/auth.ts'
import {layerStructuredTools} from '#server/mcp.ts'
import {appName, packageMetadata} from '#server/package.ts'
import {APPS_PATH, ISSUER_PATH, failureOptions} from '#shared/auth.ts'
import {RpcStream, layerRpcStream} from '#shared/rpc.ts'
import {
	Account,
	MANIFEST_PATH,
	MCP_METADATA_PATH,
	MCP_PATH,
	RPC_PATH,
	RUNTIME_PATH,
	RuntimeConfig
} from '#shared/schema.ts'
import {layerOtlp} from '#shared/telemetry.ts'

const LOOPBACK = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[\da-f:.]+\])$/iu
const OTLP = ['/v1/traces', '/v1/logs']

// One cross-site check per app: a foreign Origin is refused except for OTLP, and without an issuer only loopback, IP and canonical hosts are served.
export const guard = HttpMiddleware.make(app =>
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
export const layerProtocol = Layer.mergeAll(
	RpcSerialization.layerSchemaBinary(),
	Layer.succeed(HttpIncomingMessage.MaxBodySize)(ByteSize.mebibytes(10)),
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

// Traces and logs go to Scope when `--traces` names it, under the package name its web and iOS clients also use.
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
		const traces = yield* Config.withDefault(Config.String('OTEL_URL'), '')
		const metadata = yield* Effect.cached(packageMetadata)
		yield* router.add(
			'GET',
			RUNTIME_PATH,
			Effect.gen(function* () {
				const release = yield* metadata
				return yield* HttpServerResponse.schemaJson(RuntimeConfig)({
					...Option.match(issuer, {onNone: () => ({}), onSome: origin => ({auth: origin})}),
					name: String.replace('@deslop/', '')(release.name),
					traces,
					version: release.version
				})
			})
		)
		yield* router.add(
			'GET',
			'/auth/user',
			Effect.gen(function* () {
				const user = yield* Effect.result(auth.user((yield* HttpServerRequest.HttpServerRequest).headers))
				if (Result.isFailure(user)) return HttpServerResponse.empty(failureOptions(user.failure, 401))
				return yield* HttpServerResponse.schemaJson(Account)(
					{...user.success, signOut: Option.isSome(issuer)},
					{headers: {'cache-control': 'no-store'}}
				)
			})
		)
	})
)

// An app signed in through Auth tells Auth where it runs once it listens, so Auth's app list needs no list of its own; Auth checks the claim against this app's `/api/runtime`.
export const layerAnnounce = Layer.effectDiscard(
	Effect.gen(function* () {
		const origin = new URL(yield* Config.String('APP_URL')).origin
		const client = pipe(
			yield* HttpClient.HttpClient,
			HttpClient.filterStatusOk,
			HttpClient.timeout('10 seconds'),
			// Auth may restart beside the app, but a permanent refusal will never list it.
			HttpClient.retryTransient({schedule: Schedule.spaced('1 minute'), times: 60})
		)
		yield* Option.match(yield* Config.option(Config.String('AUTH_URL')), {
			onNone: () => Effect.void,
			onSome: Effect.fnUntraced(function* (issuer) {
				yield* pipe(
					HttpClientRequest.post(new URL(APPS_PATH, issuer).href),
					HttpClientRequest.bodyJsonUnsafe({origin}),
					client.execute,
					Effect.delay('2 seconds'),
					Effect.ignore({log: 'Warn', message: 'Auth did not list this app'}),
					Effect.forkScoped
				)
			})
		})
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

// Codex speaks MCP's stateless 2026-07-28 revision; Claude still opens a session, which it ends with DELETE.
export function layerMcp<E, R>(options: {instructions: string; registrations: Layer.Layer<never, E, R>}) {
	return Layer.unwrap(
		Effect.gen(function* () {
			const metadata = yield* packageMetadata
			const canonical = yield* Config.String('APP_URL')
			const issuer = yield* Config.option(Config.String('AUTH_URL'))
			const resource = new URL(MCP_PATH, canonical).href
			const endpoint = Layer.provide(McpServer.layerHttp({
					allowSessionTermination: true,
					icons: [{src: new URL('/icon', canonical).href}],
					instructions: options.instructions,
					name: yield* appName,
					path: MCP_PATH,
					protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18],
					registrations: Layer.provide(options.registrations, layerStructuredTools),
					version: metadata.version
				}), layerMcpAuth(resource))
			return Option.match(issuer, {
				onNone: () => endpoint,
				onSome: origin =>
					Layer.mergeAll(
						endpoint,
						HttpRouter.add(
							'GET',
							MCP_METADATA_PATH,
							Effect.succeed(
								HttpServerResponse.jsonUnsafe({
									authorization_servers: [new URL(ISSUER_PATH, origin).href],
									bearer_methods_supported: ['header'],
									resource,
									scopes_supported: ['deslop']
								})
							)
						)
					)
			})
		})
	)
}

export const layerNodeHttpServer = NodeHttpServer.layerConfig(createServer, {
	gracefulShutdownTimeout: Config.succeed('1500 millis'),
	host: Config.String('HOST'),
	port: Config.Port('PORT')
})
