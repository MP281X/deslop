import {
	Boolean,
	Context,
	DateTime,
	Duration,
	Effect,
	Exit,
	Layer,
	MutableList,
	Option,
	Record,
	Ref,
	Schema,
	Stream,
	pipe
} from 'effect'

import {Sse} from 'effect/encoding'
import {HttpClient, HttpClientResponse} from 'effect/http'
import {Reactivity} from 'effect/reactivity'
import {SqlClient, SqlSchema} from 'effect/sql'

import type {AiModelId, AiProvider} from '@deslop/runtime/shared/ai'
import {AuthError} from '@deslop/runtime/shared/auth'
import type {UserId} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {readUsage} from './lib/utils.ts'
import {AiUsage, AiUsageBreakdown, AiUsageQuery, ModelsCatalog} from './schema.ts'
import type {AiUsageEntry} from './schema.ts'

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
			const client = yield* HttpClient.HttpClient
			const pricing = yield* Ref.make<ModelsCatalog>({})
			const refreshPricing = yield* pipe(
				client.get('https://models.dev/api.json'),
				Effect.flatMap(HttpClientResponse.schemaBodyJson(ModelsCatalog)),
				Effect.timeout(Duration.seconds(10)),
				Effect.tap(catalog => Ref.set(pricing, catalog)),
				Effect.tapError(error =>
					Effect.logWarning('The pricing catalog could not be refreshed; keeping cached pricing', error)
				),
				Effect.option,
				Effect.cachedWithTTL(exit => {
					if (Exit.isSuccess(exit) && Option.isSome(exit.value)) return Duration.days(1)
					return Duration.zero
				})
			)
			const addUsage = SqlSchema.void({
				Request: AiUsage.insert,
				execute: row => sql`
				INSERT INTO ${sql(AiUsage.table)} ${sql.insert(row)}
				ON CONFLICT (owner, hour, provider) DO UPDATE SET
					costUsd = costUsd + excluded.costUsd,
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
			const listTotals = SqlSchema.findAll({
				Request: AiUsageQuery,
				Result: AiUsageBreakdown,
				execute: query => sql`
				SELECT provider AS name, total(costUsd) AS costUsd, sum(unknownCostCalls) AS unknownCostCalls
				FROM ${sql(AiUsage.table)} WHERE ${within(query)} GROUP BY provider ORDER BY provider
			`
			})
			const listBuckets = SqlSchema.findAll({
				Request: AiUsageQuery,
				Result: Schema.Struct({
					at: DateTimeUtcFromFiniteMillis,
					byProvider: Schema.fromJsonString(Schema.Array(AiUsageBreakdown))
				}),
				execute: query => sql`
				SELECT at, json_group_array(json_object('costUsd', costUsd, 'name', name, 'unknownCostCalls', unknownCostCalls)) AS byProvider
				FROM (
					SELECT hour - hour % ${query.size} AS at, provider AS name, total(costUsd) AS costUsd,
						sum(unknownCostCalls) AS unknownCostCalls
					FROM ${sql(AiUsage.table)} WHERE ${within(query)} GROUP BY 1, 2 ORDER BY 1, 2
				) GROUP BY at ORDER BY at
			`
			})
			const saveUsage = Effect.fnUntraced(function* (id: UserId, entry: AiUsageEntry) {
				const metered = {entry}
				if (
					entry.costSource !== 'provider' &&
					Option.isSome(entry.model) &&
					entry.inputTokens + entry.outputTokens + entry.cacheReadTokens + entry.cacheWriteTokens > 0
				) {
					yield* refreshPricing
					const catalogProvider = Boolean.match(entry.provider === 'opencode-zen', {
						onFalse: () => entry.provider,
						onTrue: () => 'opencode'
					})
					const cost = pipe(
						yield* Ref.get(pricing),
						Record.get(catalogProvider),
						Option.flatMap(provider => Record.get(provider.models, Option.getOrThrow(entry.model))),
						Option.flatMap(model => model.cost)
					)
					if (Option.isSome(cost)) {
						const price = Option.getOrThrow(cost)
						if (
							(entry.cacheReadTokens === 0 || Option.isSome(price.cache_read)) &&
							(entry.cacheWriteTokens === 0 || Option.isSome(price.cache_write))
						) {
							metered.entry = {
								...entry,
								costSource: 'models.dev',
								costUsd: Option.some(
									(entry.inputTokens * price.input +
										entry.outputTokens * price.output +
										entry.cacheReadTokens * Option.getOrElse(price.cache_read, () => 0) +
										entry.cacheWriteTokens * Option.getOrElse(price.cache_write, () => 0)) /
										1_000_000
								)
							}
						}
					}
				}
				yield* pipe(
					Effect.andThen(
						addUsage({
							costUsd: Option.getOrElse(metered.entry.costUsd, () => 0),
							hour: DateTime.startOf(entry.at, 'hour'),
							owner: id,
							provider: entry.provider,
							unknownCostCalls: Boolean.match(metered.entry.costSource === 'unknown', {
								onFalse: () => 0,
								onTrue: () => 1
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
						provider: AiProvider,
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
								inputTokens: 0,
								model,
								outputTokens: 0,
								provider
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
								for (const data of MutableList.toArray(events)) yield* updateUsage(data)
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
						yield* saveUsage(id, state.current)
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
										{byProvider: listTotals({...range, owner: id}), series: listBuckets({...range, owner: id})},
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
