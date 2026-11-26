import {Boolean, ByteSize, Cache, Duration, Effect, Function, Ref, Result, Schema, String, pipe} from 'effect'

import {
	HttpIncomingMessage,
	HttpMiddleware,
	HttpRouter,
	HttpServerError,
	HttpServerRequest,
	HttpServerResponse
} from 'effect/http'

import {Auth} from '@deslop/runtime/server/auth'
import {CLIENT_HEADER} from '@deslop/runtime/shared/auth'

import type {TelemetryError} from '#contracts'

import {LogsRequest, TracesRequest} from '#server/telemetry/schema.ts'
import type {Origin} from '#server/telemetry/schema.ts'
import {Telemetry} from '#server/telemetry/service.ts'

// OTLP's names for the records a partial success rejected.
const REJECTED = {'/v1/logs': 'rejectedLogRecords', '/v1/traces': 'rejectedSpans'} satisfies Record<IngestRoute, string>

// Any page, server or phone may export without signing in, as OTLP receivers take it.
const cors = HttpMiddleware.cors({allowedHeaders: ['content-type'], allowedMethods: ['POST']})

type IngestRoute = typeof IngestRoute.Type
const IngestRoute = Schema.Literals(['/v1/traces', '/v1/logs'])

// OTLP/HTTP JSON, uncompressed: protobuf and gzip are refused as unsupported, not read as broken JSON. The status codes and `code` values are the protocol's own.
function answer<A, I>(
	route: IngestRoute,
	schema: Schema.Codec<A, I>,
	save: (payload: A) => Effect.Effect<number, TelemetryError>
) {
	return Effect.flatMap(HttpServerRequest.HttpServerRequest, request => {
		if (
			!String.startsWith('application/json')(request.headers['content-type'] ?? '') ||
			(request.headers['content-encoding'] ?? 'identity') !== 'identity'
		) {
			return Effect.succeed(
				HttpServerResponse.jsonUnsafe({code: 3, message: 'Scope accepts uncompressed OTLP JSON only'}, {status: 415})
			)
		}
		return pipe(
			HttpServerRequest.schemaBodyJson(schema),
			Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(1)),
			Effect.flatMap(save),
			// Records under a name only GitHub's webhook writes are rejected, the rest of the export kept.
			Effect.map(rejected =>
				HttpServerResponse.jsonUnsafe(
					Boolean.match(rejected > 0, {
						onFalse: () => ({}),
						onTrue: () => ({
							partialSuccess: {
								errorMessage: 'GitHub repository names are written only by the GitHub webhook',
								[REJECTED[route]]: `${rejected}`
							}
						})
					})
				)
			),
			Effect.catchTags({
				HttpServerError: error =>
					Effect.succeed(
						HttpServerResponse.jsonUnsafe(
							{code: 3, message: 'Invalid or oversized OTLP body'},
							{
								status: Boolean.match(
									error.reason instanceof HttpServerError.RequestParseError && error.reason.reason === 'BodyTooLarge',
									{onFalse: Function.constant(400), onTrue: Function.constant(413)}
								)
							}
						)
					),
				SchemaError: () =>
					Effect.succeed(HttpServerResponse.jsonUnsafe({code: 3, message: 'Invalid OTLP JSON body'}, {status: 400})),
				TelemetryError: () =>
					Effect.succeed(
						HttpServerResponse.jsonUnsafe({code: 14, message: 'Telemetry storage unavailable'}, {status: 503})
					)
			})
		)
	})
}

// OTLP is intentionally public: absent or refused identity uses the anonymous budget; identity outages return 503.
export const TelemetryHttp = HttpRouter.use(router =>
	Effect.gen(function* () {
		const telemetry = yield* Telemetry
		const auth = yield* Auth
		// Each sender gets its own one-minute budget, so one flooding address never spends another's.
		const admissions = yield* Cache.make({
			capacity: 10_000,
			lookup: (_sender: string) => Ref.make(0),
			timeToLive: Duration.minutes(1)
		})
		// Rejected exports are counted; headers and bodies are never recorded.
		const ingest = Effect.fnUntraced(function* <A, I>(
			route: IngestRoute,
			schema: Schema.Codec<A, I>,
			save: (payload: A, origin: Origin) => Effect.Effect<number, TelemetryError>
		) {
			const request = yield* HttpServerRequest.HttpServerRequest
			function credential() {
				if (request.headers['authorization'] !== undefined) return 'authorization' as const
				if (request.headers['cookie'] !== undefined) return 'cookie' as const
				return 'none' as const
			}
			const person = yield* Effect.result(auth.user(request.headers))
			if (Result.isFailure(person) && person.failure.error === 'temporarily_unavailable') {
				yield* telemetry.reject({credential: credential(), route, status: 503})
				return HttpServerResponse.jsonUnsafe({code: 14, message: 'Identity service unavailable'}, {status: 503})
			}
			// Exports per sender and minute. A missing or refused identity is still an admitted public sender, budgeted by its address, which several apps on one machine share; a request without one comes from this machine.
			const [sender, budget] = Result.match(person, {
				onFailure: () => [`address:${request.headers[CLIENT_HEADER] ?? 'local'}`, 600] as const,
				onSuccess: user => [`user:${user.id}`, 1200] as const
			})
			const response = yield* Boolean.match(
				yield* Ref.modify(yield* Cache.get(admissions, sender), used => [used < budget, used + 1]),
				{
					onFalse: () =>
						Effect.succeed(
							HttpServerResponse.jsonUnsafe(
								{code: 8, message: 'OTLP admission budget exhausted'},
								{headers: {'retry-after': '60'}, status: 429}
							)
						),
					// A caller Auth names is identified; an anonymous export never replaces what an identified one stored.
					onTrue: () =>
						answer(route, schema, payload =>
							save(
								payload,
								Result.match(person, {
									onFailure: Function.constant('anonymous' as const),
									onSuccess: Function.constant('identified' as const)
								})
							)
						)
				}
			)
			if (response.status >= 400) {
				yield* telemetry.reject({credential: credential(), route, status: response.status})
			}
			return response
		})
		yield* router.add('POST', '/v1/traces', cors(ingest('/v1/traces', TracesRequest, telemetry.ingestTraces)))
		yield* router.add('POST', '/v1/logs', cors(ingest('/v1/logs', LogsRequest, telemetry.ingestLogs)))
		yield* router.add('OPTIONS', '/v1/*', cors(Effect.succeed(HttpServerResponse.empty())))
	})
)
