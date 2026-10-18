import {NodeRuntime, NodeServices} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'

import {ByteSize, Config, ConfigProvider, Effect, Layer, String, pipe} from 'effect'

import {HttpIncomingMessage, HttpMiddleware, HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'
import {RpcSerialization, RpcServer} from 'effect/rpc'

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

// The receiver never exports its own spans or query traffic back into itself.
NodeRuntime.runMain(
	pipe(
		HttpRouter.serve(
			Layer.mergeAll(
				receiver,
				pipe(
					RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
					Layer.provide(RpcHandlers),
					// Browser WebSockets must come from this UI; CLI clients send no Origin.
					Layer.provide(
						HttpRouter.middleware(effect =>
							Effect.gen(function* () {
								const request = yield* HttpServerRequest.HttpServerRequest
								const origin = request.headers['origin']
								if (
									origin !== undefined &&
									origin !== `http://${request.headers['host'] ?? ''}` &&
									origin !== `https://${request.headers['host'] ?? ''}`
								) {
									return HttpServerResponse.empty({status: 403})
								}
								return yield* effect
							})
						).layer
					)
				),
				ServerRuntime.layerStaticFiles,
				HttpRouter.cors({
					allowedHeaders: ['content-type', 'authorization'],
					allowedMethods: ['POST', 'OPTIONS'],
					allowedOrigins: ['*']
				})
			),
			{disableLogger: true, middleware: HttpMiddleware.decompression()}
		),
		Layer.provide(Telemetry.layer),
		Layer.provide(
			SqliteClient.layerConfig({filename: pipe(Config.String('SCOPE_DATABASE'), Config.withDefault('scope.sqlite'))})
		),
		Layer.provide(RpcSerialization.layerSchemaBinary()),
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
