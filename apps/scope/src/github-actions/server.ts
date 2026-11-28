import type {Cause} from 'effect'
import {
	Array,
	Boolean,
	Config,
	Context,
	DateTime,
	Duration,
	Effect,
	Function,
	Layer,
	Number,
	Option,
	Redacted,
	Result,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {HttpClient, HttpClientError, HttpClientRequest} from 'effect/http'
import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {LogFetch, WorkflowJob, WorkflowJobId} from './contract.ts'
import type {WorkflowRun} from './contract.ts'
import {migrations} from './migrations.ts'
import {jobLogs, jobRecords, jobTrace, logLines, runTrace} from './records.ts'

import {Ingestion} from '#ingestion/server.ts'
import {TelemetryError} from '#telemetry/contract.ts'

// Jobs claimed per pass; a full claim makes another pass.
const CLAIMED = 16

// One job's log text, read as it arrives.
type LogReader = (event: WorkflowJob) => Stream.Stream<string, HttpClientError.HttpClientError>

// A job's log from GitHub as its text arrives; none without a GITHUB_TOKEN, and then no log is asked for.
export class GitHubLogs extends Context.Service<GitHubLogs, {readonly read: Option.Option<LogReader>}>()(
	'@deslop/scope/github-actions/server/GitHubLogs'
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

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		// A job's log was asked for, so the worker claims it.
		readonly ci_log_fetches: never
	}
}

// How long GitHub asked to wait, when it said so in whole seconds, at most an hour; a date or any other form is ignored.
function retryAfter(error: HttpClientError.HttpClientError | Cause.TimeoutError | TelemetryError) {
	if (!HttpClientError.isHttpClientError(error) || !(error.reason instanceof HttpClientError.StatusCodeError)) {
		return Duration.zero
	}
	return pipe(
		error.reason.response.headers['retry-after'],
		Option.fromUndefinedOr,
		Option.map(String.trim),
		Option.filter(value => Option.isSome(String.match(/^\d+$/u)(value))),
		Option.flatMap(Number.parse),
		Option.match({
			onNone: () => Duration.zero,
			onSome: seconds => Duration.min(Duration.seconds(seconds), Duration.hours(1))
		})
	)
}

// A failure worth another attempt: GitHub or the network faltered, or the storage was busy; any other refusal stays refused.
function transient(error: HttpClientError.HttpClientError | Cause.TimeoutError | TelemetryError) {
	if (!HttpClientError.isHttpClientError(error)) return true
	if (error.reason instanceof HttpClientError.StatusCodeError) {
		return Array.contains([408, 429], error.reason.response.status) || error.reason.response.status >= 500
	}
	return true
}

export class GitHubActions extends Context.Service<GitHubActions>()(
	'@deslop/scope/github-actions/server/GitHubActions',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const ingestion = yield* Ingestion
			const withReactivity = Effect.provideService(Reactivity.Reactivity, yield* Reactivity.Reactivity)
			const logs = yield* GitHubLogs

			// Asked once per job: a redelivered event finds its row and asks nothing more.
			const requestFetch = SqlSchema.void({
				Request: Schema.Struct({
					event: Schema.fromJsonString(WorkflowJob),
					job: WorkflowJobId,
					requestedAt: Schema.DateTimeUtcFromMillis
				}),
				execute: row => sql`
					INSERT INTO ${sql(LogFetch.table)} (job, event, attempts, dueAt, requestedAt)
					VALUES (${row.job}, ${row.event}, 0, ${row.requestedAt}, ${row.requestedAt})
					ON CONFLICT (job) DO NOTHING
				`
			})
			const listDue = SqlSchema.findAll({
				Request: Schema.DateTimeUtcFromMillis,
				Result: LogFetch,
				execute: now => sql`
					SELECT * FROM ${sql(LogFetch.table)}
					WHERE finishedAt IS NULL AND dueAt <= ${now}
					ORDER BY dueAt, job LIMIT ${CLAIMED}
				`
			})
			const settle = SqlSchema.void({
				Request: Schema.Struct({
					dueAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromMillis),
					job: WorkflowJobId,
					now: Schema.DateTimeUtcFromMillis
				}),
				execute: row => sql`
					UPDATE ${sql(LogFetch.table)} SET
						attempts = attempts + 1,
						dueAt = coalesce(${row.dueAt}, dueAt),
						finishedAt = iif(${row.dueAt} IS NULL, ${row.now}, NULL)
					WHERE job = ${row.job}
				`
			})
			// A finished job is remembered as long as its trace is kept.
			const forget = SqlSchema.void({
				Request: Schema.DateTimeUtcFromMillis,
				execute: before => sql`DELETE FROM ${sql(LogFetch.table)} WHERE finishedAt < ${before}`
			})

			// The log streams through: lines are parsed as they arrive and kept records are stored a batch at a time.
			const fetchLog = Effect.fn('GitHubActions.fetchLog')(
				function* (event: WorkflowJob, read: LogReader) {
					yield* Effect.annotateCurrentSpan('github.job', event.workflow_job.id)
					yield* pipe(
						jobRecords(event, logLines(read(event))),
						// Each fetch holds one line and one batch of records, never a whole log.
						Stream.grouped(500),
						// A batch's number keeps equal lines of different batches apart, and a fetch replayed over an unchanged log (GitHub is asked only after the job completed) writes the same ids, so nothing is stored twice; a log that changed between attempts can leave duplicates.
						Stream.zipWithIndex,
						Stream.runForEach(batch => ingestion.ingestLogs(jobLogs(event, batch[0], batch[1]), 'github'))
					)
				},
				Effect.timeout(Duration.minutes(5))
			)
			// One attempt, then the row is finished, or due again after a wait that doubles with each failure.
			const attempt = Effect.fnUntraced(function* (fetch: LogFetch, read: LogReader) {
				const result = yield* Effect.result(fetchLog(fetch.event, read))
				const now = yield* DateTime.now
				// Six attempts, the waits between them doubling from a minute or as long as GitHub asked, before a log that keeps failing is given up on.
				const retry = Result.isFailure(result) && transient(result.failure) && fetch.attempts < 5
				const wait = Duration.max(
					Duration.minutes(2 ** fetch.attempts),
					Result.match(result, {onFailure: retryAfter, onSuccess: Function.constant(Duration.zero)})
				)
				if (Result.isFailure(result)) {
					yield* Effect.annotateLogs(Effect.logWarning('GitHub job logs could not be ingested', result.failure), {
						'github.job': fetch.job,
						retry
					})
				}
				yield* settle({
					dueAt: Boolean.match(retry, {
						onFalse: Option.none,
						onTrue: () => Option.some(DateTime.addDuration(now, wait))
					}),
					job: fetch.job,
					now
				})
			})
			// Claims what is due until a pass finds less than a full claim; a fetch that outlives the process stays pending and is claimed again at the next start.
			const drain = Effect.fnUntraced(function* (read: LogReader) {
				const now = yield* DateTime.now
				yield* forget(DateTime.subtractDuration(now, Duration.days(30)))
				const due = yield* listDue(now)
				yield* Effect.forEach(due, fetch => attempt(fetch, read), {concurrency: 2, discard: true})
				return due.length
			})

			// Claimed at start, after each request and each minute for retries that fell due; signals that arrive during a pass make one more pass.
			yield* Option.match(logs.read, {
				onNone: () => Effect.void,
				onSome: Effect.fnUntraced(function* (read) {
					yield* pipe(
						Stream.merge(sql.reactive(['ci_log_fetches'], Effect.void), Stream.tick(Duration.minutes(1))),
						Stream.buffer({capacity: 1, strategy: 'sliding'}),
						Stream.runForEach(() =>
							pipe(
								drain(read),
								Effect.repeat({while: claimed => claimed === CLAIMED}),
								Effect.ignore({log: 'Error', message: 'Pending GitHub job logs could not be read'})
							)
						),
						Effect.forkScoped
					)
				})
			})

			return {
				ingestJob: Effect.fn('GitHubActions.ingestJob')(function* (event: WorkflowJob) {
					if (event.action !== 'completed' || Option.contains(event.workflow_job.conclusion, 'skipped')) return
					const requestedAt = yield* DateTime.now
					// The job's spans and the request for its log commit together, so an acknowledged delivery never loses its log.
					yield* pipe(
						ingestion.ingestTraces(jobTrace(event), 'github'),
						Effect.andThen(
							Option.match(logs.read, {
								onNone: () => Effect.void,
								onSome: () => requestFetch({event, job: event.workflow_job.id, requestedAt})
							})
						),
						sql.withTransaction,
						Reactivity.mutation(['ci_log_fetches']),
						Effect.catchTags({
							SchemaError: cause => TelemetryError.make({cause, message: 'The GitHub job could not be stored'}),
							SqlError: cause => TelemetryError.make({cause, message: 'The GitHub job could not be stored'})
						}),
						withReactivity
					)
				}),
				ingestRun: Effect.fn('GitHubActions.ingestRun')(function* (event: WorkflowRun) {
					if (event.action === 'completed' || event.action === 'in_progress') {
						yield* ingestion.ingestTraces(runTrace(event), 'github')
					}
				})
			}
		})
	}
) {
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({loader: Migrator.fromRecord(migrations), table: 'github_actions_migrations'})
	)

	static readonly layer = Layer.provide(Layer.effect(this, this.make), this.migrations)
}
