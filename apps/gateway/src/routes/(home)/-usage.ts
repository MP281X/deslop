import {Array, Number, Option} from 'effect'

import type {AiProvider, AiUsageBreakdown, AiUsageReport} from '#services/ai/schema.ts'
import type {McpUsageServer} from '#services/connections/schema.ts'

export type Range = {bucket: 'day' | 'hour'; count: number; from: number; size: number}

const usd = new Intl.NumberFormat('en', {
	currency: 'USD',
	maximumFractionDigits: 2,
	minimumFractionDigits: 2,
	style: 'currency'
})

function cost(value: number) {
	if (value > 0 && value < 0.01) return '<$0.01'
	return usd.format(value)
}
// A sum whose every call had no known price shows a dash, not a zero.
function costOf(sum: AiUsageBreakdown) {
	if (sum.costUsd === 0 && sum.unknownCostCalls > 0) return '—'
	return cost(sum.costUsd)
}

// Each bucket of the period, filled with zero where nothing was recorded.
function seriesOf(range: Range, value: (at: number) => number) {
	return Array.map(Array.range(0, range.count - 1), index => value(range.from + index * range.size))
}
export function providerSeries(report: AiUsageReport, provider: AiProvider, range: Range) {
	return seriesOf(range, at =>
		Option.getOrElse(
			Option.map(
				Option.flatMap(
					Array.findFirst(report.series, bucket => bucket.at === at),
					bucket => Array.findFirst(bucket.byProvider, sum => sum.name === provider)
				),
				sum => sum.costUsd
			),
			() => 0
		)
	)
}
export function providerCost(report: AiUsageReport, provider: AiProvider) {
	return Option.getOrElse(
		Option.map(
			Array.findFirst(report.byProvider, sum => sum.name === provider),
			costOf
		),
		() => '—'
	)
}
export function serverSeries(report: readonly McpUsageServer[], id: string, range: Range) {
	return seriesOf(range, at =>
		Option.getOrElse(
			Option.map(
				Option.flatMap(
					Array.findFirst(report, row => row.id === id),
					row => Array.findFirst(row.series, bucket => bucket.at === at)
				),
				bucket => bucket.calls
			),
			() => 0
		)
	)
}
export function serverCalls(report: readonly McpUsageServer[], id: string) {
	return Option.getOrElse(
		Option.map(
			Array.findFirst(report, row => row.id === id),
			row => Number.sumAll(Array.map(row.series, bucket => bucket.calls))
		),
		() => 0
	)
}
