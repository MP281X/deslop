import {Array, Number, Order, Record} from 'effect'

import type {AiUsageEntry} from '#services/ai/schema.ts'
import type {UsageRange} from '#services/usage/schema.ts'

function totals(rows: AiUsageEntry[]) {
	return {
		costUsd: Number.sumAll(Array.map(rows, row => row.costUsd ?? 0)),
		unknownCostCalls: Array.countBy(rows, row => row.costSource === 'unknown')
	}
}

function grouped(rows: AiUsageEntry[], key: (entry: AiUsageEntry) => string) {
	return Array.map(Record.toEntries(Array.groupBy(rows, key)), entry => ({name: entry[0], ...totals(entry[1])}))
}

// The period's totals and buckets, shared by the service and its tests.
export function report(entries: AiUsageEntry[], range: UsageRange) {
	const selected = Array.filter(entries, entry => entry.at >= range.from && entry.at < range.to)
	function bucket(entry: AiUsageEntry) {
		return Math.floor(entry.at / range.size) * range.size
	}
	return {
		byProvider: grouped(selected, entry => entry.provider),
		series: Array.sort(
			Array.map(Record.values(Array.groupBy(selected, entry => `${bucket(entry)}`)), group => ({
				at: bucket(group[0]),
				byProvider: grouped(group, entry => entry.provider)
			})),
			Order.mapInput(Number.Order, (entry: {at: number}) => entry.at)
		)
	}
}
