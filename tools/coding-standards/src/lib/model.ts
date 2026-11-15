import {AnthropicClient, AnthropicLanguageModel} from '@effect/ai-anthropic'

import {Config, Effect, Schema} from 'effect'

export class JudgeError extends Schema.TaggedError<JudgeError>()('JudgeError', {message: Schema.String}) {}

export const MODEL = 'claude-haiku-5-5'

// Gateway names the worker's tailnet owner and resolves their connected Anthropic Console URL; no catalogue balance is used.
export const haiku = Effect.gen(function* () {
	const client = yield* AnthropicClient.make({
		apiUrl: `https://gateway.${yield* Config.String('DESLOP_DOMAIN')}/ai/connection`
	})
	return yield* Effect.provideService(
		AnthropicLanguageModel.make({config: {max_tokens: 1024}, model: MODEL}),
		AnthropicClient.AnthropicClient,
		client
	)
})
