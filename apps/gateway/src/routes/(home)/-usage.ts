import {Array, DateTime, Duration, HashMap, Option, pipe} from 'effect'

import {usdOf} from '@deslop/components-web/format'

import type {AiUsageBreakdown, AiUsageReport} from '#services/ai-metering/schema.ts'
import type {AiProvider} from '#services/ai-proxy/schema.ts'
import type {McpUsageServer, ServerId} from '#services/connections/schema.ts'
import type {UsageRange} from '#services/usage/schema.ts'

// A sum whose every call had no known price shows a dash, not a zero.
function costOf(sum: AiUsageBreakdown) {
	if (sum.costUsd === 0 && sum.unknownCostCalls > 0) return '—'
	return usdOf(sum.costUsd)
}

// Each bucket of the period, filled with zero where nothing was recorded.
function seriesOf(range: UsageRange, value: (at: DateTime.Utc) => number) {
	return Array.map(Array.range(0, range.count - 1), index =>
		value(DateTime.addDuration(range.from, Duration.times(range.size, index)))
	)
}
export function providerSeries(report: AiUsageReport, provider: AiProvider, range: UsageRange) {
	const costs = HashMap.fromIterable(
		Array.flatMap(report.series, bucket =>
			pipe(
				bucket.byProvider,
				Array.filter(sum => sum.name === provider),
				Array.map(sum => [bucket.at, sum.costUsd] as const)
			)
		)
	)
	return seriesOf(range, at =>
		pipe(
			costs,
			HashMap.get(at),
			Option.getOrElse(() => 0)
		)
	)
}
export function providerCost(report: AiUsageReport, provider: AiProvider) {
	return pipe(
		report.byProvider,
		Array.findFirst(sum => sum.name === provider),
		Option.map(costOf),
		Option.getOrElse(() => '—')
	)
}
export function serverSeries(report: readonly McpUsageServer[], id: ServerId, range: UsageRange) {
	return seriesOf(range, at =>
		pipe(
			report,
			Array.findFirst(row => row.id === id),
			Option.flatMap(row => Array.findFirst(row.series, bucket => DateTime.Equivalence(bucket.at, at))),
			Option.map(bucket => bucket.calls),
			Option.getOrElse(() => 0)
		)
	)
}
