import {AnthropicClient, AnthropicLanguageModel} from '@effect/ai-anthropic'

import {Effect, Redacted} from 'effect'

import {HttpClient, HttpClientRequest} from 'effect/http'

import {accessToken, origins} from '#lib/session.ts'

export const MODEL = 'claude-haiku-5-5'

// Gateway resolves the signed-in person's connected Anthropic Console URL; no catalogue balance is used.
const API_URL = `${origins.gateway}/ai/connection`

export const haiku = Effect.gen(function* () {
	const token = yield* accessToken
	const client = yield* AnthropicClient.make({
		apiUrl: API_URL,
		transformClient: underlying =>
			HttpClient.mapRequest(underlying, HttpClientRequest.bearerToken(Redacted.value(token)))
	})
	return yield* Effect.provideService(
		AnthropicLanguageModel.make({config: {max_tokens: 1024}, model: MODEL}),
		AnthropicClient.AnthropicClient,
		client
	)
})
