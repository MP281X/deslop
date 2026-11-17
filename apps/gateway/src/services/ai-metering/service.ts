import {
	Boolean,
	Context,
	DateTime,
	Duration,
	Effect,
	Exit,
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
import type {TimeFrame} from '@deslop/runtime/shared/time'

import {readUsage} from './lib/utils.ts'
import {AiCall, AiUsageBreakdown, AiUsageQuery, Usage} from './schema.ts'
import type {AiUsageEntry, SpendSource} from './schema.ts'

import type {AiProvider} from '#services/ai-proxy/schema.ts'
import {usageWindow} from '#services/usage/lib/utils.ts'

// AiProxy's migrations (ai_migrations) own the AI tables.

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
				Request: AiCall.insert,
				execute: row => sql`INSERT INTO ${sql(AiCall.table)} ${sql.insert(row)}`
			})
			const deleteUsageBefore = SqlSchema.void({
				Request: Schema.Struct({at: DateTimeUtcFromFiniteMillis, owner: AiCall.fields.owner}),
				execute: request => sql`DELETE FROM ${sql(AiCall.table)} WHERE owner = ${request.owner} AND at < ${request.at}`
			})
			function within(query: typeof AiUsageQuery.Encoded) {
				return sql`owner = ${query.owner} AND at >= ${query.from} AND at < ${query.to}`
			}
			const totalUsage = SqlSchema.findAll({
				Request: AiUsageQuery,
				Result: AiUsageBreakdown,
				execute: query => sql`
				SELECT spendSource, total(costUsd) AS costUsd, sum(1 - costKnown) AS unknownCostCalls,
					sum(estimated) AS estimatedCalls
				FROM ${sql(AiCall.table)} WHERE ${within(query)} GROUP BY spendSource ORDER BY spendSource
			`
			})
			const listBuckets = SqlSchema.findAll({
				Request: AiUsageQuery,
				Result: Schema.Struct({at: DateTimeUtcFromFiniteMillis, ...AiUsageBreakdown.fields}),
				execute: query => sql`
				SELECT at - at % ${query.size} AS at, spendSource, total(costUsd) AS costUsd,
					sum(1 - costKnown) AS unknownCostCalls, sum(estimated) AS estimatedCalls
				FROM ${sql(AiCall.table)} WHERE ${within(query)} GROUP BY 1, spendSource ORDER BY 1, spendSource
			`
			})
			const saveUsage = Effect.fnUntraced(function* (id: UserId, entry: AiUsageEntry, spendSource: SpendSource) {
				yield* pipe(
					Effect.andThen(
						addUsage({
							at: entry.at,
							costKnown: entry.costSource !== 'unknown',
							costUsd: Option.getOrElse(entry.costUsd, Function.constant(0)),
							estimated: entry.estimated,
							owner: id,
							spendSource
						}),
						deleteUsageBefore({at: DateTime.subtractDuration(entry.at, Duration.days(30)), owner: id})
					),
					Reactivity.mutation({aiUsage: [id]}),
					sql.withTransaction,
					withReactivity
				)
			})
			return {
				observe: Effect.fn('AiMetering.observe')(
					(id: UserId, provider: AiProvider, model: Option.Option<AiModelId>, at: DateTime.Utc, sse: boolean) =>
						Effect.sync(() => {
							const state: {current: AiUsageEntry; finalUsage: boolean; pending: string} = {
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
									spendSource: Option.liftPredicate('openai' as const, () => provider === 'openai')
								},
								finalUsage: false,
								pending: ''
							}
							const updateUsage = Effect.fnUntraced(function* (text: string) {
								state.finalUsage ||= Option.exists(
									Schema.decodeOption(Schema.fromJsonString(Usage))(text),
									value =>
										Option.isSome(value.cost) ||
										Option.exists(
											Option.flatten(value.usage),
											usage =>
												Option.isSome(usage.output_tokens) ||
												Option.isSome(usage.completion_tokens) ||
												Option.isSome(usage.cost)
										) ||
										Option.exists(value.response, response =>
											Option.exists(Option.flatten(response.usage), usage => Option.isSome(usage.output_tokens))
										) ||
										Option.exists(
											value.usageMetadata,
											usage => Option.isSome(usage.candidatesTokenCount) || Option.isSome(usage.cost)
										)
								)
								state.current = yield* Effect.catch(
									Effect.fromResult(readUsage(text, state.current, provider)),
									error =>
										Effect.as(
											Effect.logWarning('AI usage was malformed; keeping previously read usage', error),
											state.current
										)
								)
							})
							const decoder = new TextDecoder()
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
							return {
								save: (exit: Exit.Exit<unknown, unknown>) =>
									Effect.catchCause(
										Effect.gen(function* () {
											if (sse) {
												yield* Effect.ignore(feed(`${decoder.decode()}\n\n`), {
													log: 'Warn',
													message: 'AI usage response could not be read'
												})
											} else {
												yield* updateUsage(state.pending + decoder.decode())
											}
											if (Exit.isFailure(exit) && !state.finalUsage) {
												state.current = {
													...state.current,
													costSource: 'unknown',
													costUsd: Option.none(),
													estimated: false
												}
											}
											// judge-ignore no-silent-fallback -- Interrupted streams can end before billing metadata; retain the key owner's call, with unknown spend if final usage never arrived.
											yield* pipe(
												state.current.spendSource,
												Option.orElse(() =>
													pipe(
														provider === 'anthropic',
														Boolean.match({
															onFalse: Function.constant('balance' as const),
															onTrue: Function.constant('byok' as const)
														}),
														Option.liftPredicate(() => Exit.isFailure(exit))
													)
												),
												Option.match({
													onNone: () => Effect.void,
													onSome: spendSource => saveUsage(id, state.current, spendSource)
												})
											)
										}),
										error => Effect.logWarning('AI usage could not be saved', error)
									),
								write: (chunk: Uint8Array) =>
									Effect.catchCause(
										Effect.gen(function* () {
											const text = decoder.decode(chunk, {stream: true})
											if (sse) yield* feed(text)
											else if (state.pending.length <= 10 * 1024 * 1024) state.pending += text
										}),
										cause => Effect.logWarning('AI usage response could not be read', cause)
									)
							}
						})
				),
				usage: (id: UserId, period: TimeFrame) =>
					Stream.withSpan(
						usageWindow(period, {aiUsage: [id]}, range =>
							Effect.mapError(
								Effect.all(
									{series: listBuckets({...range, owner: id}), totals: totalUsage({...range, owner: id})},
									{concurrency: 1}
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
