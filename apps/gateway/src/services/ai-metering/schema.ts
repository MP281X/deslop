import {Schema} from 'effect'

import {Model} from 'effect/schema'

import {AiModelId, AiProvider} from '@deslop/runtime/shared/ai'
import {User} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {UsageRange} from '#services/usage/schema.ts'

// One person's calls to one provider in one hour: what the known prices sum to, and how many calls had none.
export class AiUsage extends Model.Class<AiUsage>('AiUsage')({
	costUsd: Schema.Finite,
	hour: Schema.DateTimeUtcFromMillis,
	owner: Model.Sensitive(User.fields.id),
	provider: AiProvider,
	unknownCostCalls: Schema.Int
}) {
	static readonly table = 'ai_usage'
}

// What a period's report reads of a person's hours.
export type AiUsageQuery = typeof AiUsageQuery.Type
export const AiUsageQuery = Schema.Struct({...UsageRange.fields, owner: AiUsage.fields.owner})

// A call being metered: what its response reported, read as it streams.
export type AiUsageEntry = typeof AiUsageEntry.Type
export const AiUsageEntry = Schema.Struct({
	at: DateTimeUtcFromFiniteMillis,
	cacheReadTokens: Schema.Finite,
	cacheWriteTokens: Schema.Finite,
	costSource: Schema.Literals(['provider', 'models.dev', 'unknown']),
	costUsd: Schema.OptionFromOptionalKey(Schema.Finite),
	inputTokens: Schema.Finite,
	model: Schema.OptionFromOptional(AiModelId),
	outputTokens: Schema.Finite,
	provider: AiProvider
})
export type AiUsageBreakdown = typeof AiUsageBreakdown.Type
export const AiUsageBreakdown = Schema.Struct({
	costUsd: Schema.Finite,
	name: Schema.String,
	unknownCostCalls: Schema.Finite
})
export type AiUsageReport = typeof AiUsageReport.Type
export const AiUsageReport = Schema.Struct({
	byProvider: Schema.Array(AiUsageBreakdown),
	series: Schema.Array(Schema.Struct({at: DateTimeUtcFromFiniteMillis, byProvider: Schema.Array(AiUsageBreakdown)}))
})

export type ModelsCatalog = typeof ModelsCatalog.Type
export const ModelsCatalog = Schema.Record(
	Schema.String,
	Schema.Struct({
		models: Schema.Record(
			AiModelId,
			Schema.Struct({
				cost: Schema.OptionFromOptionalKey(
					Schema.Struct({
						cache_read: Schema.OptionFromOptionalKey(Schema.Finite),
						cache_write: Schema.OptionFromOptionalKey(Schema.Finite),
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
	cost: Schema.OptionFromOptionalKey(Schema.Finite),
	message: Schema.OptionFromOptionalKey(
		Schema.Struct({
			model: Schema.OptionFromOptionalKey(AiModelId),
			usage: Schema.OptionFromOptionalKey(
				Schema.Struct({
					cache_creation_input_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
					cache_read_input_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
					input_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
					output_tokens: Schema.OptionFromOptionalKey(Schema.Finite)
				})
			)
		})
	),
	model: Schema.OptionFromOptionalKey(AiModelId),
	usage: Schema.OptionFromOptionalKey(
		Schema.OptionFromNullOr(
			Schema.Struct({
				cache_creation_input_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
				cache_read_input_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
				completion_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
				cost: Schema.OptionFromOptionalKey(Schema.Finite),
				input_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
				output_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
				prompt_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
				prompt_tokens_details: Schema.OptionFromOptionalKey(
					Schema.Struct({
						cache_write_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
						cached_tokens: Schema.OptionFromOptionalKey(Schema.Finite)
					})
				)
			})
		)
	)
})
