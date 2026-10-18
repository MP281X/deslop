import {NodeRuntime, NodeServices} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'

import {ByteSize, Config, ConfigProvider, Effect, FileSystem, Layer, Path, String, pipe} from 'effect'

import {
	FetchHttpClient,
	HttpIncomingMessage,
	HttpMiddleware,
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse
} from 'effect/http'
import {RpcSerialization, RpcServer} from 'effect/rpc'

import {Auth, HttpAuth} from '@deslop/auth/service'
import * as ServerRuntime from '@deslop/runtime/server'

import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {LogsRequest, TracesRequest} from '#services/telemetry/schema.ts'
import {Telemetry} from '#services/telemetry/service.ts'

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
		HttpRouter.serve(
			Layer.mergeAll(
				receiver,
				pipe(
					Layer.merge(
						pipe(
							RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
							Layer.provide(RpcHandlers)
						),
						pipe(ServerRuntime.layerStaticFiles, Layer.provide(HttpAuth.layer))
					),
					Layer.provide(Auth.layer)
				),
				HttpRouter.cors({
					allowedHeaders: ['content-type', 'authorization'],
					allowedMethods: ['POST', 'OPTIONS'],
					allowedOrigins: ['*']
				})
			),
			{disableLogger: true, middleware: HttpMiddleware.decompression()}
		),
		Layer.provide(Telemetry.layer),
		Layer.provide(database),
		Layer.provide(RpcSerialization.layerSchemaBinary()),
		Layer.provide(FetchHttpClient.layer),
		Layer.provide(NodeServices.layer),
		Layer.provide(Layer.succeed(HttpIncomingMessage.MaxBodySize)(ByteSize.mebibytes(10))),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.provide(
			ConfigProvider.layer(
				ConfigProvider.orElse(ConfigProvider.fromEnv(), ConfigProvider.fromUnknown({HOST: '127.0.0.1'}))
			)
		),
		Layer.launch
	)
)
