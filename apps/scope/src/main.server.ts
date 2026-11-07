import {Array, Config, Effect, Layer, Option, Predicate, Redacted, Schema, SchemaGetter, String, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {Mac} from 'effect/crypto'
import {HttpMiddleware, HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import * as CliRuntime from '@deslop/runtime/cli'
import * as ServerRuntime from '@deslop/runtime/server'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {jobTrace, runIds, runTrace} from '#services/github/lib/utils.ts'
import {WorkflowJob, WorkflowRun} from '#services/github/schema.ts'
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

type Signature = typeof Signature.Type
// GitHub's `X-Hub-Signature-256`: the body's HMAC-SHA256 under the webhook's secret, in hex.
const Signature = pipe(
	Schema.String,
	Schema.check(Schema.isPattern(/^sha256=[0-9a-f]{64}$/u)),
	Schema.decodeTo(Schema.Uint8ArrayFromHex, {
		decode: SchemaGetter.transform(String.slice(7)),
		encode: SchemaGetter.transform(tag => `sha256=${tag}`)
	})
)

// GitHub Actions as traces: a repository's webhook sends each workflow run and job, signed with the secret in GITHUB_WEBHOOK_SECRET; without it the route isn't served.
const github = HttpRouter.use(router =>
	Effect.gen(function* () {
		const telemetry = yield* Telemetry
		const mac = yield* Mac.Mac
		yield* Option.match(yield* Config.option(Config.Redacted('GITHUB_WEBHOOK_SECRET')), {
			onNone: () => Effect.void,
			onSome: Effect.fnUntraced(function* (secret) {
				const key = yield* Mac.key(Mac.hmacSha256, new TextEncoder().encode(Redacted.value(secret)))
				yield* router.add(
					'POST',
					'/v1/github',
					Effect.catchTags(
						Effect.gen(function* () {
							const request = yield* HttpServerRequest.HttpServerRequest
							const body = new Uint8Array(yield* request.arrayBuffer)
							// An unsigned or badly signed request is refused like a wrong signature.
							const signed = yield* Option.match(
								Schema.decodeOption(Signature)(request.headers['x-hub-signature-256'] ?? ''),
								{onNone: () => Effect.succeed(false), onSome: tag => mac.verify(key, tag, body)}
							)
							if (!signed) return HttpServerResponse.empty({status: 401})
							const text = new TextDecoder().decode(body)
							// A run starts its trace without an end, so its jobs show under it as they finish; its completion replaces it.
							if (request.headers['x-github-event'] === 'workflow_run') {
								const event = yield* Schema.decodeEffect(Schema.fromJsonString(WorkflowRun))(text)
								const ids = runIds(event)
								// GitHub doesn't promise order, and redelivers on request: a late start never reopens a run that finished.
								const finished = yield* Effect.map(
									Effect.option(telemetry.trace(ids.traceId)),
									Option.exists(trace =>
										Array.some(
											trace.spans,
											span => span.spanId === ids.spanId && Predicate.isString(span.payload['endTimeUnixNano'])
										)
									)
								)
								if (event.action === 'completed' || (event.action === 'in_progress' && !finished)) {
									yield* telemetry.ingestTraces(runTrace(event))
								}
							}
							if (request.headers['x-github-event'] === 'workflow_job') {
								const event = yield* Schema.decodeEffect(Schema.fromJsonString(WorkflowJob))(text)
								// A job that never ran, skipped by its condition, has nothing to show.
								if (event.action === 'completed' && event.workflow_job.conclusion !== 'skipped') {
									yield* telemetry.ingestTraces(jobTrace(event))
								}
							}
							// Other events, such as the ping a new webhook sends, need nothing beyond being received.
							return HttpServerResponse.empty({status: 204})
						}),
						{
							CryptoError: () => Effect.succeed(HttpServerResponse.empty({status: 401})),
							HttpServerError: () => Effect.succeed(HttpServerResponse.empty({status: 400})),
							SchemaError: error => Effect.succeed(HttpServerResponse.text(error.message, {status: 400})),
							TelemetryError: () => Effect.succeed(HttpServerResponse.empty({status: 503}))
						}
					)
				)
			})
		})
	})
)

// The receiver never exports its own spans or query traffic back into itself.
CliRuntime.runApp({
	icon,
	routes: pipe(
		Layer.mergeAll(
			receiver,
			github,
			ServerRuntime.layerRpc({group: RpcContracts, handlers: RpcHandlers}),
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
