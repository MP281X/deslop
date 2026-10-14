// @effect-diagnostics-next-line nodeBuiltinImport:off -- The collector reads a real SQLite database.
import {DatabaseSync} from 'node:sqlite'

import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Effect, FileSystem, Option, Path, Schema, pipe} from 'effect'

import {Transcript} from '#schema'

import {collect, recordRun} from '#lib/collect'
import {cleanup, parseCases, prepare, Settings, command} from '#lib/prepare'
import {blindText, measure} from '#lib/utils'

it('keeps usage categories separate and deduplicates streamed Claude messages', () => {
	const records = Schema.decodeSync(Schema.fromJsonString(Transcript))(`[
		{"type":"assistant","message":{"id":"m1","content":[],"usage":{"input_tokens":10,"cache_read_input_tokens":20,"cache_creation_input_tokens":3,"output_tokens":1}}},
		{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"Ready."}],"usage":{"input_tokens":10,"cache_read_input_tokens":20,"cache_creation_input_tokens":3,"output_tokens":4,"output_tokens_details":{"thinking_tokens":2}}}}
	]`)
	const metrics = measure(records)
	assert.strictEqual(metrics.inputTokens, 10)
	assert.strictEqual(metrics.cachedInputTokens, 20)
	assert.strictEqual(metrics.cacheWriteTokens, 3)
	assert.strictEqual(metrics.outputTokens, 4)
	assert.strictEqual(metrics.reasoningTokens, 2)
	assert.strictEqual(metrics.reply, 'Ready.')
})

it('does not add cumulative Codex snapshots or treat progress as a final reply', () => {
	const records = Schema.decodeSync(Schema.fromJsonString(Transcript))(`[
		{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":5,"output_tokens":2}}}},
		{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":30,"cached_input_tokens":15,"output_tokens":8}}}},
		{"type":"response_item","payload":{"type":"message","role":"assistant","phase":"commentary","content":[{"type":"output_text","text":"Working."}]}},
		{"type":"response_item","payload":{"type":"function_call","call_id":"c1","name":"exec","arguments":"tools.exec_command({cmd:'cat README.md'})"}}
	]`)
	const metrics = measure(records)
	assert.strictEqual(metrics.inputTokens, 30)
	assert.strictEqual(metrics.cachedInputTokens, 15)
	assert.strictEqual(metrics.outputTokens, 8)
	assert.strictEqual(metrics.reply, '')
	assert.strictEqual(metrics.toolCalls, 1)
	assert.isNull(metrics.editCalls)
	assert.isNull(metrics.repeatedReadRequests)
	assert.isNull(metrics.correctiveEdits)
})

it('classifies Claude tool-turn text and its streamed fragments as commentary', () => {
	const metrics = measure(
		Schema.decodeSync(Schema.fromJsonString(Transcript))(`[
		{"type":"assistant","message":{"id":"work","content":[{"type":"text","text":"Now the next file."}],"stop_reason":null}},
		{"type":"assistant","message":{"id":"work","content":[{"type":"tool_use","id":"read","name":"Read","input":{}}],"stop_reason":"tool_use"}},
		{"type":"assistant","message":{"content":[{"type":"text","text":"Still working."},{"type":"tool_use","id":"grep","name":"Grep","input":{}}]}},
		{"type":"assistant","message":{"id":"final","content":[{"type":"text","text":"The importer keeps completed records."}],"stop_reason":"end_turn"}}
	]`)
	)
	assert.deepStrictEqual(
		Array.map(metrics.trace, event => event.kind),
		['commentary', 'call', 'commentary', 'call', 'reply']
	)
	assert.strictEqual(metrics.reply, 'The importer keeps completed records.')
	assert.strictEqual(metrics.toolCalls, 2)
	const stopped = measure(
		Schema.decodeSync(Schema.fromJsonString(Transcript))(`[
		{"type":"assistant","message":{"content":[{"type":"text","text":"Reading the next file."}],"stop_reason":"tool_use"}}
	]`)
	)
	assert.strictEqual(stopped.trace[0]?.kind, 'commentary')
	assert.strictEqual(stopped.reply, '')
})

it('uses per-record Codex usage when both usage formats exist', () => {
	const metrics = measure(
		Schema.decodeSync(Schema.fromJsonString(Transcript))(`[
		{"type":"token_usage_record","payload":{"usage":{"input_tokens":12,"cached_input_tokens":8,"output_tokens":3}}},
		{"type":"token_usage_record","payload":{"usage":{"input_tokens":18,"cached_input_tokens":10,"output_tokens":4}}},
		{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":30,"output_tokens":7}}}}
	]`)
	)
	assert.strictEqual(metrics.inputTokens, 30)
	assert.strictEqual(metrics.outputTokens, 7)
	assert.strictEqual(metrics.cachedInputTokens, 18)
})

it('retains the final assistant message across trailing results and distinguishes missing traces', () => {
	const metrics = measure(
		Schema.decodeSync(Schema.fromJsonString(Transcript))(`[
		{"type":"assistant","message":{"id":"reply","content":[{"type":"text","text":"First."},{"type":"text","text":"Second."}]}},
		{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"late","content":"data"}]}}
	]`)
	)
	assert.strictEqual(metrics.reply, 'First.\nSecond.')
	assert.isNull(measure([], false).toolCalls)
	assert.strictEqual(measure([]).toolCalls, 0)
})

it('pairs tool results by identity and leaves unobserved facts unavailable', () => {
	const metrics = measure(
		Schema.decodeSync(Schema.fromJsonString(Transcript))(`[
		{"type":"assistant","timestamp":"2026-10-13T10:00:00.000Z","message":{"content":[{"type":"tool_use","id":"a","name":"Read","input":{"path":"README.md"}}]}},
		{"type":"user","timestamp":"2026-10-13T10:00:00.300Z","message":{"content":[{"type":"tool_result","tool_use_id":"a","content":"data","is_error":false}]}},
		{"type":"assistant","message":{"content":[{"type":"tool_use","id":"b","name":"Read","input":{"path":"README.md"}}]}},
		{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"b","content":"failed","is_error":true}]}}
	]`)
	)
	assert.strictEqual(metrics.toolMilliseconds, 300)
	assert.strictEqual(metrics.explicitToolFailures, 1)
	assert.strictEqual(metrics.repeatedReadRequests, 1)
	assert.strictEqual(metrics.editCalls, 0)
	assert.isNull(metrics.inputTokens)
	assert.isNull(metrics.firstPassReady)
	assert.strictEqual(blindText('/tmp/eval/runs/candidate-codex/repo', '/tmp/eval'), 'EVAL/runs/RUN/repo')
})

it.effect('rejects duplicated criteria and preserves ordinary Markdown headings', () =>
	Effect.gen(function* () {
		const failure = yield* Effect.exit(
			parseCases('# Evals\n## import\n### Task\nDo it\n### Criteria\nA\n### Criteria\nB')
		)
		assert.isTrue(failure._tag === 'Failure')
		const cases = yield* parseCases('# Evals\n## import\n### Task\nDo it\n### Criteria\n### Behavior\nKeep records')
		assert.strictEqual(cases[0]?.criteria, '### Behavior\nKeep records')
	})
)

it.effect(
	'applies global base configuration, prepares one skill and preserves full T3 evidence',
	() =>
		pipe(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const home = yield* fs.makeTempDirectoryScoped()
				const root = path.resolve(import.meta.dirname, '../../..')
				yield* fs.makeDirectory(`${home}/.t3/userdata`, {recursive: true})
				yield* fs.makeDirectory(`${home}/.codex/rules`, {recursive: true})
				yield* fs.makeDirectory(`${home}/.claude/skills/unrelated`, {recursive: true})
				yield* fs.writeFileString(`${home}/.codex/rules/default.rules`, 'Keep')
				yield* fs.writeFileString(`${home}/.claude/skills/unrelated/SKILL.md`, 'Keep')
				const original = {colorTheme: 'dark', providerInstances: {user: {enabled: true}}} satisfies Settings
				yield* fs.writeFileString(
					`${home}/.t3/userdata/settings.json`,
					yield* Schema.encodeEffect(Schema.fromJsonString(Settings))(original)
				)
				const manifest = yield* prepare({
					harnesses: ['codex', 'claude'],
					home,
					root,
					skill: path.join(root, 'tools/coding-standards/skills/engineering')
				})
				assert.strictEqual(manifest.runs.length, 2)
				const run = Option.getOrThrow(Array.findFirst(manifest.runs, row => row.harness === 'codex'))
				yield* command(run.repo, 'vp', ['check'])
				assert.isFalse(yield* fs.exists(`${run.repo}/README.md`))
				assert.isFalse(yield* fs.exists(`${run.repo}/CODING_STANDARDS.md`))
				assert.strictEqual(yield* command(run.repo, 'git', ['ls-files', 'node_modules']), '')
				assert.include(yield* fs.readFileString(`${run.repo}/.gitignore`), 'node_modules/')
				assert.strictEqual(yield* fs.readFileString(`${home}/.codex/rules/default.rules`), 'Keep')
				assert.strictEqual(yield* fs.readFileString(`${home}/.claude/skills/unrelated/SKILL.md`), 'Keep')
				assert.strictEqual(
					yield* fs.readFileString(`${home}/.codex/instructions.md`),
					yield* fs.readFileString(path.join(root, '.codex/instructions.md'))
				)
				assert.deepStrictEqual(yield* fs.readDirectory(`${run.home}/skills`), ['engineering'])
				assert.isFalse(yield* fs.exists(`${run.home}/skills/engineering/EVALS.md`))
				assert.notInclude(yield* fs.readFileString(run.task), 'appropriate Effect primitives')
				assert.include(yield* fs.readFileString(`${run.repo}/package.json`), '"effect": "4.0.2"')
				assert.include(yield* fs.realPath(`${run.repo}/node_modules/effect`), run.repo)
				const review = yield* prepare({
					harnesses: ['codex'],
					home,
					root,
					skill: path.join(root, '.claude/skills/review')
				})
				const reviewRun = Option.getOrThrow(Array.head(review.runs))
				assert.include(yield* command(reviewRun.repo, 'git', ['diff']), "fs.glob('*.json'")
				assert.notInclude(yield* fs.readFileString(reviewRun.task), 'progress emitted before durable writes')
				const probe = `import {NodeServices} from '@effect/platform-node';
import {Effect, FileSystem, Layer, Stream, pipe} from 'effect';
import {Importer} from './src/service.ts';
const program = Effect.gen(function* () {
 const fs = yield* FileSystem.FileSystem;
 const importer = yield* Importer;
 const visible = yield* Stream.runCollect(pipe(importer.import('samples/one.json'), Stream.mapEffect(row => fs.exists('data/' + row.id + '.json'))));
 const nested = yield* Stream.runCollect(importer.import('samples/folder'));
 return {visible, nested: nested.length};
});
console.log(JSON.stringify(await Effect.runPromise(pipe(program, Effect.scoped, Effect.provide(Layer.provideMerge(Importer.layer, NodeServices.layer))))));`
				type Observation = typeof Observation.Type
				const Observation = Schema.Struct({nested: Schema.Finite, visible: Schema.Array(Schema.Boolean)})
				assert.deepStrictEqual(
					yield* Schema.decodeEffect(Schema.fromJsonString(Observation))(
						yield* command(reviewRun.repo, 'node', ['--input-type=module', '-e', probe])
					),
					{nested: 2, visible: [false, false]}
				)
				yield* fs.copyFile(
					path.join(root, 'tools/evals/starter/folder-import/src/service.ts'),
					`${reviewRun.repo}/src/service.ts`
				)
				yield* fs.remove(`${reviewRun.repo}/data`, {recursive: true})
				assert.deepStrictEqual(
					yield* Schema.decodeEffect(Schema.fromJsonString(Observation))(
						yield* command(reviewRun.repo, 'node', ['--input-type=module', '-e', probe])
					),
					{nested: 4, visible: [true, true]}
				)
				yield* cleanup(review.directory, home)
				yield* fs.remove(review.directory, {recursive: true})
				yield* recordRun(manifest.directory, run.id, 'thread-one')
				const database = yield* Effect.acquireRelease(
					Effect.try(() => new DatabaseSync(`${home}/.t3/userdata/statev2.sqlite`)),
					opened => Effect.sync(() => opened.close())
				)
				yield* Effect.try(() => {
					database.exec(
						'CREATE TABLE orchestration_v2_projection_runs (thread_id TEXT, ordinal INTEGER, provider_thread_id TEXT, status TEXT, requested_at TEXT, completed_at TEXT); CREATE TABLE orchestration_v2_projection_provider_threads (provider_thread_id TEXT, provider_instance_id TEXT, payload_json TEXT); CREATE TABLE orchestration_v2_projection_subagents (thread_id TEXT, child_thread_id TEXT);'
					)
					database
						.prepare('INSERT INTO orchestration_v2_projection_runs VALUES (?,1,?,?,?,?)')
						.run('thread-one', 'provider-one', 'completed', '2026-10-13T10:00:00Z', '2026-10-13T10:00:30Z')
					database
						.prepare('INSERT INTO orchestration_v2_projection_provider_threads VALUES (?,?,?)')
						.run('provider-one', run.instance, '{"nativeThreadRef":{"nativeId":"native-one"}}')
				})
				yield* fs.makeDirectory(`${run.home}/sessions`, {recursive: true})
				yield* fs.makeDirectory(`${home}/.t3/userdata/browser-artifacts`, {recursive: true})
				const capture = `${home}/.t3/userdata/browser-artifacts/phone.png`
				yield* fs.writeFileString(capture, 'Capture')
				yield* fs.writeFileString(
					`${run.home}/sessions/native-one.jsonl`,
					`{"type":"token_usage_record","payload":{"usage":{"input_tokens":12,"output_tokens":3}}}\n{"type":"response_item","payload":{"type":"message","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"![Phone](${capture})"}]}}\n`
				)
				yield* fs.writeFileString(`${run.repo}/feature.txt`, 'Change')
				yield* command(run.repo, 'git', ['add', 'feature.txt'])
				yield* command(run.repo, 'git', [
					'-c',
					'user.name=Eval',
					'-c',
					'user.email=eval@example.invalid',
					'commit',
					'-qm',
					'Add feature'
				])
				yield* command(run.repo, 'git', ['branch', 'feature/export'])
				const result = Option.getOrThrow(
					Array.findFirst(yield* collect(manifest.directory, home), row => row.status !== 'not-run')
				)
				if (!result.threads) return yield* Effect.die('Missing thread evidence')
				assert.strictEqual(result.threads[0]?.sessions[0]?.inputTokens, 12)
				assert.isNull(result.threads[0]?.sessions[0]?.firstPassReady)
				assert.include(yield* fs.readFileString(`${manifest.directory}/evidence/${run.id}/diff.patch`), 'Change')
				assert.isTrue(yield* fs.exists(`${manifest.directory}/judge/${result.judge}/branches/feature/export.patch`))
				assert.strictEqual(
					yield* fs.readFileString(`${manifest.directory}/judge/${result.judge}/reply.md`),
					'![Phone](repo/artifacts/phone.png)'
				)
				assert.strictEqual(
					yield* fs.readFileString(`${manifest.directory}/judge/${result.judge}/repo/artifacts/phone.png`),
					'Capture'
				)
				assert.strictEqual(
					yield* fs.readFileString(`${manifest.directory}/evidence/${run.id}/artifacts/phone.png`),
					'Capture'
				)
				const settings = yield* Schema.decodeEffect(Schema.fromJsonString(Settings))(
					yield* fs.readFileString(`${home}/.t3/userdata/settings.json`)
				)
				yield* fs.writeFileString(
					`${home}/.t3/userdata/settings.json`,
					yield* Schema.encodeEffect(Schema.fromJsonString(Settings))({
						...settings,
						contrast: 'high',
						providerInstances: {...settings.providerInstances, other: {enabled: true}}
					})
				)
				yield* cleanup(manifest.directory, home)
				assert.deepStrictEqual(
					yield* Schema.decodeEffect(Schema.fromJsonString(Settings))(
						yield* fs.readFileString(`${home}/.t3/userdata/settings.json`)
					),
					{...original, contrast: 'high', providerInstances: {...original.providerInstances, other: {enabled: true}}}
				)
				assert.isTrue(yield* fs.exists(`${manifest.directory}/report.json`))
				yield* fs.remove(manifest.directory, {recursive: true})
			}),
			// @effect-diagnostics-next-line strictEffectProvide:off -- This test owns platform and SQLite lifetimes.
			Effect.provide(NodeServices.layer)
		),
	{timeout: 60_000}
)
