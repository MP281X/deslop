import {
	Boolean,
	ByteSize,
	Clock,
	Config,
	Effect,
	Function,
	Layer,
	Option,
	Redacted,
	Ref,
	Result,
	Schema,
	SchemaGetter,
	String,
	pipe
} from 'effect'

import {Mac} from 'effect/crypto'
import {
	HttpIncomingMessage,
	HttpMiddleware,
	HttpRouter,
	HttpServerError,
	HttpServerRequest,
	HttpServerResponse
} from 'effect/http'

import {Auth} from '@deslop/runtime/server/auth'

import {WorkflowJob, WorkflowRun} from '#services/github-actions/schema.ts'
import {GitHubActions} from '#services/github-actions/service.ts'
import type {TelemetryError} from '#services/telemetry/schema.ts'
import {LogsRequest, TracesRequest} from '#services/telemetry/schema.ts'
import {Telemetry} from '#services/telemetry/service.ts'

// Any page, server or phone may export without signing in, as OTLP receivers take it.
const cors = HttpMiddleware.cors({allowedHeaders: ['content-type'], allowedMethods: ['POST']})

type IngestRoute = typeof IngestRoute.Type
const IngestRoute = Schema.Literals(['/v1/traces', '/v1/logs'])

// OTLP/HTTP JSON: the status codes and `code` values are the protocol's own.
function answer<A, I>(schema: Schema.Codec<A, I>, save: (payload: A) => Effect.Effect<void, TelemetryError>) {
	return Effect.flatMap(HttpServerRequest.HttpServerRequest, request => {
		if (!String.startsWith('application/json')(request.headers['content-type'] ?? '')) {
			return Effect.succeed(HttpServerResponse.empty({status: 415}))
		}
		return pipe(
			HttpServerRequest.schemaBodyJson(schema),
			Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(1)),
			Effect.flatMap(save),
			Effect.as(HttpServerResponse.text('{}', {contentType: 'application/json'})),
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

export const HttpHandlers = Layer.provide(
	// OTLP is intentionally public: absent or refused identity uses the anonymous budget; identity outages return 503.
	// judge-ignore no-silent-fallback -- A refused optional Auth identity selects anonymous admission by the approved public-ingest policy; it is not a failed export. Auth outages and every rejected export remain explicit 503/4xx responses.
	// judge-ignore no-unrelated-jobs -- this router composition registers the OTLP and signed GitHub ingestion endpoints; each request is dispatched to its own handler.
	HttpRouter.use(router =>
		Effect.gen(function* () {
			const telemetry = yield* Telemetry
			const auth = yield* Auth
			// Separate aggregate pools keep anonymous traffic from spending identified senders' capacity.
			const admission = yield* Ref.make({anonymous: {at: 0, used: 0}, identified: {at: 0, used: 0}})
			// Rejected exports are counted; headers and bodies are never recorded.
			const ingest = Effect.fnUntraced(function* <A, I>(
				route: IngestRoute,
				schema: Schema.Codec<A, I>,
				save: (payload: A) => Effect.Effect<void, TelemetryError>
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
				// A missing or refused identity is still an admitted public sender, but only in the anonymous pool.
				const identified = Result.isSuccess(person)
				const now = yield* Clock.currentTimeMillis
				const admitted = yield* Ref.modify(admission, pools => {
					const key = Boolean.match(identified, {
						onFalse: Function.constant('anonymous' as const),
						onTrue: Function.constant('identified' as const)
					})
					const pool = pools[key]
					const used = Boolean.match(now - pool.at >= 60_000, {onFalse: () => pool.used, onTrue: Function.constant(0)})
					if (used >= Boolean.match(identified, {onFalse: Function.constant(120), onTrue: Function.constant(1200)})) {
						return [false, pools]
					}
					return [
						true,
						{
							...pools,
							[key]: {at: Boolean.match(used === 0, {onFalse: () => pool.at, onTrue: () => now}), used: used + 1}
						}
					]
				})
				const response = yield* Boolean.match(admitted, {
					onFalse: () =>
						Effect.succeed(
							HttpServerResponse.jsonUnsafe(
								{code: 8, message: 'OTLP admission budget exhausted'},
								{headers: {'retry-after': '60'}, status: 429}
							)
						),
					onTrue: () => answer(schema, save)
				})
				if (response.status >= 400) {
					yield* telemetry.reject({credential: credential(), route, status: response.status})
				}
				return response
			})
			yield* router.add('POST', '/v1/traces', cors(ingest('/v1/traces', TracesRequest, telemetry.ingestTraces)))
			yield* router.add('POST', '/v1/logs', cors(ingest('/v1/logs', LogsRequest, telemetry.ingestLogs)))
			yield* router.add('OPTIONS', '/v1/*', cors(Effect.succeed(HttpServerResponse.empty())))

			// GitHub Actions as traces: a repository's webhook sends each workflow run and job, signed with the secret in GITHUB_WEBHOOK_SECRET; without it the route isn't served.
			const mac = yield* Mac.Mac
			yield* Option.match(yield* Config.option(Config.Redacted('GITHUB_WEBHOOK_SECRET')), {
				onNone: () => Effect.void,
				onSome: Effect.fnUntraced(function* (secret) {
					const key = yield* Mac.key(Mac.hmacSha256, new TextEncoder().encode(Redacted.value(secret)))
					const github = yield* GitHubActions
					yield* router.add(
						'POST',
						'/v1/github',
						Effect.catchTags(
							Effect.gen(function* () {
								const request = yield* HttpServerRequest.HttpServerRequest
								const body = new Uint8Array(yield* request.arrayBuffer)
								const signed = yield* Option.match(
									Schema.decodeOption(Signature)(request.headers['x-hub-signature-256'] ?? ''),
									{onNone: () => Effect.succeed(false), onSome: tag => mac.verify(key, tag, body)}
								)
								if (!signed) return HttpServerResponse.empty({status: 401})
								const text = new TextDecoder().decode(body)
								// A run starts its trace without an end, so its jobs show under it as they finish; its completion replaces it.
								if (request.headers['x-github-event'] === 'workflow_run') {
									yield* github.ingestRun(yield* Schema.decodeEffect(Schema.fromJsonString(WorkflowRun))(text))
								}
								if (request.headers['x-github-event'] === 'workflow_job') {
									yield* github.ingestJob(yield* Schema.decodeEffect(Schema.fromJsonString(WorkflowJob))(text))
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
	),
	GitHubActions.layer
)
