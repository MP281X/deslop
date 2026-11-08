import {Array, Boolean, Number, Option, Order, Schema} from 'effect'

import type {AiUsageEntry, AiUsageQuery} from '#services/ai/schema.ts'
import {Usage} from '#services/ai/schema.ts'

export function readUsage(text: string, entry: AiUsageEntry) {
	const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Usage))(text)
	if (decoded._tag === 'None') return entry
	const usage = {...decoded.value.message?.usage, ...decoded.value.usage}
	return {
		...entry,
		cacheReadTokens:
			usage.cache_read_input_tokens ??
			decoded.value.usage?.prompt_tokens_details?.cached_tokens ??
			entry.cacheReadTokens,
		cacheWriteTokens:
			usage.cache_creation_input_tokens ??
			decoded.value.usage?.prompt_tokens_details?.cache_write_tokens ??
			entry.cacheWriteTokens,
		inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? entry.inputTokens,
		model: decoded.value.model ?? decoded.value.message?.model ?? entry.model,
		outputTokens: usage.output_tokens ?? usage.completion_tokens ?? entry.outputTokens,
		...Boolean.match(decoded.value.usage?.cost !== undefined || decoded.value.cost !== undefined, {
			onFalse: () => ({}),
			onTrue: () => ({costSource: 'provider' as const, costUsd: decoded.value.usage?.cost ?? decoded.value.cost})
		})
	} satisfies AiUsageEntry
}

function totals(rows: AiUsageEntry[]) {
	return rows.reduce(
		(sum, row) => ({
			cacheReadTokens: sum.cacheReadTokens + row.cacheReadTokens,
			cacheWriteTokens: sum.cacheWriteTokens + row.cacheWriteTokens,
			calls: sum.calls + 1,
			costUsd: sum.costUsd + (row.costUsd ?? 0),
			inputTokens: sum.inputTokens + row.inputTokens,
			outputTokens: sum.outputTokens + row.outputTokens,
			unknownCostCalls:
				sum.unknownCostCalls + Boolean.match(row.costSource === 'unknown', {onFalse: () => 0, onTrue: () => 1})
		}),
		{
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			calls: 0,
			costUsd: 0,
			inputTokens: 0,
			outputTokens: 0,
			unknownCostCalls: 0
		}
	)
}
function grouped(rows: AiUsageEntry[], key: (entry: AiUsageEntry) => string) {
	return Object.entries(Array.groupBy(rows, key)).map(entry => ({name: entry[0], ...totals(entry[1])}))
}
export function report(entries: AiUsageEntry[], query: AiUsageQuery) {
	const selected = entries.filter(entry => entry.at >= query.from && entry.at < query.to)
	const size = Boolean.match(query.bucket === 'hour', {onFalse: () => 86_400_000, onTrue: () => 3_600_000})
	return {
		byApp: grouped(selected, entry => entry.app),
		byModel: grouped(selected, entry => entry.model ?? 'unknown'),
		byProvider: grouped(selected, entry => entry.provider),
		series: Array.sort(
			Object.entries(Array.groupBy(selected, entry => `${Math.floor(entry.at / size) * size}`)).map(group => ({
				at: Option.getOrElse(Number.parse(group[0]), () => 0),
				byApp: grouped(group[1], entry => entry.app),
				byModel: grouped(group[1], entry => entry.model ?? 'unknown')
			})),
			Order.mapInput(Number.Order, (entry: {at: number}) => entry.at)
		),
		totals: totals(selected)
	}
}
