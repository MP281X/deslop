import {Array, Boolean, DateTime, Duration, Function, HashMap, Option, pipe} from 'effect'

import {usdOf} from '@deslop/runtime/shared/format'

import type {AiUsageBreakdown, AiUsageReport, SpendSource} from '#services/ai-metering/schema.ts'
import type {McpUsageServer, ServerId} from '#services/connections/schema.ts'
import type {UsageRange} from '#services/usage/schema.ts'

// `~` marks a figure that is estimated or missing a call's cost.
function costOf(sum: AiUsageBreakdown) {
	return `${Boolean.match(sum.estimatedCalls > 0 || sum.unknownCostCalls > 0, {onFalse: Function.constant(''), onTrue: Function.constant('~')})}${usdOf(sum.costUsd)}`
}

// Each bucket of the period, filled with zero where nothing was recorded.
function seriesOf(range: UsageRange, value: (at: DateTime.Utc) => number) {
	return Array.map(Array.range(0, range.count - 1), index =>
		value(DateTime.addDuration(range.from, Duration.times(range.size, index)))
	)
}
export function aiSeries(report: AiUsageReport, source: SpendSource, range: UsageRange) {
	const costs = HashMap.fromIterable(
		pipe(
			report.series,
			Array.filter(bucket => bucket.spendSource === source),
			Array.map(bucket => [bucket.at, bucket.costUsd] as const)
		)
	)
	return seriesOf(range, at => pipe(costs, HashMap.get(at), Option.getOrElse(Function.constant(0))))
}
export function aiCost(report: AiUsageReport, source: SpendSource) {
	return pipe(
		report.totals,
		Array.findFirst(total => total.spendSource === source),
		Option.match({onNone: () => usdOf(0), onSome: costOf})
	)
}
export function serverSeries(report: readonly McpUsageServer[], id: ServerId, range: UsageRange) {
	return seriesOf(range, at =>
		pipe(
			report,
			Array.findFirst(row => row.id === id),
			Option.flatMap(row => Array.findFirst(row.series, bucket => DateTime.Equivalence(bucket.at, at))),
			Option.map(bucket => bucket.calls),
			Option.getOrElse(Function.constant(0))
		)
	)
}
