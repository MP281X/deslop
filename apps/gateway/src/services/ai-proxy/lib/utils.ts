import {Boolean, Number, Option, Result, Schema, String} from 'effect'

import {Usage} from '#services/ai-proxy/schema.ts'
import type {AiUsageEntry} from '#services/ai-proxy/schema.ts'

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
			// Input is counted without cached tokens, as Anthropic's messages report it; chat completions' prompt_tokens include them, whichever provider serves the shape.
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
