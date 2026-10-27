// @effect-diagnostics-next-line nodeBuiltinImport:off -- NodeHttpServer requires the native server constructor at the application boundary.
import {createServer} from 'node:http'

import {NodeHttpClient, NodeHttpServer, NodeRuntime, NodeServices} from '@effect/platform-node'

import type {Schema} from 'effect'
import {Array, ByteSize, Config, Effect, FileSystem, Layer, Path, String, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {
	HttpIncomingMessage,
	HttpMiddleware,
	HttpRouter,
	HttpServerError,
	HttpServerRequest,
	HttpServerResponse
} from 'effect/http'

import {Auth, HttpAuth} from '@deslop/runtime/auth/service'
import * as ServerRuntime from '@deslop/runtime/server'

import packageJson from '#package.json' with {type: 'json'}

import type {TelemetryError} from '#services/telemetry/schema.ts'
import {LogsRequest, TracesRequest} from '#services/telemetry/schema.ts'
import {Telemetry} from '#services/telemetry/service.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

// OTLP/HTTP JSON: the status codes and `code` values are the protocol's own.
function ingest<A, I>(schema: Schema.Codec<A, I>, save: (payload: A) => Effect.Effect<void, TelemetryError>) {
	return (request: HttpServerRequest.HttpServerRequest) => {
		if (!String.startsWith('application/json')(request.headers['content-type'] ?? '')) {
			return Effect.succeed(HttpServerResponse.empty({status: 415}))
		}
		return pipe(
			HttpServerRequest.schemaBodyJson(schema),
			Effect.flatMap(save),
			Effect.as(HttpServerResponse.text('{}', {contentType: 'application/json'})),
			Effect.catchTags({
				HttpServerError: () =>
					Effect.succeed(HttpServerResponse.jsonUnsafe({code: 3, message: 'Invalid OTLP JSON body'}, {status: 400})),
				SchemaError: error =>
					Effect.succeed(HttpServerResponse.jsonUnsafe({code: 3, message: error.message}, {status: 400})),
				TelemetryError: () =>
					Effect.succeed(
						HttpServerResponse.jsonUnsafe({code: 14, message: 'Telemetry storage unavailable'}, {status: 503})
					)
			})
		)
	}
}

const receiver = HttpRouter.use(router =>
	Effect.gen(function* () {
		const telemetry = yield* Telemetry
		yield* router.add('POST', '/v1/traces', ingest(TracesRequest, telemetry.ingestTraces))
		yield* router.add('POST', '/v1/logs', ingest(LogsRequest, telemetry.ingestLogs))
		yield* router.add('GET', '/health', HttpServerResponse.text('ready'))
	})
)

// Count rejected exports, not normal MCP OAuth challenges. Headers and bodies are never recorded.
const observe = HttpMiddleware.make(app =>
	pipe(
		app,
		Effect.onExit(exit =>
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				const route = Array.headNonEmpty(String.split(request.url, '?'))
				const status = HttpServerError.exitResponse(exit).status
				if ((route !== '/v1/traces' && route !== '/v1/logs') || status < 400) return
				function credential() {
					if (request.headers['authorization'] !== undefined) return 'authorization' as const
					if (request.headers['cookie'] !== undefined) return 'cookie' as const
					return 'none' as const
				}
				yield* (yield* Telemetry).reject({credential: credential(), route, status})
			})
		)
	)
)

// Public MCP clients authorize through the shared auth app.
const mcp = pipe(
	McpServer.toolkit(Tools),
	Layer.provide(ToolHandlers),
	Layer.provide(
		ServerRuntime.layerMcp({
			instructions:
				"Scope is the debugger for the user's Effect apps. Start with list_services for ingestion freshness and rejected exports, then reproduce the action and use find_traces/read_trace or find_logs. Searches default to each service's latest process/page load/app launch; runs: all includes retained earlier runs in the lookback. read_trace always opens the whole stored trace. Use measure_latency on the same operation before and after a change. If tools are missing, check the client's MCP connection/authentication; stored OAuth credentials alone do not prove a working connection.",
			name: 'scope',
			version: packageJson.version
		})
	)
)

const telemetry = Layer.unwrap(
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const directory = path.join(yield* Config.String('HOME'), '.deslop', 'scope')
		yield* fs.makeDirectory(directory, {recursive: true})
		yield* Effect.forEach(
			['telemetry.sqlite', 'telemetry.sqlite-wal', 'telemetry.sqlite-shm'],
			name => fs.remove(path.join(directory, name), {force: true}),
			{concurrency: 1, discard: true}
		)
		return Telemetry.layer(path.join(directory, 'entries'))
	})
)

// The receiver never exports its own spans or query traffic back into itself.
NodeRuntime.runMain(
	pipe(
		Layer.merge(
			pipe(
				HttpRouter.serve(
					Layer.mergeAll(
						pipe(Layer.fresh(receiver), Layer.provide(HttpAuth.layer)),
						mcp,
						HttpRouter.cors({
							allowedHeaders: ['authorization', 'content-type'],
							allowedMethods: ['POST', 'OPTIONS'],
							allowedOrigins: ['https://portfolio.mp281x.xyz', 'https://auth.mp281x.xyz', 'https://stash.mp281x.xyz'],
							credentials: true
						})
					),
					{disableLogger: true, middleware: observe}
				),
				Layer.provide(ServerRuntime.layerNodeHttpServer)
			),
			// Exporters inside the private Docker network and tailnet keep their standard OTLP port.
			pipe(
				HttpRouter.serve(Layer.merge(Layer.fresh(receiver), HttpRouter.cors({allowedHeaders: ['content-type']})), {
					disableLogger: true,
					middleware: observe
				}),
				Layer.provide(
					NodeHttpServer.layerConfig(createServer, {
						host: pipe(Config.String('HOST'), Config.withDefault('127.0.0.1')),
						port: Config.succeed(4318)
					})
				)
			)
		),
		Layer.provide(Auth.layer('https://otel.mp281x.xyz')),
		Layer.provide(NodeHttpClient.layerFetch),
		Layer.provide(telemetry),
		Layer.provide(NodeServices.layer),
		Layer.provide(Layer.succeed(HttpIncomingMessage.MaxBodySize)(ByteSize.mebibytes(10))),
		Layer.launch
	)
)
