import {Config, Effect, Layer, Option, Redacted, Schema, SchemaGetter, String, pipe} from 'effect'

import {Mac} from 'effect/crypto'
import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {WorkflowJob, WorkflowRun} from './contract.ts'
import {GitHubActions, GitHubLogs} from './server.ts'

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

export const githubActionsHttp = Layer.provide(
	HttpRouter.use(router =>
		Effect.gen(function* () {
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
								SchemaError: () => Effect.succeed(HttpServerResponse.text('Invalid GitHub event body', {status: 400})),
								TelemetryError: () => Effect.succeed(HttpServerResponse.empty({status: 503}))
							}
						)
					)
				})
			})
		})
	),
	Layer.provide(GitHubActions.layer, GitHubLogs.layer)
)
