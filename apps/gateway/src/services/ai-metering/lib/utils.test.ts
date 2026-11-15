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

it('estimates direct Anthropic Messages usage for its payer across streaming updates', () => {
	const start = Result.getOrThrow(
		readUsage(
			'{"message":{"model":"claude-haiku-5-5","usage":{"input_tokens":10,"cache_read_input_tokens":100,"cache_creation_input_tokens":20,"output_tokens":1}}}',
			EMPTY,
			'anthropic'
		)
	)
	const end = Result.getOrThrow(readUsage('{"usage":{"output_tokens":5}}', start, 'anthropic'))
	assert.deepStrictEqual(end.spendSource, Option.some('byok'))
	assert.deepInclude(end, {costSource: 'estimated', estimated: true, inputTokens: 10, outputTokens: 5})
	assert.closeTo(Option.getOrThrow(end.costUsd), 0.000007, 1e-12)
	const long = Result.getOrThrow(
		readUsage('{"model":"claude-haiku-5-5","usage":{"input_tokens":100001,"output_tokens":5}}', EMPTY, 'anthropic')
	)
	assert.closeTo(Option.getOrThrow(long.costUsd), 0.050013, 1e-12)
})

it('estimates OpenAI Chat Completions and Responses with cached input counted once', () => {
	const responses = {
		model: 'gpt-6.1-terra',
		usage: {input_tokens: 130, input_tokens_details: {cache_write_tokens: 20, cached_tokens: 100}, output_tokens: 5}
	}
	const completions = {
		model: 'gpt-6.1-terra',
		usage: {
			completion_tokens: 5,
			prompt_tokens: 130,
			prompt_tokens_details: {cache_write_tokens: 20, cached_tokens: 100}
		}
	}
	for (const body of [responses, completions, {response: responses, type: 'response.completed'}]) {
		const entry = Result.getOrThrow(
			readUsage(Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))(body), EMPTY, 'openai')
		)
		assert.deepStrictEqual(entry.spendSource, Option.some('openai'))
		assert.deepInclude(entry, {
			cacheReadTokens: 100,
			cacheWriteTokens: 20,
			costSource: 'estimated',
			estimated: true,
			inputTokens: 10,
			outputTokens: 5
		})
		assert.closeTo(Option.getOrThrow(entry.costUsd), 0.000065, 1e-12)
	}
})

it('keeps OpenAI streaming spend incomplete until usage arrives and retains the final estimate', () => {
	const start = Result.getOrThrow(
		readUsage('{"response":{"model":"gpt-6.1-terra","usage":null},"type":"response.created"}', EMPTY, 'openai')
	)
	assert.deepStrictEqual(start.spendSource, Option.some('openai'))
	assert.strictEqual(start.costSource, 'unknown')
	const end = Result.getOrThrow(
		readUsage('{"response":{"usage":{"input_tokens":272001,"output_tokens":2}}}', start, 'openai')
	)
	assert.closeTo(Option.getOrThrow(end.costUsd), 0.544017, 1e-12)
	assert.deepStrictEqual(Result.getOrThrow(readUsage('[DONE]', end, 'openai')), end)
	const unknown = Result.getOrThrow(
		readUsage('{"model":"unpriced-model","usage":{"input_tokens":10,"output_tokens":5}}', EMPTY, 'openai')
	)
	assert.deepInclude(unknown, {costSource: 'unknown', estimated: true, inputTokens: 10, outputTokens: 5})
	assert.deepStrictEqual(unknown.costUsd, Option.none())
})
