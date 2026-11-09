import {assert, it} from '@effect/vitest'

import {Result} from 'effect'

import type {AiUsageEntry} from '#services/ai/schema.ts'
import {readUsage} from '#services/ai/usage.ts'

const EMPTY: AiUsageEntry = {
	app: 'https://stash.mp281x.xyz',
	at: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	costSource: 'unknown',
	inputTokens: 0,
	outputTokens: 0,
	provider: 'opencode-zen'
}

it('counts cached tokens once whichever response shape a provider returns', () => {
	const messages = Result.getOrThrow(
		readUsage('{"usage":{"input_tokens":10,"cache_read_input_tokens":100,"output_tokens":5}}', EMPTY)
	)
	const completions = Result.getOrThrow(
		readUsage(
			'{"usage":{"prompt_tokens":110,"prompt_tokens_details":{"cached_tokens":100},"completion_tokens":5}}',
			EMPTY
		)
	)
	for (const entry of [messages, completions]) {
		assert.deepInclude(entry, {cacheReadTokens: 100, inputTokens: 10, outputTokens: 5})
	}
})
