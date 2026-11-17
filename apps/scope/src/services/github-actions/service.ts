import {Cause, Config, Context, Duration, Effect, Layer, Option, Redacted, Schedule, Stream, pipe} from 'effect'

import {HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse} from 'effect/http'

import {jobLogs, jobTrace, runTrace} from './lib/utils.ts'
import type {WorkflowJob, WorkflowRun} from './schema.ts'

import {TelemetryError} from '#services/telemetry/schema.ts'
import {Telemetry} from '#services/telemetry/service.ts'

export class GitHubActions extends Context.Service<GitHubActions>()(
	'@deslop/scope/services/github-actions/service/GitHubActions',
	{
		make: Effect.gen(function* () {
			const scope = yield* Effect.scope
			const telemetry = yield* Telemetry
			const token = yield* Config.option(Config.Redacted('GITHUB_TOKEN'))
			const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
			const ingestJobLogs = Effect.fn('GitHubActions.ingestJobLogs')(function* (
				event: WorkflowJob,
				credential: Redacted.Redacted
			) {
				const log = yield* pipe(
					client.execute(
						HttpClientRequest.get(
							`https://api.github.com/repos/${event.repository.full_name}/actions/jobs/${event.workflow_job.id}/logs`,
							{
								headers: {
									accept: 'application/vnd.github+json',
									authorization: `Bearer ${Redacted.value(credential)}`,
									'user-agent': '@deslop/scope'
								}
							}
						)
					),
					HttpClientResponse.stream,
					Stream.decodeText,
					Stream.mkString,
					Effect.timeout(Duration.seconds(8)),
					Effect.retry({
						schedule: Schedule.spaced(Duration.seconds(1)),
						times: 3,
						while: error =>
							Cause.isTimeoutError(error) ||
							(HttpClientError.isHttpClientError(error) &&
								(error.reason instanceof HttpClientError.TransportError ||
									(error.reason instanceof HttpClientError.StatusCodeError && error.reason.response.status >= 500)))
					}),
					Effect.mapError(cause =>
						TelemetryError.make({cause, message: 'GitHub job logs could not be fetched after retries'})
					)
				)
				yield* telemetry.ingestLogs(jobLogs(event, log))
			})
			return {
				ingestJob: Effect.fn('GitHubActions.ingestJob')(function* (event: WorkflowJob) {
					if (event.action !== 'completed' || Option.contains(event.workflow_job.conclusion, 'skipped')) return
					yield* telemetry.ingestTraces(jobTrace(event))
					yield* Option.match(token, {
						onNone: () => Effect.void,
						onSome: Effect.fnUntraced(function* (credential) {
							yield* pipe(
								ingestJobLogs(event, credential),
								Effect.ignore({log: 'Warn', message: 'GitHub job logs could not be ingested'}),
								Effect.forkIn(scope)
							)
						})
					})
				}),
				ingestRun: Effect.fn('GitHubActions.ingestRun')(function* (event: WorkflowRun) {
					if (event.action === 'completed' || event.action === 'in_progress') {
						yield* telemetry.ingestTraces(runTrace(event))
					}
				})
			}
		})
	}
) {
	static readonly layer = Layer.effect(this, this.make)
}
