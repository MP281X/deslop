import {assert, it} from '@effect/vitest'

import {Array, Option, Result, Schema, pipe} from 'effect'

import {readUsage, totalsOf} from './response.ts'

import {AiUsageEntry} from '#server/ai-metering/schema.ts'

function usageEntry(...args: Parameters<typeof readUsage>) {
	return Result.map(readUsage(...args), value => value.entry)
}

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
		usageEntry('{"usage":{"input_tokens":10,"cache_read_input_tokens":100,"output_tokens":5}}', EMPTY)
	)
	const completions = Result.getOrThrow(
		usageEntry(
			'{"usage":{"prompt_tokens":110,"prompt_tokens_details":{"cached_tokens":100},"completion_tokens":5}}',
			EMPTY
		)
	)
	for (const entry of [messages, completions]) {
		assert.deepInclude(entry, {cacheReadTokens: 100, inputTokens: 10, outputTokens: 5})
	}
})

it('names who billed a call only from what its response reports', () => {
	assert.isTrue(Option.isNone(Result.getOrThrow(usageEntry('{"usage":{"input_tokens":1}}', EMPTY)).spendSource))
	const billed = Result.getOrThrow(
		usageEntry('{"usage":{"cost":0.5,"opencode":{"billing_source":"byok","estimated":true}}}', EMPTY)
	)
	assert.deepStrictEqual(billed.spendSource, Option.some('byok'))
})

it('estimates direct Anthropic Messages usage for its payer across streaming updates', () => {
	const start = Result.getOrThrow(
		usageEntry(
			'{"message":{"model":"claude-haiku-5-5","usage":{"input_tokens":10,"cache_read_input_tokens":100,"cache_creation_input_tokens":20,"output_tokens":1}}}',
			EMPTY,
			'anthropic'
		)
	)
	const end = Result.getOrThrow(usageEntry('{"usage":{"output_tokens":5}}', start, 'anthropic'))
	assert.deepStrictEqual(end.spendSource, Option.some('byok'))
	assert.deepInclude(end, {costSource: 'estimated', estimated: true, inputTokens: 10, outputTokens: 5})
	assert.closeTo(Option.getOrThrow(end.costUsd), 0.000007, 1e-12)
	const long = Result.getOrThrow(
		usageEntry('{"model":"claude-haiku-5-5","usage":{"input_tokens":100001,"output_tokens":5}}', EMPTY, 'anthropic')
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
			usageEntry(Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))(body), EMPTY, 'openai')
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
		usageEntry('{"response":{"model":"gpt-6.1-terra","usage":null},"type":"response.created"}', EMPTY, 'openai')
	)
	assert.deepStrictEqual(start.spendSource, Option.none())
	assert.strictEqual(start.costSource, 'unknown')
	const end = Result.getOrThrow(
		usageEntry('{"response":{"usage":{"input_tokens":272001,"output_tokens":2}}}', start, 'openai')
	)
	assert.closeTo(Option.getOrThrow(end.costUsd), 0.544017, 1e-12)
	assert.deepStrictEqual(Result.getOrThrow(usageEntry('[DONE]', end, 'openai')), end)
	const unknown = Result.getOrThrow(
		usageEntry('{"model":"unpriced-model","usage":{"input_tokens":10,"output_tokens":5}}', EMPTY, 'openai')
	)
	assert.deepInclude(unknown, {costSource: 'unknown', estimated: true, inputTokens: 10, outputTokens: 5})
	assert.deepStrictEqual(unknown.costUsd, Option.none())
})

it('settles Anthropic usage only at message_stop, so a stream that breaks off or errors stays incomplete', () => {
	const events = [
		'{"type":"message_start","message":{"model":"claude-haiku-5-5","usage":{"input_tokens":10,"output_tokens":1}}}',
		'{"type":"message_delta","usage":{"output_tokens":5}}',
		'{"type":"message_stop"}'
	]
	assert.deepStrictEqual(
		pipe(
			events,
			Array.scan({entry: EMPTY, finalUsage: false}, (state, text) =>
				Result.getOrThrow(readUsage(text, state.entry, 'anthropic'))
			),
			Array.map(state => state.finalUsage)
		),
		[false, false, false, true]
	)
	assert.isFalse(
		Result.getOrThrow(readUsage('{"type":"error","error":{"type":"overloaded_error"}}', EMPTY, 'anthropic')).finalUsage
	)
	const whole = readUsage(
		'{"type":"message","model":"claude-haiku-5-5","usage":{"input_tokens":10,"output_tokens":5}}',
		EMPTY,
		'anthropic'
	)
	assert.isTrue(Result.getOrThrow(whole).finalUsage)
})

it("sums a report's totals per payer from the same buckets its sparkline draws", () => {
	const bucket = {costUsd: 0.5, estimatedCalls: 1, spendSource: 'openai', unknownCostCalls: 0} as const
	assert.deepStrictEqual(
		totalsOf([bucket, {...bucket, costUsd: 0.25, unknownCostCalls: 1}, {...bucket, spendSource: 'balance'}]),
		[
			{costUsd: 0.5, estimatedCalls: 1, spendSource: 'balance', unknownCostCalls: 0},
			{costUsd: 0.75, estimatedCalls: 2, spendSource: 'openai', unknownCostCalls: 1}
		]
	)
})
