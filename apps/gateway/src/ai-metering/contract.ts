import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'
import {Model} from 'effect/schema'

import {AiModelId} from '@deslop/runtime/shared/ai'
import {AuthError, RpcAuth, User} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis, TimeFrame} from '@deslop/runtime/shared/time'

import {UsageRange} from '#usage/contract.ts'

export type SpendSource = typeof SpendSource.Type
export const SpendSource = Schema.Literals(['balance', 'byok', 'openai', 'free', 'go', 'go-plus'])

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

export type AiUsageWindow = typeof AiUsageWindow.Type
export const AiUsageWindow = Schema.Struct({range: UsageRange, report: AiUsageReport})

export const AiMeteringRpcs = RpcGroup.make(
	Rpc.make('ai-metering.usage', {error: AuthError, payload: TimeFrame, stream: true, success: AiUsageWindow})
).middleware(RpcAuth)

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

export type AiUsageQuery = typeof AiUsageQuery.Type
// What a period's report reads of a person's calls.
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

export type Billing = typeof Billing.Type
export const Billing = Schema.Struct({billing_source: SpendSource, estimated: Schema.optional(Schema.Boolean)})
export type InputTokenDetails = typeof InputTokenDetails.Type
export const InputTokenDetails = Schema.Struct({
	cache_write_tokens: Schema.OptionFromOptionalKey(Schema.Finite),
	cached_tokens: Schema.OptionFromOptionalKey(Schema.Finite)
})
export type OpenAiResponse = typeof OpenAiResponse.Type
export const OpenAiResponse = Schema.Struct({
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
	// The event or object kind: Anthropic's usage is final only at `message_stop`, or on a whole `message`.
	type: Schema.OptionFromOptionalKey(Schema.String),
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
