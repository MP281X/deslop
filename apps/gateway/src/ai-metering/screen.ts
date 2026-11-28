import {Array, Boolean, DateTime, Duration, Function, HashMap, Number, Option, Schema, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {usdOf} from '@deslop/runtime/shared/format'
import {TimeFrame} from '@deslop/runtime/shared/time'

import {AiUsageWindow} from './contract.ts'
import type {AiUsageBreakdown, SpendSource} from './contract.ts'

import type {UsageRange} from '#usage/contract.ts'

const AiUsageRead = AsyncResult.Schema({error: Schema.Unknown, success: AiUsageWindow})

export const aiMeteringFields = {aiUsage: AiUsageRead}
export const aiMeteringMessages = {AiUsage: {period: TimeFrame, result: AiUsageRead}}

// `~` marks a figure that is estimated or missing a call's cost.
function costOf(sum: AiUsageBreakdown) {
	return `${Boolean.match(sum.spendSource === 'byok' || sum.spendSource === 'openai' || sum.estimatedCalls > 0 || sum.unknownCostCalls > 0, {onFalse: Function.constant(''), onTrue: Function.constant('~')})}${usdOf(sum.costUsd)}`
}

// Sum the source buckets into 60 chart slots like Deploy; ten minutes keeps its ten honest minute buckets.
function seriesOf(range: UsageRange, value: (at: DateTime.Utc) => number) {
	const slots = Number.min(60, range.count)
	return Array.makeBy(slots, index =>
		Number.sumAll(
			Array.makeBy(Math.ceil(((index + 1) * range.count) / slots) - Math.ceil((index * range.count) / slots), offset =>
				value(
					DateTime.addDuration(
						range.from,
						Duration.times(range.size, Math.ceil((index * range.count) / slots) + offset)
					)
				)
			)
		)
	)
}

export function aiSeries(report: AiUsageWindow['report'], source: SpendSource, range: UsageRange) {
	const costs = HashMap.fromIterable(
		pipe(
			report.series,
			Array.filter(bucket => bucket.spendSource === source),
			Array.map(bucket => [bucket.at, bucket.costUsd] as const)
		)
	)
	return seriesOf(range, at => pipe(costs, HashMap.get(at), Option.getOrElse(Function.constant(0))))
}

export function aiCost(report: AiUsageWindow['report'], source: SpendSource) {
	return pipe(
		report.totals,
		Array.findFirst(total => total.spendSource === source),
		Option.match({
			onNone: () => costOf({costUsd: 0, estimatedCalls: 0, spendSource: source, unknownCostCalls: 0}),
			onSome: costOf
		})
	)
}
