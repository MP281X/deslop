import {Schema} from 'effect'

import {AiProvider} from '@deslop/runtime/ai'

export {AiProvider}
export type AiKeyInfo = typeof AiKeyInfo.Type
export const AiKeyInfo = Schema.Struct({
	addedAt: Schema.Number,
	last4: Schema.String,
	lastStatus: Schema.optional(Schema.Number),
	provider: AiProvider
})
export type AiStoredKey = typeof AiStoredKey.Type
export const AiStoredKey = Schema.Struct({...AiKeyInfo.fields, secret: Schema.RedactedFromValue(Schema.String)})
export type AiSetKey = typeof AiSetKey.Type
export const AiSetKey = Schema.Struct({provider: AiProvider, secret: Schema.RedactedFromValue(Schema.NonEmptyString)})
export type AiGrantInfo = typeof AiGrantInfo.Type
export const AiGrantInfo = Schema.Struct({app: Schema.String, createdAt: Schema.Number, lastUsedAt: Schema.Number})
export type AiStoredGrant = typeof AiStoredGrant.Type
export const AiStoredGrant = Schema.Struct({...AiGrantInfo.fields, hash: Schema.String, userId: Schema.String})
export type AiUsageEntry = typeof AiUsageEntry.Type
export const AiUsageEntry = Schema.Struct({
	app: Schema.String,
	at: Schema.Number,
	cacheReadTokens: Schema.Number,
	cacheWriteTokens: Schema.Number,
	costSource: Schema.Literals(['provider', 'models.dev', 'unknown']),
	costUsd: Schema.optionalKey(Schema.Number),
	inputTokens: Schema.Number,
	model: Schema.optional(Schema.String),
	outputTokens: Schema.Number,
	provider: AiProvider,
	status: Schema.Number
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
						cache_read: Schema.optionalKey(Schema.Number),
						cache_write: Schema.optionalKey(Schema.Number),
						input: Schema.Number,
						output: Schema.Number
					})
				)
			})
		)
	})
)
export type Usage = typeof Usage.Type
export const Usage = Schema.Struct({
	cost: Schema.optionalKey(Schema.Number),
	message: Schema.optionalKey(
		Schema.Struct({
			model: Schema.optionalKey(Schema.String),
			usage: Schema.optionalKey(
				Schema.Struct({
					cache_creation_input_tokens: Schema.optionalKey(Schema.Number),
					cache_read_input_tokens: Schema.optionalKey(Schema.Number),
					input_tokens: Schema.optionalKey(Schema.Number),
					output_tokens: Schema.optionalKey(Schema.Number)
				})
			)
		})
	),
	model: Schema.optionalKey(Schema.String),
	usage: Schema.optionalKey(
		Schema.Struct({
			cache_creation_input_tokens: Schema.optionalKey(Schema.Number),
			cache_read_input_tokens: Schema.optionalKey(Schema.Number),
			completion_tokens: Schema.optionalKey(Schema.Number),
			cost: Schema.optionalKey(Schema.Number),
			input_tokens: Schema.optionalKey(Schema.Number),
			output_tokens: Schema.optionalKey(Schema.Number),
			prompt_tokens: Schema.optionalKey(Schema.Number),
			prompt_tokens_details: Schema.optionalKey(
				Schema.Struct({
					cache_write_tokens: Schema.optionalKey(Schema.Number),
					cached_tokens: Schema.optionalKey(Schema.Number)
				})
			)
		})
	)
})
