import {Boolean, Function, Number, Option, Result, Schema, String, pipe} from 'effect'

import {Usage} from '#services/ai-metering/schema.ts'
import type {AiUsageEntry} from '#services/ai-metering/schema.ts'
import type {AiProvider} from '#services/ai-proxy/schema.ts'

export function readUsage(text: string, entry: AiUsageEntry, provider: AiProvider = 'opencode') {
	if (String.isEmpty(String.trim(text)) || text === '[DONE]') return Result.succeed(entry)
	return Result.map(Schema.decodeResult(Schema.fromJsonString(Usage))(text), decoded => {
		const usage = Option.flatten(decoded.usage)
		const messageUsage = Option.flatMap(decoded.message, message => message.usage)
		const details = Option.flatMap(usage, value => value.prompt_tokens_details)
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
			// Input is counted without cached tokens, as Anthropic's messages report it; chat completions' prompt_tokens include them, whichever provider serves the shape.
			inputTokens: pipe(
				Option.flatMap(usage, value => value.input_tokens),
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
				Option.orElse(() => decoded.modelVersion),
				Option.orElse(() => Option.flatMap(decoded.message, value => value.model)),
				Option.orElse(() => entry.model)
			),
			outputTokens: pipe(
				Option.flatMap(usage, value => value.output_tokens),
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
