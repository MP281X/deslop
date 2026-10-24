// @effect-diagnostics-next-line nodeBuiltinImport:off -- NodeHttpServer requires the native server constructor at the application boundary.
import {createServer} from 'node:http'
import {fileURLToPath} from 'node:url'

import {NodeHttpServer} from '@effect/platform-node'

import {Config, Effect, FileSystem, Layer, Path, Predicate, Semaphore, Struct, pipe} from 'effect'

import {McpProtocol, McpServer} from 'effect/ai'
import {HttpRouter, HttpServerResponse, HttpStaticServer} from 'effect/http'
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

export function layer(applicationName: string) {
	return Layer.mergeAll(
		Layer.unwrap(
			Effect.map(pipe(Config.URL('VITE_OTEL_URL'), Config.withDefault(new URL('http://localhost:4318'))), url =>
				layerOtlp(`${applicationName}-server`, url, 'server')
			)
		),
		RpcSerialization.layerSchemaBinary()
	)
}

// Codex speaks MCP's stateless 2026-07-28 revision; Claude still opens a session, which it ends with DELETE.
export function layerMcp(options: {instructions: string; name: string; version: string}) {
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
			Effect.map(pipe(Config.String('AUTH_URL'), Config.withDefault(AUTH_URL)), url =>
				HttpServerResponse.jsonUnsafe({
					authorization_servers: [`${url}/api/auth`],
					bearer_methods_supported: ['header'],
					resource,
					scopes_supported: ['deslop']
				})
			)
		)
	)
}

export const layerStaticFiles = HttpStaticServer.layer({
	index: 'index.html',
	root: fileURLToPath(new URL('./client', import.meta.url)),
	spa: true
})

export const layerNodeHttpServer = NodeHttpServer.layerConfig(createServer, {
	gracefulShutdownTimeout: Config.succeed('1500 millis'),
	host: pipe(Config.String('HOST'), Config.withDefault('0.0.0.0')),
	port: pipe(Config.Port('PORT'), Config.withDefault(5000))
})
