// @effect-diagnostics-next-line nodeBuiltinImport:off -- NodeHttpServer requires the native server constructor at the application boundary.
import {createServer} from 'node:http'
import {cwd} from 'node:process'
import {fileURLToPath} from 'node:url'
import {createZstdDecompress} from 'node:zlib'

import {NodeHttpServer, NodeStream} from '@effect/platform-node'

import {
	Array,
	Boolean,
	ByteSize,
	Config,
	Effect,
	FileSystem,
	HashMap,
	HashSet,
	Layer,
	Option,
	Path,
	Predicate,
	Result,
	Schedule,
	Schema,
	Semaphore,
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

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
import {KeyValueStore} from 'effect/persistence'
import {RpcSerialization, RpcServer} from 'effect/rpc'
import type {Rpc, RpcGroup} from 'effect/rpc'

import {Account, PackageMetadata, RPC_PATH, RuntimeConfig} from '#schema.ts'
import {layerOtlp} from '#telemetry.ts'

import {ISSUER_PATH, localAuth} from '#auth/lib/utils.ts'
import {Auth, layerMcpAuth} from '#auth/service.ts'

const LOOPBACK = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[\da-f:.]+\])$/iu
const OTLP = ['/v1/traces', '/v1/logs']

// The bundle is `dist/server.js`, so its package sits one directory up, wherever npm installed it; unbundled, as in tests, it is the package being run.
export const packageRoot = Boolean.match(String.endsWith('.ts')(import.meta.url), {
	onFalse: () => fileURLToPath(new URL('..', import.meta.url)),
	onTrue: cwd
})

export const packageMetadata = Effect.gen(function* () {
	const file = (yield* Path.Path).join(packageRoot, 'package.json')
	return yield* Schema.decodeEffect(Schema.fromJsonString(PackageMetadata))(
		yield* (yield* FileSystem.FileSystem).readFileString(file)
	)
})

export const appName = Effect.map(packageMetadata, metadata => String.replace('@deslop/', '')(metadata.name))

// A checkout holds `pnpm-workspace.yaml` at its root; an npm installation has none above it.
const checkoutRoot = Effect.fnUntraced(function* (
	directory: string
): Effect.fn.Return<Option.Option<string>, never, FileSystem.FileSystem | Path.Path> {
	const path = yield* Path.Path
	if (
		yield* Effect.orElseSucceed(
			(yield* FileSystem.FileSystem).exists(path.join(directory, 'pnpm-workspace.yaml')),
			() => false
		)
	) {
		return Option.some(directory)
	}
	if (path.dirname(directory) === directory) return Option.none()
	return yield* checkoutRoot(path.dirname(directory))
})

// An installed app keeps its data in ~/.deslop/<app>; one run from a checkout, such as a preview, in that checkout's .deslop/<app>.
export const dataDirectory = Effect.gen(function* () {
	const path = yield* Path.Path
	const name = yield* appName
	const directory = yield* Option.match(yield* checkoutRoot(packageRoot), {
		onNone: () => Effect.map(Config.String('HOME'), home => path.join(home, '.deslop', name)),
		onSome: root => Effect.succeed(path.join(root, '.deslop', name))
	})
	yield* (yield* FileSystem.FileSystem).makeDirectory(directory, {mode: 0o700, recursive: true})
	return directory
})

// The app's native tools ship zstd-compressed in its `bin/`; the first use of a release unpacks one into the data directory.
export const tool = Effect.fnUntraced(function* (name: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const version = (yield* packageMetadata).version
	const tools = path.join(yield* dataDirectory, 'tools')
	const target = path.join(tools, version, name)
	if (yield* fs.exists(target)) return target
	yield* fs.makeDirectory(path.dirname(target), {recursive: true})
	yield* Effect.scoped(
		Effect.gen(function* () {
			const temporary = path.join(yield* fs.makeTempDirectoryScoped({directory: path.dirname(target)}), name)
			yield* pipe(
				fs.stream(path.join(packageRoot, 'bin', `${name}.zst`)),
				NodeStream.pipeThroughSimple(() => createZstdDecompress()),
				Stream.run(fs.sink(temporary))
			)
			yield* fs.chmod(temporary, 0o755)
			yield* fs.rename(temporary, target)
		})
	)
	yield* Effect.forEach(
		Array.filter(yield* fs.readDirectory(tools), entry => entry !== version),
		entry => fs.remove(path.join(tools, entry), {recursive: true}),
		{concurrency: 1}
	)
	return target
})

// One cross-site check for every app. A browser's Origin must name the host it reached, except for the OTLP receiver any page may export to. Without an issuer, where every request is the developer, only loopback, IP and the canonical host names are served, so a rebound DNS name cannot reach the app.
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

// Schema stores share Effect's filesystem implementation, but replace values atomically instead of truncating them in place.
export function layerKeyValueStore(directory: string) {
	return pipe(
		Layer.effect(
			KeyValueStore.KeyValueStore,
			Effect.gen(function* () {
				const base = yield* KeyValueStore.KeyValueStore
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const writes = yield* Semaphore.make(1)
				return KeyValueStore.make({
					...Struct.omit(base, ['set', 'modify', 'modifyUint8Array']),
					set: (key, value) => {
						if (key === '' || key === '.' || key === '..') {
							return Effect.fail(
								new KeyValueStore.KeyValueStoreError({key, message: 'Invalid storage key', method: 'set'})
							)
						}
						const target = path.join(directory, encodeURIComponent(key))
						return pipe(
							Effect.gen(function* () {
								if (Predicate.isString(value)) yield* fs.writeFileString(`${target}.tmp`, value, {mode: 0o600})
								else yield* fs.writeFile(`${target}.tmp`, value, {mode: 0o600})
							}),
							Effect.andThen(fs.rename(`${target}.tmp`, target)),
							Semaphore.withPermit(writes),
							Effect.uninterruptible,
							Effect.mapError(
								cause =>
									new KeyValueStore.KeyValueStoreError({cause, key, message: 'Cannot save the value', method: 'set'})
							)
						)
					}
				})
			})
		),
		Layer.provide(KeyValueStore.layerFileSystem(directory))
	)
}

// The app's KeyValueStore, in its data directory.
export const layerDataStore = Layer.unwrap(Effect.map(dataDirectory, layerKeyValueStore))

// A live list as the events its clients apply: the whole list once, then the items each update added or replaced by identity and the ids it removed.
export function listEvents<A extends {id: string}, E, R>(lists: Stream.Stream<readonly A[], E, R>) {
	return Stream.mapAccum(
		lists,
		() => Option.none<readonly A[]>(),
		(previous, current) => {
			const events = Option.match(previous, {
				onNone: () => [{removed: Array.empty<A['id']>(), reset: true, upserted: current}],
				onSome: before => {
					const kept = HashMap.fromIterable(Array.map(before, item => [item.id, item] as const))
					const ids = HashSet.fromIterable(Array.map(current, item => item.id))
					const removed = Array.filter(
						Array.map(before, item => item.id),
						id => !HashSet.has(ids, id)
					)
					const upserted = Array.filter(
						current,
						item => !Option.exists(HashMap.get(kept, item.id), old => old === item)
					)
					if (Array.isArrayEmpty(removed) && Array.isArrayEmpty(upserted)) return []
					return [{removed, reset: false, upserted}]
				}
			})
			return [Option.some(current), events] as const
		}
	)
}

// Binary RPC frames unless an app picks JSON; public endpoints such as client registration read their body before any sign-in, and streamed uploads keep their own limit.
export const layerProtocol = Layer.mergeAll(
	RpcSerialization.layerSchemaBinary(),
	Layer.succeed(HttpIncomingMessage.MaxBodySize)(ByteSize.mebibytes(10))
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

// Pages and assets are public; the account menu, the runtime settings and the way to Auth and back.
export const layerRoutes = HttpRouter.use(router =>
	Effect.gen(function* () {
		const auth = yield* Auth
		const canonical = new URL(yield* Config.String('APP_URL')).origin
		const issuer = yield* Config.option(Config.String('AUTH_URL'))
		const traces = yield* pipe(Config.String('OTEL_URL'), Config.withDefault(''))
		// A destination on this app only, so the round trip through Auth cannot be turned into an open redirect.
		const toIssuer = Effect.fnUntraced(function* (search: Record<string, string>) {
			const request = yield* HttpServerRequest.HttpServerRequest
			const next = Option.filter(
				Option.liftThrowable(
					() => new URL(new URL(request.url, canonical).searchParams.get('next') ?? canonical, canonical)
				)(),
				url => url.origin === canonical
			)
			return Option.match(issuer, {
				onNone: () => HttpServerResponse.text('Sign-in is not configured for this app', {status: 503}),
				onSome: origin =>
					Option.match(next, {
						onNone: () => HttpServerResponse.empty({status: 400}),
						onSome: url =>
							HttpServerResponse.redirect(
								`${new URL('/', origin).href}?${new URLSearchParams({...search, next: url.href})}`
							)
					})
			})
		})
		yield* router.add(
			'GET',
			'/api/runtime',
			Effect.gen(function* () {
				return yield* HttpServerResponse.schemaJson(RuntimeConfig)({
					...Option.match(issuer, {onNone: () => ({}), onSome: origin => ({auth: origin})}),
					name: yield* appName,
					traces,
					version: (yield* packageMetadata).version
				})
			})
		)
		yield* router.add('GET', '/auth/sign-in', toIssuer({}))
		yield* router.add('GET', '/auth/sign-out', toIssuer({'sign-out': ''}))
		yield* router.add(
			'GET',
			'/auth/user',
			Effect.gen(function* () {
				const user = yield* Effect.result(auth.user((yield* HttpServerRequest.HttpServerRequest).headers))
				if (Result.isFailure(user)) return HttpServerResponse.empty({status: 401})
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
		const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
		yield* Option.match(yield* Config.option(Config.String('AUTH_URL')), {
			onNone: () => Effect.void,
			onSome: Effect.fnUntraced(function* (issuer) {
				yield* pipe(
					HttpClientRequest.post(new URL('/api/apps', issuer).href),
					HttpClientRequest.bodyJsonUnsafe({origin}),
					client.execute,
					Effect.delay('2 seconds'),
					// While Auth restarts too, as after a release; an hour of refusals means it never will list this app.
					Effect.retry({schedule: Schedule.spaced('1 minute'), times: 60}),
					Effect.ignore({log: 'Warn', message: 'Auth did not list this app'}),
					Effect.forkScoped
				)
			})
		})
	})
)

// The app's transparent icon at a stable URL for Auth's app list and MCP clients, and at /favicon.ico for clients that guess; the pack loader passes its SVG markup.
export function layerIcon(icon: string) {
	const response = Effect.succeed(
		HttpServerResponse.text(icon, {contentType: 'image/svg+xml', headers: {'cache-control': 'public, max-age=86400'}})
	)
	return Layer.mergeAll(HttpRouter.add('GET', '/icon', response), HttpRouter.add('GET', '/favicon.ico', response))
}

// A web app's pages, with assets kept until a deploy changes index.html, and its manifest, so a phone installs it as its own app.
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
				'/manifest.webmanifest',
				Effect.succeed(
					HttpServerResponse.jsonUnsafe(
						{
							background_color: '#0a0a0a',
							display: 'standalone',
							// Only the tiled raster: an installed icon must be opaque, and /icon is transparent.
							icons: [{purpose: 'any', sizes: '512x512', src: '/apple-touch-icon.png', type: 'image/png'}],
							id: '/',
							name,
							scope: '/',
							short_name: name,
							start_url: '/',
							theme_color: '#0a0a0a'
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

// An app's RPC socket: one path and protocol, which its web, iOS and peer-worker clients also open.
export function layerRpc<Rpcs extends Rpc.Any, E, R>(options: {
	disableTracing?: boolean
	group: RpcGroup.RpcGroup<Rpcs>
	handlers: Layer.Layer<Rpc.ToHandler<Rpcs>, E, R>
}) {
	return pipe(
		RpcServer.layerHttp({
			disableTracing: options.disableTracing,
			group: options.group,
			path: RPC_PATH,
			protocol: 'websocket'
		}),
		Layer.provide(options.handlers)
	)
}

// Codex speaks MCP's stateless 2026-07-28 revision; Claude still opens a session, which it ends with DELETE.
export function layerMcp<RA, RE, RR>(options: {instructions: string; registrations: Layer.Layer<RA, RE, RR>}) {
	return Layer.unwrap(
		Effect.gen(function* () {
			const metadata = yield* packageMetadata
			const canonical = yield* Config.String('APP_URL')
			const issuer = yield* Config.option(Config.String('AUTH_URL'))
			const resource = new URL('/mcp', canonical).href
			const endpoint = pipe(
				McpServer.layerHttp({
					...options,
					allowSessionTermination: true,
					icons: [{src: new URL('/icon', canonical).href}],
					name: yield* appName,
					path: '/mcp',
					protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18],
					version: metadata.version
				}),
				Layer.provide(layerMcpAuth(resource))
			)
			return Option.match(issuer, {
				onNone: () => endpoint,
				onSome: origin =>
					Layer.mergeAll(
						endpoint,
						HttpRouter.add(
							'GET',
							'/.well-known/oauth-protected-resource/mcp',
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
