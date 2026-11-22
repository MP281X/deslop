import {Config, Context, Effect, Layer, Option, Redacted, Stream, pipe} from 'effect'

import {HttpClient, HttpClientRequest} from 'effect/http'
import type {HttpClientError} from 'effect/http'

import type {WorkflowJob} from '#services/github-actions/schema.ts'

// One job's log text, read as it arrives.
export type LogReader = (event: WorkflowJob) => Stream.Stream<string, HttpClientError.HttpClientError>

// A job's log from GitHub as its text arrives; none without a GITHUB_TOKEN, and then no log is asked for.
export class GitHubLogs extends Context.Service<GitHubLogs, {readonly read: Option.Option<LogReader>}>()(
	'@deslop/scope/services/github-logs/service/GitHubLogs'
) {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
			return GitHubLogs.of({
				read: Option.map(
					yield* Config.option(Config.Redacted('GITHUB_TOKEN')),
					credential => (event: WorkflowJob) =>
						pipe(
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
							Effect.map(response => Stream.decodeText(response.stream)),
							Stream.unwrap
						)
				)
			})
		})
	)
}
