import {Schema} from 'effect'

import {Model} from 'effect/schema'

import {AiModelId} from '@deslop/runtime/shared/ai'
import {User} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {UsageRange} from '#services/usage/schema.ts'

export type SpendSource = typeof SpendSource.Type
export const SpendSource = Schema.Literals(['balance', 'byok', 'openai', 'free', 'go', 'go-plus'])
// The payers the home list shows a row for.
export type Payer = typeof Payer.Type
export const Payer = Schema.Literals(['balance', 'byok', 'openai'])

// One person's call, attributed to the billed balance or provider key.
export class AiCall extends Model.Class<AiCall>('AiCall')({
	at: Schema.DateTimeUtcFromMillis,
	costKnown: Schema.BooleanFromBit,
	costUsd: Schema.Finite,
	estimated: Schema.BooleanFromBit,
	owner: Model.Sensitive(User.fields.id),
	spendSource: SpendSource
}) {
	static readonly table = 'ai_calls'
}

// What a period's report reads of a person's calls.
export type AiUsageQuery = typeof AiUsageQuery.Type
export const AiUsageQuery = Schema.Struct({...UsageRange.fields, owner: AiCall.fields.owner})

// A call being metered: what its response reported, read as it streams.
export type AiUsageEntry = typeof AiUsageEntry.Type
export const AiUsageEntry = Schema.Struct({
	at: DateTimeUtcFromFiniteMillis,
	cacheReadTokens: Schema.Finite,
	cacheWriteTokens: Schema.Finite,
	costSource: Schema.Literals(['provider', 'estimated', 'unknown']),
	costUsd: Schema.OptionFromOptionalKey(Schema.Finite),
	estimated: Schema.Boolean,
	inputTokens: Schema.Finite,
	model: Schema.OptionFromOptional(AiModelId),
	outputTokens: Schema.Finite,
	// Direct provider keys identify their payer; OpenCode must name one in its response.
	spendSource: Schema.OptionFromOptionalKey(SpendSource)
})
export type AiUsageBreakdown = typeof AiUsageBreakdown.Type
export const AiUsageBreakdown = Schema.Struct({
	costUsd: Schema.Finite,
	estimatedCalls: Schema.Finite,
	spendSource: SpendSource,
	unknownCostCalls: Schema.Finite
})
export type AiUsageReport = typeof AiUsageReport.Type
export const AiUsageReport = Schema.Struct({
	series: Schema.Array(Schema.Struct({at: DateTimeUtcFromFiniteMillis, ...AiUsageBreakdown.fields})),
	totals: Schema.Array(AiUsageBreakdown)
})
type Billing = typeof Billing.Type
const Billing = Schema.Struct({billing_source: SpendSource, estimated: Schema.optional(Schema.Boolean)})
type InputTokenDetails = typeof InputTokenDetails.Type
const InputTokenDetails = Schema.Struct({
	cache_write_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
	cached_tokens: Schema.OptionFromOptionalKey(Schema.Finite)
})
type OpenAiResponse = typeof OpenAiResponse.Type
const OpenAiResponse = Schema.Struct({
	model: Schema.OptionFromOptionalKey(AiModelId),
	usage: Schema.OptionFromOptionalKey(
		Schema.OptionFromNullOr(
			Schema.Struct({
				input_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
				input_tokens_details: Schema.OptionFromOptionalKey(InputTokenDetails),
				output_tokens: Schema.OptionFromOptionalKey(Schema.Finite)
			})
		)
	)
})
export const Usage = Schema.Struct({
	cost: Schema.OptionFromOptionalKey(Schema.Finite),
	message: Schema.OptionFromOptionalKey(
		Schema.Struct({
			model: Schema.OptionFromOptionalKey(AiModelId),
			usage: Schema.OptionFromOptionalKey(
				Schema.Struct({
					cache_creation_input_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
					cache_read_input_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
					cost: Schema.OptionFromOptionalKey(Schema.Finite),
					input_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
					opencode: Schema.OptionFromOptionalKey(Billing),
					output_tokens: Schema.OptionFromOptionalKey(Schema.Finite)
				})
			)
		})
	),
	model: Schema.OptionFromOptionalKey(AiModelId),
	modelVersion: Schema.OptionFromOptionalKey(AiModelId),
	response: Schema.OptionFromOptionalKey(OpenAiResponse),
	usage: Schema.OptionFromOptionalKey(
		Schema.OptionFromNullOr(
			Schema.Struct({
				cache_creation_input_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
				cache_read_input_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
				completion_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
				cost: Schema.OptionFromOptionalKey(Schema.Finite),
				input_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
				input_tokens_details: Schema.OptionFromOptionalKey(InputTokenDetails),
				opencode: Schema.OptionFromOptionalKey(Billing),
				output_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
				prompt_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
				prompt_tokens_details: Schema.OptionFromOptionalKey(InputTokenDetails)
			})
		)
	),
	usageMetadata: Schema.OptionFromOptionalKey(
		Schema.Struct({
			cachedContentTokenCount: Schema.OptionFromOptionalKey(Schema.Finite),
			candidatesTokenCount: Schema.OptionFromOptionalKey(Schema.Finite),
			cost: Schema.OptionFromOptionalKey(Schema.Finite),
			opencode: Schema.OptionFromOptionalKey(Billing),
			promptTokenCount: Schema.OptionFromOptionalKey(Schema.Finite),
			thoughtsTokenCount: Schema.OptionFromOptionalKey(Schema.Finite)
		})
	)
})
