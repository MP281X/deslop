import {Schema} from 'effect'

import {Model} from 'effect/schema'

import {AiProvider} from '@deslop/runtime/shared/ai'
import {User} from '@deslop/runtime/shared/auth'

import {UsageRange} from '#services/usage/schema.ts'

export {AiProvider}
export const PROVIDER_NAMES = {
	anthropic: 'Anthropic',
	'opencode-go': 'OpenCode Go',
	'opencode-zen': 'OpenCode Zen',
	openrouter: 'OpenRouter'
} satisfies Record<AiProvider, string>

export type AiSetKey = typeof AiSetKey.Type
export const AiSetKey = Schema.Struct({provider: AiProvider, secret: Schema.RedactedFromValue(Schema.NonEmptyString)})

// One person's key for one provider; the page knows it by its last four characters and the status its last call got.
export class AiKey extends Model.Class<AiKey>('AiKey')({
	last4: Schema.String,
	lastStatus: Model.FieldOption(Schema.Int),
	owner: Model.Sensitive(User.fields.id),
	provider: AiProvider,
	secret: Model.Sensitive(AiSetKey.fields.secret)
}) {
	static readonly table = 'ai_keys'
}
export type AiKeyInfo = typeof AiKey.json.Type

// One person's calls to one provider in one hour: what the known prices sum to, and how many calls had none.
export class AiUsage extends Model.Class<AiUsage>('AiUsage')({
	costUsd: Schema.Finite,
	hour: Schema.Int,
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
	at: Schema.Finite,
	cacheReadTokens: Schema.Finite,
	cacheWriteTokens: Schema.Finite,
	costSource: Schema.Literals(['provider', 'models.dev', 'unknown']),
	costUsd: Schema.optionalKey(Schema.Finite),
	inputTokens: Schema.Finite,
	model: Schema.optional(Schema.String),
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
	series: Schema.Array(Schema.Struct({at: Schema.Finite, byProvider: Schema.Array(AiUsageBreakdown)}))
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
		Schema.NullOr(
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
	)
})
