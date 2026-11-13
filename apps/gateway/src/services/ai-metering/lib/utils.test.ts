import {assert, it} from '@effect/vitest'

import {Option, Result, Schema} from 'effect'

import {readUsage} from './utils.ts'

import {AiUsageEntry} from '#services/ai-metering/schema.ts'

const EMPTY = Schema.decodeSync(AiUsageEntry)({
	at: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	costSource: 'unknown',
	estimated: false,
	inputTokens: 0,
	outputTokens: 0
})

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

it('names who billed a call only from what its response reports', () => {
	assert.isTrue(Option.isNone(Result.getOrThrow(readUsage('{"usage":{"input_tokens":1}}', EMPTY)).spendSource))
	const billed = Result.getOrThrow(
		readUsage('{"usage":{"cost":0.5,"opencode":{"billing_source":"byok","estimated":true}}}', EMPTY)
	)
	assert.deepStrictEqual(billed.spendSource, Option.some('byok'))
})
