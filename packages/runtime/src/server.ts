// @effect-diagnostics-next-line nodeBuiltinImport:off -- NodeHttpServer requires the native server constructor at the application boundary.
import {createServer} from 'node:http'
import {fileURLToPath} from 'node:url'

import {NodeHttpServer} from '@effect/platform-node'

import {Array, Config, Effect, Layer, Option, String, pipe} from 'effect'

import {McpProtocol, McpServer} from 'effect/ai'
import {HttpRouter, HttpServerRequest, HttpServerResponse, HttpStaticServer} from 'effect/http'
import {RpcSerialization} from 'effect/rpc'

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
	return pipe(
		McpServer.layerHttp({
			...options,
			allowSessionTermination: true,
			path: '/mcp',
			protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18]
		}),
		// An MCP session lives until its client ends it, so only the tailnet may open one.
		Layer.provide(
			HttpRouter.middleware(app =>
				Effect.gen(function* () {
					// A request through the public proxy, or from a web page whose domain was rebound to the server, carries another host.
					if (
						!Option.exists(
							Option.flatMap(
								Option.fromNullishOr((yield* HttpServerRequest.HttpServerRequest).headers['host']),
								value => Option.liftThrowable(() => new URL(`http://${value}`).hostname)()
							),
							name => Array.contains(['localhost', '127.0.0.1', '[::1]'], name) || String.endsWith('.ts.net')(name)
						)
					) {
						return HttpServerResponse.empty({status: 403})
					}
					return yield* app
				})
			).layer
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
