// @effect-diagnostics-next-line nodeBuiltinImport:off -- NodeHttpServer requires the native server constructor at the application boundary.
import {createServer} from 'node:http'
import {fileURLToPath} from 'node:url'

import {NodeHttpServer} from '@effect/platform-node'

import {
	Array,
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
	Semaphore,
	Stream,
	Struct,
	pipe
} from 'effect'

import {McpProtocol, McpServer} from 'effect/ai'
import {HttpIncomingMessage, HttpRouter, HttpServerResponse, HttpStaticServer} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'
import {RpcSerialization} from 'effect/rpc'

import {layerOtlp} from '#telemetry.ts'

import {AUTH_URL} from '#auth/lib/utils.ts'
import {layerMcpAuth} from '#auth/service.ts'

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

export function layer(applicationName: string) {
	return Layer.mergeAll(
		Layer.unwrap(
			Effect.map(pipe(Config.URL('VITE_OTEL_URL'), Config.withDefault(new URL('http://localhost:4318'))), url =>
				layerOtlp(`${applicationName}-server`, url, 'server')
			)
		),
		RpcSerialization.layerSchemaBinary(),
		// Public endpoints such as client registration read their body before any sign-in; streamed uploads keep their own limit.
		Layer.succeed(HttpIncomingMessage.MaxBodySize)(ByteSize.mebibytes(10))
	)
}

// Codex speaks MCP's stateless 2026-07-28 revision; Claude still opens a session, which it ends with DELETE.
export function layerMcp<RA, RE, RR>(options: {
	instructions: string
	name: string
	registrations: Layer.Layer<RA, RE, RR>
	version: string
}) {
	const resource = `https://${options.name}.mp281x.xyz/mcp`
	return Layer.mergeAll(
		pipe(
			McpServer.layerHttp({
				...options,
				allowSessionTermination: true,
				path: '/mcp',
				protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18]
			}),
			Layer.provide(layerMcpAuth(resource))
		),
		HttpRouter.add(
			'GET',
			'/.well-known/oauth-protected-resource/mcp',
			Effect.succeed(
				HttpServerResponse.jsonUnsafe({
					authorization_servers: [`${AUTH_URL}/api/auth`],
					bearer_methods_supported: ['header'],
					resource,
					scopes_supported: ['deslop']
				})
			)
		)
	)
}

// Vite names every asset by its content hash, so a browser keeps it until a deploy changes index.html, which it always revalidates.
export const layerStaticFiles = Layer.mergeAll(
	HttpStaticServer.layer({
		cacheControl: 'public, max-age=31536000, immutable',
		prefix: '/assets',
		root: fileURLToPath(new URL('./client/assets', import.meta.url))
	}),
	HttpStaticServer.layer({
		cacheControl: 'no-cache',
		index: 'index.html',
		root: fileURLToPath(new URL('./client', import.meta.url)),
		spa: true
	})
)

export const layerNodeHttpServer = NodeHttpServer.layerConfig(createServer, {
	gracefulShutdownTimeout: Config.succeed('1500 millis'),
	host: pipe(Config.String('HOST'), Config.withDefault('0.0.0.0')),
	port: pipe(Config.Port('PORT'), Config.withDefault(5000))
})
