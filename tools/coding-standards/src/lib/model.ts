import {AnthropicClient, AnthropicLanguageModel} from '@effect/ai-anthropic'

import {Config, Effect, Schema} from 'effect'

export class JudgeError extends Schema.TaggedError<JudgeError>()('JudgeError', {message: Schema.String}) {}

export const MODEL = 'claude-haiku-5-5'

// Gateway names the worker's tailnet owner and sends Claude to Anthropic with that person's saved Anthropic key; no catalogue balance is used.
export const haiku = Effect.gen(function* () {
	const client = yield* AnthropicClient.make({
		apiUrl: `https://gateway.${yield* Config.String('DESLOP_DOMAIN')}/ai/anthropic`
	})
	return yield* Effect.provideService(
		AnthropicLanguageModel.make({config: {max_tokens: 4096}, model: MODEL}),
		AnthropicClient.AnthropicClient,
		client
	)
})
