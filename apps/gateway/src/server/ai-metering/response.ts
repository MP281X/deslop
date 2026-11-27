import {Array, Boolean, Function, Number, Option, Record, Result, Schema, String, pipe} from 'effect'

import {SpendSource} from '#contracts'
import type {AiProvider, AiUsageBreakdown} from '#contracts'

import {Usage} from '#server/ai-metering/schema.ts'
import type {AiUsageEntry} from '#server/ai-metering/schema.ts'

// OpenAI's standard USD per million tokens (developers.openai.com/api/docs/pricing), checked 2026-11-15.
const OPENAI_RATES: Record<string, {cached: number; input: number; longContext: boolean; output: number}> = {
	'gpt-4.1': {cached: 0.5, input: 2, longContext: false, output: 8},
	'gpt-4.1-mini': {cached: 0.1, input: 0.4, longContext: false, output: 1.6},
	'gpt-4o': {cached: 1.25, input: 2.5, longContext: false, output: 10},
	'gpt-4o-mini': {cached: 0.075, input: 0.15, longContext: false, output: 0.6},
	'gpt-5-mini': {cached: 0.025, input: 0.25, longContext: false, output: 2},
	'gpt-5-nano': {cached: 0.005, input: 0.05, longContext: false, output: 0.4},
	'gpt-6.1-sol': {cached: 0.1, input: 2, longContext: true, output: 10},
	'gpt-6.1-terra': {cached: 0.05, input: 1, longContext: true, output: 5}
}

function usageOf(decoded: Usage, entry: AiUsageEntry, provider: AiProvider) {
	const usage = Option.flatten(decoded.usage)
	const messageUsage = Option.flatMap(decoded.message, message => message.usage)
	const responseUsage = Option.flatMap(decoded.response, response => Option.flatten(response.usage))
	const details = pipe(
		Option.flatMap(usage, value => value.prompt_tokens_details),
		Option.orElse(() => Option.flatMap(usage, value => value.input_tokens_details)),
		Option.orElse(() => Option.flatMap(responseUsage, value => value.input_tokens_details))
	)
	const billing = pipe(
		Option.flatMap(usage, value => value.opencode),
		Option.orElse(() => Option.flatMap(messageUsage, value => value.opencode)),
		Option.orElse(() => Option.flatMap(decoded.usageMetadata, value => value.opencode))
	)
	const cacheReadTokens = pipe(
		Option.flatMap(usage, value => value.cache_read_input_tokens),
		Option.orElse(() => Option.flatMap(messageUsage, value => value.cache_read_input_tokens)),
		Option.orElse(() => Option.flatMap(details, value => value.cached_tokens)),
		Option.orElse(() => Option.flatMap(decoded.usageMetadata, value => value.cachedContentTokenCount)),
		Option.getOrElse(() => entry.cacheReadTokens)
	)
	const cacheWriteTokens = pipe(
		Option.flatMap(usage, value => value.cache_creation_input_tokens),
		Option.orElse(() => Option.flatMap(messageUsage, value => value.cache_creation_input_tokens)),
		Option.orElse(() => Option.flatMap(details, value => value.cache_write_tokens)),
		Option.getOrElse(() => entry.cacheWriteTokens)
	)
	const cost = pipe(
		usage,
		Option.flatMap(value => value.cost),
		Option.orElse(() => Option.flatMap(messageUsage, value => value.cost)),
		Option.orElse(() => Option.flatMap(decoded.usageMetadata, value => value.cost)),
		Option.orElse(() => decoded.cost)
	)
	const current: AiUsageEntry = {
		...entry,
		cacheReadTokens,
		cacheWriteTokens,
		costSource: Option.match(cost, {onNone: () => entry.costSource, onSome: Function.constant('provider' as const)}),
		costUsd: Option.orElse(cost, () => entry.costUsd),
		estimated: Option.match(billing, {onNone: () => entry.estimated, onSome: value => value.estimated === true}),
		// Anthropic input excludes cached tokens; OpenAI Responses and Chat Completions include them.
		inputTokens: pipe(
			Option.flatMap(usage, value => value.input_tokens),
			Option.orElse(() => Option.flatMap(responseUsage, value => value.input_tokens)),
			Option.map(input => {
				if (provider === 'openai') return Number.max(0, input - cacheReadTokens - cacheWriteTokens)
				return input
			}),
			Option.orElse(() => Option.flatMap(messageUsage, value => value.input_tokens)),
			Option.orElse(() =>
				pipe(
					usage,
					Option.flatMap(value => value.prompt_tokens),
					Option.map(prompt => Number.max(0, prompt - cacheReadTokens - cacheWriteTokens))
				)
			),
			Option.orElse(() =>
				pipe(
					decoded.usageMetadata,
					Option.flatMap(value => value.promptTokenCount),
					Option.map(prompt => Number.max(0, prompt - cacheReadTokens))
				)
			),
			Option.getOrElse(() => entry.inputTokens)
		),
		model: pipe(
			decoded.model,
			Option.orElse(() => Option.flatMap(decoded.response, response => response.model)),
			Option.orElse(() => decoded.modelVersion),
			Option.orElse(() => Option.flatMap(decoded.message, value => value.model)),
			Option.orElse(() => entry.model)
		),
		outputTokens: pipe(
			Option.flatMap(usage, value => value.output_tokens),
			Option.orElse(() => Option.flatMap(responseUsage, value => value.output_tokens)),
			Option.orElse(() => Option.flatMap(messageUsage, value => value.output_tokens)),
			Option.orElse(() => Option.flatMap(usage, value => value.completion_tokens)),
			Option.orElse(() =>
				Option.map(
					decoded.usageMetadata,
					value =>
						Option.getOrElse(value.candidatesTokenCount, Function.constant(0)) +
						Option.getOrElse(value.thoughtsTokenCount, Function.constant(0))
				)
			),
			Option.getOrElse(() => entry.outputTokens)
		),
		spendSource: pipe(
			billing,
			Option.map(value => value.billing_source),
			Option.orElse(() => entry.spendSource)
		)
	}
	if (provider === 'openai') {
		const rates = Option.flatMap(current.model, model => Record.get(OPENAI_RATES, model))
		const hasTokens =
			Option.exists(
				usage,
				value =>
					(Option.isSome(value.input_tokens) || Option.isSome(value.prompt_tokens)) &&
					(Option.isSome(value.output_tokens) || Option.isSome(value.completion_tokens))
			) ||
			Option.exists(responseUsage, value => Option.isSome(value.input_tokens) && Option.isSome(value.output_tokens))
		if (!hasTokens) return current
		const estimatedCost = pipe(
			rates,
			Option.filter(() => hasTokens),
			Option.map(rate => {
				const long = rate.longContext && current.inputTokens + cacheReadTokens + cacheWriteTokens > 272_000
				// GPT-6.1 prompts above 272K input tokens double input and cache rates and multiply output by 1.5.
				return (
					((current.inputTokens * rate.input + cacheReadTokens * rate.cached + cacheWriteTokens * rate.input * 1.25) *
						Boolean.match(long, {onFalse: Function.constant(1), onTrue: Function.constant(2)}) +
						current.outputTokens *
							rate.output *
							Boolean.match(long, {onFalse: Function.constant(1), onTrue: Function.constant(1.5)})) /
					1_000_000
				)
			})
		)
		// Events without final usage retain the last complete estimate, never turn it into zero spend.
		return {
			...current,
			costSource: Option.match(estimatedCost, {
				onNone: () => entry.costSource,
				onSome: Function.constant('estimated' as const)
			}),
			costUsd: Option.orElse(estimatedCost, () => entry.costUsd),
			estimated: true,
			spendSource: Option.some('openai' as const)
		}
	}
	if (provider !== 'anthropic' || (Option.isNone(usage) && Option.isNone(messageUsage))) return current
	// Standard Messages rates: https://platform.claude.com/docs/en/about-claude/pricing
	const priced = Option.exists(current.model, model => model === 'claude-haiku-5-5')
	const inputRate = Boolean.match(current.inputTokens + current.cacheReadTokens + current.cacheWriteTokens > 100_000, {
		onFalse: Function.constant(0.1),
		onTrue: Function.constant(0.5)
	})
	return {
		...current,
		costSource: Boolean.match(priced, {
			onFalse: Function.constant('unknown' as const),
			onTrue: Function.constant('estimated' as const)
		}),
		costUsd: Option.liftPredicate(
			((current.inputTokens +
				current.cacheReadTokens * 0.1 +
				current.cacheWriteTokens * 1.25 +
				current.outputTokens * 5) *
				inputRate) /
				1_000_000,
			() => priced
		),
		estimated: true,
		spendSource: Option.some('byok' as const)
	}
}

// Whether this event settles the call's usage: Anthropic repeats cumulative counts until `message_stop`, and an in-band error before it leaves them partial.
function settles(decoded: Usage, provider: AiProvider) {
	if (provider === 'anthropic') {
		return (
			Option.contains(decoded.type, 'message_stop') ||
			(Option.contains(decoded.type, 'message') && Option.isSome(Option.flatten(decoded.usage)))
		)
	}
	return (
		Option.isSome(decoded.cost) ||
		Option.exists(
			Option.flatten(decoded.usage),
			usage => Option.isSome(usage.output_tokens) || Option.isSome(usage.completion_tokens) || Option.isSome(usage.cost)
		) ||
		Option.exists(decoded.response, response =>
			Option.exists(Option.flatten(response.usage), usage => Option.isSome(usage.output_tokens))
		) ||
		Option.exists(
			decoded.usageMetadata,
			usage => Option.isSome(usage.candidatesTokenCount) || Option.isSome(usage.cost)
		)
	)
}

export function readUsage(text: string, entry: AiUsageEntry, provider: AiProvider = 'opencode') {
	if (String.isEmpty(String.trim(text)) || text === '[DONE]') return Result.succeed({entry, finalUsage: false})
	return Result.map(Schema.decodeResult(Schema.fromJsonString(Usage))(text), decoded => ({
		entry: usageOf(decoded, entry, provider),
		finalUsage: settles(decoded, provider)
	}))
}

// A report's totals per payer, summed from its buckets.
export function totalsOf(series: readonly AiUsageBreakdown[]) {
	const payers = Array.groupBy(series, bucket => bucket.spendSource)
	return Array.getSomes(
		Array.map(SpendSource.literals, spendSource =>
			Option.map(Option.fromUndefinedOr(payers[spendSource]), buckets => ({
				costUsd: Number.sumAll(Array.map(buckets, bucket => bucket.costUsd)),
				estimatedCalls: Number.sumAll(Array.map(buckets, bucket => bucket.estimatedCalls)),
				spendSource,
				unknownCostCalls: Number.sumAll(Array.map(buckets, bucket => bucket.unknownCostCalls))
			}))
		)
	)
}
