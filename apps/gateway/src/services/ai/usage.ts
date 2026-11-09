import {Array, Boolean, Number, Option, Order, Record, Result, Schema, String} from 'effect'

import type {AiUsageEntry, AiUsageQuery} from '#services/ai/schema.ts'
import {Usage} from '#services/ai/schema.ts'

export function readUsage(text: string, entry: AiUsageEntry) {
	if (String.isEmpty(String.trim(text)) || text === '[DONE]') return Result.succeed(entry)
	return Result.map(Schema.decodeResult(Schema.fromJsonString(Usage))(text), decoded => {
		const usage = {...decoded.message?.usage, ...decoded.usage}
		const cacheReadTokens =
			usage.cache_read_input_tokens ?? decoded.usage?.prompt_tokens_details?.cached_tokens ?? entry.cacheReadTokens
		const cacheWriteTokens =
			usage.cache_creation_input_tokens ??
			decoded.usage?.prompt_tokens_details?.cache_write_tokens ??
			entry.cacheWriteTokens
		return {
			...entry,
			cacheReadTokens,
			cacheWriteTokens,
			// Input is stored without cached tokens, as Anthropic's messages report it; chat completions' prompt_tokens include them, whichever provider serves the shape.
			inputTokens:
				usage.input_tokens ??
				Option.match(Option.fromUndefinedOr(usage.prompt_tokens), {
					onNone: () => entry.inputTokens,
					onSome: prompt => Number.max(0, prompt - cacheReadTokens - cacheWriteTokens)
				}),
			model: decoded.model ?? decoded.message?.model ?? entry.model,
			outputTokens: usage.output_tokens ?? usage.completion_tokens ?? entry.outputTokens,
			...Boolean.match(decoded.usage?.cost !== undefined || decoded.cost !== undefined, {
				onFalse: () => ({}),
				onTrue: () => ({costSource: 'provider' as const, costUsd: decoded.usage?.cost ?? decoded.cost})
			})
		} satisfies AiUsageEntry
	})
}

function totals(rows: AiUsageEntry[]) {
	return Array.reduce(rows, {costUsd: 0, unknownCostCalls: 0}, (sum, row) => ({
		costUsd: sum.costUsd + (row.costUsd ?? 0),
		unknownCostCalls:
			sum.unknownCostCalls + Boolean.match(row.costSource === 'unknown', {onFalse: () => 0, onTrue: () => 1})
	}))
}
function grouped(rows: AiUsageEntry[], key: (entry: AiUsageEntry) => string) {
	return Array.map(Record.toEntries(Array.groupBy(rows, key)), entry => ({name: entry[0], ...totals(entry[1])}))
}
export function report(entries: AiUsageEntry[], query: AiUsageQuery) {
	const selected = Array.filter(entries, entry => entry.at >= query.from && entry.at < query.to)
	const size = Boolean.match(query.bucket === 'hour', {onFalse: () => 86_400_000, onTrue: () => 3_600_000})
	function bucket(entry: AiUsageEntry) {
		return Math.floor(entry.at / size) * size
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
