import {Array, Config, Context, Duration, Effect, Layer, Option, Redacted, Stream, pipe} from 'effect'

import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'

import {jobLogs, jobTrace, runIds, runTrace} from './lib/utils.ts'
import type {WorkflowJob, WorkflowRun} from './schema.ts'

import {Telemetry} from '#services/telemetry/service.ts'

export class GitHub extends Context.Service<GitHub>()('@deslop/scope/services/github/service/GitHub', {
	make: Effect.gen(function* () {
		const telemetry = yield* Telemetry
		const token = yield* Config.option(Config.Redacted('GITHUB_TOKEN'))
		const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
		const ingestJobLogs = Effect.fn('GitHub.ingestJobLogs')(function* (
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
				Effect.timeout(Duration.seconds(8))
			)
			yield* telemetry.ingestLogs(jobLogs(event, log))
		})
		return {
			ingestJob: Effect.fn('GitHub.ingestJob')(function* (event: WorkflowJob) {
				if (event.action !== 'completed' || Option.contains(event.workflow_job.conclusion, 'skipped')) return
				yield* telemetry.ingestTraces(jobTrace(event))
				yield* Option.match(token, {
					onNone: () => Effect.void,
					onSome: credential =>
						Effect.ignore(ingestJobLogs(event, credential), {log: 'Warn', message: 'A GitHub job log did not arrive'})
				})
			}),
			ingestRun: Effect.fn('GitHub.ingestRun')(function* (event: WorkflowRun) {
				const ids = runIds(event)
				// GitHub can redeliver a start after the run finished.
				const finished = yield* Effect.map(
					Effect.option(telemetry.trace(ids.traceId)),
					Option.exists(trace =>
						Array.some(trace.spans, span => span.spanId === ids.spanId && Option.isSome(span.duration))
					)
				)
				if (event.action === 'completed' || (event.action === 'in_progress' && !finished)) {
					yield* telemetry.ingestTraces(runTrace(event))
				}
			})
		}
	})
}) {
	static readonly layer = Layer.effect(this, this.make)
}
