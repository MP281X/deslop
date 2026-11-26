import type {DateTime} from 'effect'
import {Context, Effect, Function, Layer, MutableList, Option, Schema, Stream, pipe} from 'effect'

import {Sse} from 'effect/encoding'
import {Reactivity} from 'effect/reactivity'
import {SqlClient, SqlSchema} from 'effect/sql'

import type {AiModelId} from '@deslop/runtime/shared/ai'
import {AuthError} from '@deslop/runtime/shared/auth'
import type {UserId} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'
import type {TimeFrame} from '@deslop/runtime/shared/time'

import {AiUsageBreakdown} from '#contracts'
import type {AiProvider, SpendSource} from '#contracts'

import {readUsage, totalsOf} from './response.ts'
import {AiCall, AiUsageQuery} from './schema.ts'
import type {AiUsageEntry} from './schema.ts'

import {usageWindow} from '#server/usage/window.ts'

// A direct provider key is its own payer; OpenCode must name one in its response.
const KEY_PAYERS: Record<AiProvider, Option.Option<SpendSource>> = {
	anthropic: Option.some('byok'),
	openai: Option.some('openai'),
	opencode: Option.none()
}

// AiProxy's migrations (ai_migrations) own the AI tables.

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly aiUsage: UserId
	}
}

export class AiMetering extends Context.Service<AiMetering>()('@deslop/gateway/server/ai-metering/service/AiMetering', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const withReactivity = Effect.provideService(Reactivity.Reactivity, yield* Reactivity.Reactivity)
		const addUsage = SqlSchema.void({
			Request: AiCall.insert,
			execute: row => sql`INSERT INTO ${sql(AiCall.table)} ${sql.insert(row)}`
		})
		// One read per report: the totals are summed from these buckets, so the figure and its sparkline always agree.
		const listBuckets = SqlSchema.findAll({
			Request: AiUsageQuery,
			Result: Schema.Struct({at: DateTimeUtcFromFiniteMillis, ...AiUsageBreakdown.fields}),
			execute: query => sql`
				SELECT at - at % ${query.size} AS at, spendSource, total(costUsd) AS costUsd,
					sum(1 - costKnown) AS unknownCostCalls, sum(estimated) AS estimatedCalls
				FROM ${sql(AiCall.table)} WHERE owner = ${query.owner} AND at >= ${query.from} AND at < ${query.to}
				GROUP BY 1, spendSource ORDER BY 1, spendSource
			`
		})
		const saveUsage = Effect.fnUntraced(function* (id: UserId, entry: AiUsageEntry, spendSource: SpendSource) {
			yield* pipe(
				addUsage({
					at: entry.at,
					costKnown: entry.costSource !== 'unknown',
					costUsd: Option.getOrElse(entry.costUsd, Function.constant(0)),
					estimated: entry.estimated,
					owner: id,
					spendSource
				}),
				Reactivity.mutation({aiUsage: [id]}),
				withReactivity
			)
		})
		return {
			// `accepted`: the provider took the request (2xx), so a direct key's payer is known even if its usage never arrives.
			observe: Effect.fn('AiMetering.observe')(
				(
					id: UserId,
					provider: AiProvider,
					model: Option.Option<AiModelId>,
					at: DateTime.Utc,
					response: {accepted: boolean; sse: boolean}
				) =>
					Effect.sync(() => {
						const sse = response.sse
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
								spendSource: Option.filter(KEY_PAYERS[provider], () => response.accepted)
							},
							finalUsage: false,
							pending: ''
						}
						const updateUsage = Effect.fnUntraced(function* (text: string) {
							// The event's text is the model's output, so the warning carries none of it.
							const read = yield* Effect.catch(Effect.fromResult(readUsage(text, state.current, provider)), () =>
								Effect.as(Effect.logWarning('AI usage was malformed; keeping previously read usage'), {
									entry: state.current,
									finalUsage: false
								})
							)
							state.current = read.entry
							state.finalUsage ||= read.finalUsage
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
							save: Effect.catchCause(
								Effect.gen(function* () {
									if (sse) {
										yield* Effect.catchCause(feed(`${decoder.decode()}\n\n`), () =>
											Effect.logWarning('AI usage response could not be read')
										)
									} else {
										yield* updateUsage(state.pending + decoder.decode())
									}
									// A stream that failed, broke off or ended on an in-band error keeps what it read as an incomplete figure.
									if (!state.finalUsage) {
										state.current = {...state.current, costSource: 'unknown'}
									}
									yield* Option.match(state.current.spendSource, {
										onNone: () => Effect.void,
										onSome: spendSource => saveUsage(id, state.current, spendSource)
									})
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
									() => Effect.logWarning('AI usage response could not be read')
								)
						}
					})
			),
			usage: (id: UserId, period: TimeFrame) =>
				Stream.withSpan(
					usageWindow(period, {aiUsage: [id]}, range =>
						Effect.mapBoth(listBuckets({...range, owner: id}), {
							onFailure: cause =>
								AuthError.make({cause, error: 'temporarily_unavailable', message: 'AI usage storage failed'}),
							onSuccess: series => ({series, totals: totalsOf(series)})
						})
					),
					'AiMetering.usage',
					{attributes: {period, 'rpc.stream': true, userId: id}}
				)
		}
	})
}) {
	static readonly layer = Layer.effect(AiMetering, AiMetering.make)
}
