// @effect-diagnostics-next-line nodeBuiltinImport:off -- NodeHttpServer requires the native server constructor at the application boundary.
import {createServer} from 'node:http'
import {fileURLToPath} from 'node:url'

import {NodeHttpServer} from '@effect/platform-node'

import {Config, Effect, Layer, pipe} from 'effect'

import {McpProtocol, McpServer} from 'effect/ai'
import {HttpRouter, HttpServerResponse, HttpStaticServer} from 'effect/http'
import {RpcSerialization} from 'effect/rpc'

import {layerMcpAuth} from '@deslop/auth/service'
import {AUTH_URL} from '@deslop/auth/utils'

import {layerOtlp} from '#telemetry.ts'

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
