import type {Cause} from 'effect'
import {Array, Boolean, Context, DateTime, Duration, Effect, Layer, Option, Result, Schema, Stream, pipe} from 'effect'

import {HttpClientError} from 'effect/http'
import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {jobLogs, jobRecords, jobTrace, logLines, runTrace} from './lib/utils.ts'
import {migrations} from './migrations.ts'
import {LogFetch, WorkflowJob, WorkflowJobId} from './schema.ts'
import type {WorkflowRun} from './schema.ts'

import {GitHubLogs} from '#services/github-logs/service.ts'
import type {LogReader} from '#services/github-logs/service.ts'
import {TelemetryError} from '#services/telemetry/schema.ts'
import {Telemetry} from '#services/telemetry/service.ts'

// Jobs claimed per pass; a full claim makes another pass.
const CLAIMED = 16

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		// A job's log was asked for, so the worker claims it.
		readonly ci_log_fetches: never
	}
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
	'@deslop/scope/services/github-actions/service/GitHubActions',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const telemetry = yield* Telemetry
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
						Stream.runForEach(records => telemetry.ingestLogs(jobLogs(event, records), 'github'))
					)
				},
				Effect.timeout(Duration.minutes(5))
			)
			// One attempt, then the row is finished, or due again after a wait that doubles with each failure.
			const attempt = Effect.fnUntraced(function* (fetch: LogFetch, read: LogReader) {
				const result = yield* Effect.result(fetchLog(fetch.event, read))
				const now = yield* DateTime.now
				// Six attempts, the waits between them doubling from a minute, before a log that keeps failing is given up on.
				const retry = Result.isFailure(result) && transient(result.failure) && fetch.attempts < 5
				if (Result.isFailure(result)) {
					yield* Effect.annotateLogs(Effect.logWarning('GitHub job logs could not be ingested', result.failure), {
						'github.job': fetch.job,
						retry
					})
				}
				yield* settle({
					dueAt: Boolean.match(retry, {
						onFalse: Option.none,
						onTrue: () => Option.some(DateTime.addDuration(now, Duration.minutes(2 ** fetch.attempts)))
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
						telemetry.ingestTraces(jobTrace(event), 'github'),
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
						yield* telemetry.ingestTraces(runTrace(event), 'github')
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
