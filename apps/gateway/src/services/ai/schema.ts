import {Schema} from 'effect'

import {AiProvider} from '@deslop/runtime/ai/schema'

export {AiProvider}
export type AiKeyInfo = typeof AiKeyInfo.Type
export const AiKeyInfo = Schema.Struct({
	addedAt: Schema.Finite,
	last4: Schema.String,
	lastStatus: Schema.optional(Schema.Finite),
	provider: AiProvider
})
export type AiStoredKey = typeof AiStoredKey.Type
export const AiStoredKey = Schema.Struct({...AiKeyInfo.fields, secret: Schema.RedactedFromValue(Schema.String)})
export type AiSetKey = typeof AiSetKey.Type
export const AiSetKey = Schema.Struct({provider: AiProvider, secret: Schema.RedactedFromValue(Schema.NonEmptyString)})
export type AiUsageEntry = typeof AiUsageEntry.Type
export const AiUsageEntry = Schema.Struct({
	app: Schema.String,
	at: Schema.Finite,
	cacheReadTokens: Schema.Finite,
	cacheWriteTokens: Schema.Finite,
	costSource: Schema.Literals(['provider', 'models.dev', 'unknown']),
	costUsd: Schema.optionalKey(Schema.Finite),
	inputTokens: Schema.Finite,
	model: Schema.optional(Schema.String),
	outputTokens: Schema.Finite,
	provider: AiProvider,
	status: Schema.Finite
})
export type AiUsageQuery = typeof AiUsageQuery.Type
export const AiUsageQuery = Schema.Struct({
	bucket: Schema.Literals(['hour', 'day']),
	from: Schema.Finite,
	to: Schema.Finite
})
export type AiUsageTotals = typeof AiUsageTotals.Type
export const AiUsageTotals = Schema.Struct({
	cacheReadTokens: Schema.Finite,
	cacheWriteTokens: Schema.Finite,
	calls: Schema.Finite,
	costUsd: Schema.Finite,
	inputTokens: Schema.Finite,
	outputTokens: Schema.Finite,
	// Every token billed once: Anthropic reports cache tokens beside its input, the others inside it.
	tokens: Schema.Finite,
	unknownCostCalls: Schema.Finite
})
export type AiUsageBreakdown = typeof AiUsageBreakdown.Type
export const AiUsageBreakdown = Schema.Struct({name: Schema.String, ...AiUsageTotals.fields})
export type AiUsageCell = typeof AiUsageCell.Type
export const AiUsageCell = Schema.Struct({
	app: Schema.String,
	at: Schema.Finite,
	model: Schema.String,
	...AiUsageTotals.fields
})
export type AiUsageReport = typeof AiUsageReport.Type
export const AiUsageReport = Schema.Struct({
	byApp: Schema.Array(AiUsageBreakdown),
	byModel: Schema.Array(AiUsageBreakdown),
	byProvider: Schema.Array(AiUsageBreakdown),
	cells: Schema.Array(AiUsageCell),
	series: Schema.Array(
		Schema.Struct({at: Schema.Finite, byApp: Schema.Array(AiUsageBreakdown), byModel: Schema.Array(AiUsageBreakdown)})
	),
	totals: AiUsageTotals
})

export type ModelsCatalog = typeof ModelsCatalog.Type
export const ModelsCatalog = Schema.Record(
	Schema.String,
	Schema.Struct({
		models: Schema.Record(
			Schema.String,
			Schema.Struct({
				cost: Schema.optionalKey(
					Schema.Struct({
						cache_read: Schema.optionalKey(Schema.Finite),
						cache_write: Schema.optionalKey(Schema.Finite),
						input: Schema.Finite,
						output: Schema.Finite
					})
				)
			})
		)
	})
)
export type Usage = typeof Usage.Type
export const Usage = Schema.Struct({
	cost: Schema.optionalKey(Schema.Finite),
	message: Schema.optionalKey(
		Schema.Struct({
			model: Schema.optionalKey(Schema.String),
			usage: Schema.optionalKey(
				Schema.Struct({
					cache_creation_input_tokens: Schema.optionalKey(Schema.Finite),
					cache_read_input_tokens: Schema.optionalKey(Schema.Finite),
					input_tokens: Schema.optionalKey(Schema.Finite),
					output_tokens: Schema.optionalKey(Schema.Finite)
				})
			)
		})
	),
	model: Schema.optionalKey(Schema.String),
	usage: Schema.optionalKey(
		Schema.Struct({
			cache_creation_input_tokens: Schema.optionalKey(Schema.Finite),
			cache_read_input_tokens: Schema.optionalKey(Schema.Finite),
			completion_tokens: Schema.optionalKey(Schema.Finite),
			cost: Schema.optionalKey(Schema.Finite),
			input_tokens: Schema.optionalKey(Schema.Finite),
			output_tokens: Schema.optionalKey(Schema.Finite),
			prompt_tokens: Schema.optionalKey(Schema.Finite),
			prompt_tokens_details: Schema.optionalKey(
				Schema.Struct({
					cache_write_tokens: Schema.optionalKey(Schema.Finite),
					cached_tokens: Schema.optionalKey(Schema.Finite)
				})
			)
		})
	)
})
