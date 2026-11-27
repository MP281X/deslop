import {Array, Effect, Option, Order, Schema, Struct, pipe} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {DeployError, HistoryQuery} from '#contracts'

import {ownerNames} from '#server/inventory/lib/inventory.ts'
import {Machine} from '#server/machine/service.ts'
import {resourceHistory} from '#server/metrics/lib/history.ts'
import {ResourceHistory} from '#server/metrics/schema.ts'
import {Metrics} from '#server/metrics/service.ts'

type MetricSummary = typeof MetricSummary.Type
const MetricSummary = Schema.Struct({
	last: Schema.OptionFromOptionalKey(Schema.Finite),
	max: Schema.OptionFromOptionalKey(Schema.Finite),
	min: Schema.OptionFromOptionalKey(Schema.Finite),
	samples: Schema.Int
})
const ResourceSummary = ResourceHistory.mapFields(fields => ({
	...fields,
	cpuPct: MetricSummary,
	diskPct: MetricSummary,
	memoryPct: MetricSummary,
	series: Schema.OptionFromOptionalKey(Schema.Struct(Struct.pick(fields, ['cpuPct', 'diskPct', 'memoryPct'])))
}))

function metricSummary(series: readonly Option.Option<number>[]) {
	const values = Array.getSomes(series)
	return {
		last: Option.flatten(Array.last(series)),
		max: Array.match(values, {
			onEmpty: () => Option.none(),
			onNonEmpty: measured => Option.some(Array.max(measured, Order.Number))
		}),
		min: Array.match(values, {
			onEmpty: () => Option.none(),
			onNonEmpty: measured => Option.some(Array.min(measured, Order.Number))
		}),
		samples: values.length
	}
}

export const metricsTools = Toolkit.make(
	Tool.make('read_resource_history', {
		description:
			'Inspect current capacity, memory-ranked consumers and min/max/last resource percentages with sample coverage. Set series=true to add the aligned 60-point history with null gaps when timing or spikes matter.',
		failure: DeployError,
		parameters: Schema.Struct({
			...HistoryQuery.fields,
			series: pipe(Schema.Boolean, Schema.withDecodingDefaultTypeKey(Effect.succeed(false)))
		}),
		success: ResourceSummary
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Strict, true)
)

export const metricsToolHandlers = metricsTools.toLayer(
	Effect.gen(function* () {
		const machine = yield* Machine
		const metrics = yield* Metrics
		return metricsTools.of({
			read_resource_history: Effect.fnUntraced(function* (input) {
				const value = yield* Effect.all(
					{history: metrics.read({minutes: input.minutes}), snapshot: machine.snapshot},
					{concurrency: 'unbounded'}
				)
				const history = resourceHistory(value.history, input.minutes, ownerNames(value.snapshot))
				return {
					...history,
					cpuPct: metricSummary(history.cpuPct),
					diskPct: metricSummary(history.diskPct),
					memoryPct: metricSummary(history.memoryPct),
					series: pipe(
						history,
						Struct.pick(['cpuPct', 'diskPct', 'memoryPct']),
						Option.liftPredicate(() => input.series)
					)
				}
			})
		})
	})
)
