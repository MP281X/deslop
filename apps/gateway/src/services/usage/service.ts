import {Context, DateTime, Duration, Effect, Layer, Option, Schedule, Schema, Stream, pipe} from 'effect'

import {SqlClient, SqlSchema} from 'effect/sql'

import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {AiCall} from '#services/ai-metering/schema.ts'
import {AiProxy} from '#services/ai-proxy/service.ts'
import {McpCall} from '#services/connections/schema.ts'
import {Connections} from '#services/connections/service.ts'

// One delete statement removes at most this many rows, so a long sweep never holds the database for long.
const SWEEP_BATCH = 5000

// Usage is kept thirty days, the longest report: the sweep removes every older call of both tables, whoever made it.
export class Usage extends Context.Service<Usage>()('@deslop/gateway/services/usage/service/Usage', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		// A scan of the table: the owner and server indexes lead with their column, and an hourly pass over thirty days of calls is cheap.
		function deleteBefore(table: string) {
			return SqlSchema.findAll({
				Request: DateTimeUtcFromFiniteMillis,
				Result: Schema.Struct({at: Schema.Finite}),
				execute: before => sql`
					DELETE FROM ${sql(table)} WHERE rowid IN (
						SELECT rowid FROM ${sql(table)} WHERE at < ${before} LIMIT ${SWEEP_BATCH}
					) RETURNING at
				`
			})
		}
		const deleteAiCalls = deleteBefore(AiCall.table)
		const deleteMcpCalls = deleteBefore(McpCall.table)
		// Batch after batch until one comes back short; the count is every row removed.
		function expire(deleteOld: typeof deleteAiCalls, before: DateTime.Utc) {
			return Stream.runCount(
				Stream.paginate(undefined, () =>
					Effect.map(
						deleteOld(before),
						rows => [rows, Option.filter(Option.some(undefined), () => rows.length === SWEEP_BATCH)] as const
					)
				)
			)
		}
		const sweep = pipe(
			DateTime.now,
			Effect.map(now => DateTime.subtractDuration(now, Duration.days(30))),
			Effect.flatMap(before =>
				Effect.all({aiCalls: expire(deleteAiCalls, before), mcpCalls: expire(deleteMcpCalls, before)}, {concurrency: 1})
			),
			Effect.tap(deleted =>
				Effect.logInfo(`Deleted usage older than 30 days: ${deleted.aiCalls} AI calls, ${deleted.mcpCalls} MCP calls`)
			),
			Effect.withSpan('Usage.sweep')
		)
		// At start, then hourly, so an owner or server that stopped calling is cleaned too; a failed sweep is tried again next hour.
		yield* pipe(
			sweep,
			Effect.catchCause(cause => Effect.logWarning('Old usage could not be deleted', cause)),
			Effect.repeat(Schedule.spaced('1 hour')),
			Effect.forkScoped
		)
		return {sweep}
	})
}) {
	// The tables are made by the services that own them.
	static readonly layer = Layer.provide(
		Layer.effect(Usage, Usage.make),
		Layer.mergeAll(AiProxy.migrations, Connections.migrations)
	)
}
