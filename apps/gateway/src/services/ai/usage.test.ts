import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Effect, FileSystem, Path, Result, String} from 'effect'

import {makeUsage, readUsage} from './usage.ts'

import {report} from '#services/ai/lib/utils.ts'
import type {AiUsageEntry} from '#services/ai/schema.ts'

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

function metered(at: number, costUsd: number) {
	return {
		app: 'https://stash.mp281x.xyz',
		at,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		costSource: 'models.dev',
		costUsd,
		inputTokens: 10,
		model: 'test',
		outputTokens: 5,
		provider: 'anthropic'
	} satisfies AiUsageEntry
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

it.layer(NodeServices.layer)(test => {
	test.effect(
		'appends usage to day files and reads the same totals after restart',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const directory = yield* fs.makeTempDirectoryScoped()
			const stored = [metered(Date.UTC(2026, 9, 2, 12), 0.5), metered(Date.UTC(2026, 9, 3, 12), 0.25)]
			const range = {count: 3, from: Date.UTC(2026, 9, 1), size: 86_400_000, to: Date.UTC(2026, 9, 4)}
			const usage = yield* makeUsage(directory)
			yield* Effect.forEach(stored, entry => usage.save('github:1', entry), {concurrency: 1, discard: true})
			assert.deepEqual(yield* usage.read('github:1', range), report(stored, range))
			assert.deepEqual(
				Array.sort(yield* fs.readDirectory(path.join(directory, 'ai-usage', 'github%3A1')), String.Order),
				['2026-10-02.ndjson', '2026-10-03.ndjson']
			)
			const appended = metered(Date.UTC(2026, 9, 3, 18), 0.125)
			yield* usage.save('github:1', appended)
			const expected = report([...stored, appended], range)
			assert.deepEqual(yield* usage.read('github:1', range), expected)
			const restarted = yield* makeUsage(directory)
			assert.deepEqual(yield* restarted.read('github:1', range), expected)
		})
	)
})
