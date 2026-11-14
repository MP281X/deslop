import {
	Boolean,
	Context,
	DateTime,
	Duration,
	Effect,
	Function,
	Layer,
	MutableList,
	Option,
	Schema,
	Stream,
	pipe
} from 'effect'

import {Sse} from 'effect/encoding'
import {Reactivity} from 'effect/reactivity'
import {SqlClient, SqlSchema} from 'effect/sql'

import type {AiModelId} from '@deslop/runtime/shared/ai'
import {AuthError} from '@deslop/runtime/shared/auth'
import type {UserId} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {readUsage} from './lib/utils.ts'
import {AiUsage, AiUsageBreakdown, AiUsageQuery} from './schema.ts'
import type {AiUsageEntry, SpendSource} from './schema.ts'

import {usageWindow} from '#services/usage/lib/utils.ts'
import type {Period} from '#services/usage/schema.ts'

// AiProxy's 0001_ai migration (ai_migrations) created ai_usage; its registration stays there.

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly aiUsage: UserId
	}
}

export class AiMetering extends Context.Service<AiMetering>()(
	'@deslop/gateway/services/ai-metering/service/AiMetering',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const withReactivity = Effect.provideService(Reactivity.Reactivity, yield* Reactivity.Reactivity)
			const addUsage = SqlSchema.void({
				Request: AiUsage.insert,
				execute: row => sql`
				INSERT INTO ${sql(AiUsage.table)} ${sql.insert(row)}
				ON CONFLICT (owner, hour, spendSource) DO UPDATE SET
					costUsd = costUsd + excluded.costUsd,
					estimatedCalls = estimatedCalls + excluded.estimatedCalls,
					unknownCostCalls = unknownCostCalls + excluded.unknownCostCalls
			`
			})
			const deleteUsageBefore = SqlSchema.void({
				Request: Schema.Struct({hour: DateTimeUtcFromFiniteMillis, owner: AiUsage.fields.owner}),
				execute: request =>
					sql`DELETE FROM ${sql(AiUsage.table)} WHERE owner = ${request.owner} AND hour < ${request.hour}`
			})
			function within(query: typeof AiUsageQuery.Encoded) {
				return sql`owner = ${query.owner} AND hour >= ${query.from} AND hour < ${query.to}`
			}
			const totalUsage = SqlSchema.findAll({
				Request: AiUsageQuery,
				Result: AiUsageBreakdown,
				execute: query => sql`
				SELECT spendSource, total(costUsd) AS costUsd, total(unknownCostCalls) AS unknownCostCalls,
					total(estimatedCalls) AS estimatedCalls
				FROM ${sql(AiUsage.table)} WHERE ${within(query)} GROUP BY spendSource ORDER BY spendSource
			`
			})
			const listBuckets = SqlSchema.findAll({
				Request: AiUsageQuery,
				Result: Schema.Struct({at: DateTimeUtcFromFiniteMillis, ...AiUsageBreakdown.fields}),
				execute: query => sql`
				SELECT hour - hour % ${query.size} AS at, spendSource, total(costUsd) AS costUsd,
					sum(unknownCostCalls) AS unknownCostCalls, sum(estimatedCalls) AS estimatedCalls
				FROM ${sql(AiUsage.table)} WHERE ${within(query)} GROUP BY 1, spendSource ORDER BY 1, spendSource
			`
			})
			const saveUsage = Effect.fnUntraced(function* (id: UserId, entry: AiUsageEntry, spendSource: SpendSource) {
				yield* pipe(
					Effect.andThen(
						addUsage({
							costUsd: Option.getOrElse(entry.costUsd, Function.constant(0)),
							estimatedCalls: Boolean.match(entry.estimated, {
								onFalse: Function.constant(0),
								onTrue: Function.constant(1)
							}),
							hour: DateTime.startOf(entry.at, 'hour'),
							owner: id,
							spendSource,
							unknownCostCalls: Boolean.match(entry.costSource === 'unknown', {
								onFalse: Function.constant(0),
								onTrue: Function.constant(1)
							})
						}),
						deleteUsageBefore({hour: DateTime.subtractDuration(entry.at, Duration.days(30)), owner: id})
					),
					Reactivity.mutation({aiUsage: [id]}),
					sql.withTransaction,
					withReactivity
				)
			})
			return {
				record: Effect.fn('AiMetering.record')(
					function* (
						id: UserId,
						model: Option.Option<AiModelId>,
						at: DateTime.Utc,
						sse: boolean,
						body: ReadableStream<Uint8Array>
					) {
						const state: {current: AiUsageEntry; pending: string} = {
							current: {
								at,
								cacheReadTokens: 0,
								cacheWriteTokens: 0,
								costSource: 'unknown',
								costUsd: Option.none(),
								estimated: false,
								inputTokens: 0,
								model,
								outputTokens: 0,
								spendSource: Option.none()
							},
							pending: ''
						}
						const updateUsage = Effect.fnUntraced(function* (text: string) {
							state.current = yield* Effect.catch(Effect.fromResult(readUsage(text, state.current)), error =>
								Effect.as(
									Effect.logWarning('AI usage was malformed; keeping previously read usage', error),
									state.current
								)
							)
						})
						const stream = Stream.fromReadableStream({
							evaluate: () => body,
							onError: cause =>
								AuthError.make({cause, error: 'temporarily_unavailable', message: 'AI usage could not be read'})
						})
						if (sse) {
							const events = MutableList.make<string>()
							const parser = Sse.makeParser(event => {
								if (event._tag === 'Event') MutableList.append(events, event.data)
							})
							const feed = Effect.fnUntraced(function* (text: string) {
								const error = parser.feed(text)
								for (const eventText of MutableList.toArray(events)) yield* updateUsage(eventText)
								MutableList.clear(events)
								if (error !== undefined) return yield* error
							})
							yield* pipe(
								stream,
								Stream.decodeText,
								Stream.runForEach(feed),
								Effect.ignore({log: 'Warn', message: 'AI usage response could not be read'})
							)
							yield* Effect.ignore(feed('\n\n'), {log: 'Warn', message: 'AI usage response could not be read'})
						} else {
							const decoder = new TextDecoder()
							yield* pipe(
								stream,
								Stream.takeWhile(() => state.pending.length <= 10 * 1024 * 1024),
								Stream.runForEach(chunk =>
									Effect.sync(() => {
										state.pending += decoder.decode(chunk, {stream: true})
									})
								),
								Effect.ignore({log: 'Warn', message: 'AI usage response could not be read'})
							)
							yield* updateUsage(state.pending)
						}
						yield* Option.match(state.current.spendSource, {
							onNone: () => Effect.void,
							onSome: spendSource => saveUsage(id, state.current, spendSource)
						})
					},
					Effect.catch(error => Effect.logWarning('AI usage could not be saved', error))
				),
				usage: (id: UserId, period: Period) =>
					Stream.withSpan(
						usageWindow(period, range =>
							Stream.mapError(
								sql.reactive(
									{aiUsage: [id]},
									Effect.all(
										{series: listBuckets({...range, owner: id}), totals: totalUsage({...range, owner: id})},
										{concurrency: 1}
									)
								),
								cause => AuthError.make({cause, error: 'temporarily_unavailable', message: 'AI usage storage failed'})
							)
						),
						'AiMetering.usage',
						{attributes: {period, 'rpc.stream': true, userId: id}}
					)
			}
		})
	}
) {
	static readonly layer = Layer.effect(AiMetering, AiMetering.make)
}
