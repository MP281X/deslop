import {Boolean, Function, Number, Option, Record, Result, Schema, String, pipe} from 'effect'

import {Usage} from '#services/ai-metering/schema.ts'
import type {AiUsageEntry} from '#services/ai-metering/schema.ts'
import type {AiProvider} from '#services/ai-proxy/schema.ts'

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

export function readUsage(text: string, entry: AiUsageEntry, provider: AiProvider = 'opencode') {
	if (String.isEmpty(String.trim(text)) || text === '[DONE]') return Result.succeed(entry)
	return Result.map(Schema.decodeResult(Schema.fromJsonString(Usage))(text), decoded => {
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
		const inputRate = Boolean.match(
			current.inputTokens + current.cacheReadTokens + current.cacheWriteTokens > 100_000,
			{onFalse: Function.constant(0.1), onTrue: Function.constant(0.5)}
		)
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
	})
}
