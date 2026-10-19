// @effect-diagnostics-next-line nodeBuiltinImport:off -- NodeHttpServer requires the native server constructor at the application boundary.
import {createServer} from 'node:http'

import {NodeHttpClient, NodeHttpServer, NodeRuntime, NodeServices} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'

import {ByteSize, Config, Effect, FileSystem, Layer, Path, String, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {HttpIncomingMessage, HttpMiddleware, HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {Auth, HttpAuth} from '@deslop/auth/service'
import * as ServerRuntime from '@deslop/runtime/server'

import packageJson from '#package.json' with {type: 'json'}

import {LogsRequest, TracesRequest} from '#services/telemetry/schema.ts'
import {Telemetry} from '#services/telemetry/service.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

const receiver = HttpRouter.use(router =>
	Effect.gen(function* () {
		const telemetry = yield* Telemetry
		const ack = HttpServerResponse.text('{}', {contentType: 'application/json'})
		yield* router.add('POST', '/v1/traces', request => {
			if (!String.startsWith('application/json')(request.headers['content-type'] ?? '')) {
				return Effect.succeed(HttpServerResponse.empty({status: 415}))
			}
			return pipe(
				HttpServerRequest.schemaBodyJson(TracesRequest),
				Effect.flatMap(payload => telemetry.ingestTraces(payload)),
				Effect.as(ack),
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
		})
		yield* router.add('POST', '/v1/logs', request => {
			if (!String.startsWith('application/json')(request.headers['content-type'] ?? '')) {
				return Effect.succeed(HttpServerResponse.empty({status: 415}))
			}
			return pipe(
				HttpServerRequest.schemaBodyJson(LogsRequest),
				Effect.flatMap(payload => telemetry.ingestLogs(payload)),
				Effect.as(ack),
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
		})
		yield* router.add('GET', '/health', HttpServerResponse.text('ready'))
	})
)

// Public MCP clients authorize through the shared auth app.
const mcp = pipe(
	McpServer.toolkit(Tools),
	Layer.provide(ToolHandlers),
	Layer.provide(
		ServerRuntime.layerMcp({
			instructions:
				'Scope receives OTLP/HTTP JSON traces and logs from Effect apps in development and keeps only the current run of each app. Start with services, then traces; read one trace whole with trace.',
			name: 'scope',
			version: packageJson.version
		})
	)
)

const database = Layer.unwrap(
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const directory = path.join(yield* Config.String('HOME'), '.deslop', 'scope')
		yield* fs.makeDirectory(directory, {recursive: true})
		return SqliteClient.layer({filename: path.join(directory, 'telemetry.sqlite')})
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
					{disableLogger: true, middleware: HttpMiddleware.decompression()}
				),
				Layer.provide(ServerRuntime.layerNodeHttpServer)
			),
			// Exporters inside the private Docker network and tailnet keep their standard OTLP port.
			pipe(
				HttpRouter.serve(Layer.merge(Layer.fresh(receiver), HttpRouter.cors({allowedHeaders: ['content-type']})), {
					disableLogger: true,
					middleware: HttpMiddleware.decompression()
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
		Layer.provide(Telemetry.layer),
		Layer.provide(database),
		Layer.provide(NodeServices.layer),
		Layer.provide(Layer.succeed(HttpIncomingMessage.MaxBodySize)(ByteSize.mebibytes(10))),
		Layer.launch
	)
)
