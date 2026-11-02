import type {Schema} from 'effect'
import {Effect, Layer, String, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {HttpMiddleware, HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'
import {RpcServer} from 'effect/rpc'

import * as CliRuntime from '@deslop/runtime/cli'
import * as ServerRuntime from '@deslop/runtime/server'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import type {TelemetryError} from '#services/telemetry/schema.ts'
import {LogsRequest, TracesRequest} from '#services/telemetry/schema.ts'
import {Telemetry} from '#services/telemetry/service.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

// Any page, server or phone may export without signing in, as OTLP receivers take it.
const cors = HttpMiddleware.cors({allowedHeaders: ['content-type'], allowedMethods: ['POST']})

// OTLP/HTTP JSON: the status codes and `code` values are the protocol's own.
function answer<A, I>(schema: Schema.Codec<A, I>, save: (payload: A) => Effect.Effect<void, TelemetryError>) {
	return Effect.flatMap(HttpServerRequest.HttpServerRequest, request => {
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
	})
}

const receiver = HttpRouter.use(router =>
	Effect.gen(function* () {
		const telemetry = yield* Telemetry
		// Rejected exports are counted; headers and bodies are never recorded.
		const ingest = Effect.fnUntraced(function* <A, I>(
			route: '/v1/traces' | '/v1/logs',
			schema: Schema.Codec<A, I>,
			save: (payload: A) => Effect.Effect<void, TelemetryError>
		) {
			const request = yield* HttpServerRequest.HttpServerRequest
			const response = yield* answer(schema, save)
			if (response.status >= 400) {
				function credential() {
					if (request.headers['authorization'] !== undefined) return 'authorization' as const
					if (request.headers['cookie'] !== undefined) return 'cookie' as const
					return 'none' as const
				}
				yield* telemetry.reject({credential: credential(), route, status: response.status})
			}
			return response
		})
		yield* router.add('POST', '/v1/traces', cors(ingest('/v1/traces', TracesRequest, telemetry.ingestTraces)))
		yield* router.add('POST', '/v1/logs', cors(ingest('/v1/logs', LogsRequest, telemetry.ingestLogs)))
		// A browser asks before posting JSON across origins.
		yield* router.add('OPTIONS', '/v1/*', cors(Effect.succeed(HttpServerResponse.empty())))
		yield* router.add('GET', '/health', HttpServerResponse.text('ready'))
	})
)

// The receiver never exports its own spans or query traffic back into itself.
CliRuntime.runApp({
	icon,
	routes: pipe(
		Layer.mergeAll(
			receiver,
			pipe(
				RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
				Layer.provide(RpcHandlers)
			),
			ServerRuntime.layerMcp({
				instructions: "Scope is the debugger for the user's Effect apps: their traces, spans and logs.",
				registrations: pipe(McpServer.toolkit(Tools), Layer.provide(ToolHandlers))
			})
		),
		Layer.provide(
			Layer.unwrap(Effect.map(ServerRuntime.dataDirectory, directory => Telemetry.layer(`${directory}/entries`)))
		)
	),
	telemetry: false
})
