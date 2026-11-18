import {NodeServices} from '@effect/platform-node'
import {assert, describe, it} from '@effect/vitest'

import {Array, Effect, FileSystem, Path, Record, Result, Stream, String, pipe} from 'effect'

import {ChildProcess} from 'effect/process'

import {noUnrelatedJobs} from '#judge/no-unrelated-jobs.ts'
import {features} from '#lib/features.ts'
import {readSource} from '#lib/units.ts'

const IDENTITY = {
	GIT_AUTHOR_EMAIL: 'judge@example.com',
	GIT_AUTHOR_NAME: 'Judge',
	GIT_COMMITTER_EMAIL: 'judge@example.com',
	GIT_COMMITTER_NAME: 'Judge'
}

function componentSource(name: string) {
	return [
		`export function ${name}() {`,
		"\tconst [selected, setSelected] = useState('')",
		'\treturn (',
		'\t\t<div>',
		'\t\t\t<button onClick={() => setSelected(name)}>{selected}</button>',
		'\t\t</div>',
		'\t)',
		'}'
	]
}

function functionSource(name: string, suffix: string) {
	return [
		`export function ${name}(items: string[]) {`,
		'\tconst trimmed = Array.map(items, String.trim)',
		'\tconst kept = Array.filter(trimmed, String.isNonEmpty)',
		`\tconst tagged = Array.map(kept, item => item + '${suffix}')`,
		'\tconst sorted = Array.sort(tagged, String.Order)',
		'\treturn sorted',
		'}'
	]
}

// A failed git command fails the fixture, so no case runs against a half-made checkout.
const git = Effect.fnUntraced(function* (directory: string, args: string[]) {
	assert.strictEqual(
		yield* Effect.scoped(
			Effect.flatMap(
				ChildProcess.make('git', args, {cwd: directory, env: IDENTITY, extendEnv: true}),
				child => child.exitCode
			)
		),
		0,
		`git ${Array.join(args, ' ')}`
	)
})

const write = Effect.fnUntraced(function* (directory: string, files: Record<string, string[]>) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	yield* Effect.forEach(
		Record.toEntries(files),
		entry =>
			Effect.gen(function* () {
				yield* fs.makeDirectory(path.dirname(path.join(directory, entry[0])), {recursive: true})
				yield* fs.writeFileString(path.join(directory, entry[0]), Array.join(entry[1], '\n'))
			}),
		{concurrency: 'unbounded'}
	)
})

const checkout = Effect.fnUntraced(function* (files: Record<string, string[]>) {
	const fs = yield* FileSystem.FileSystem
	const directory = yield* fs.makeTempDirectoryScoped({prefix: 'coding-standards-checkout-'})
	yield* git(directory, ['init', '-q', '-b', 'main'])
	yield* write(directory, {'README.md': ['# Notes']})
	yield* git(directory, ['add', '-A'])
	yield* git(directory, ['commit', '-q', '-m', 'Start'])
	yield* git(directory, ['checkout', '-q', '-b', 'change'])
	yield* write(directory, files)
	yield* git(directory, ['add', '-A'])
	yield* git(directory, ['commit', '-q', '--allow-empty', '-m', 'Change'])
	return directory
})

// `misjudged` is the answer field of the question whose self-check the stub answers wrongly.
const fixture = Effect.fnUntraced(function* (misjudged: string = '') {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const home = yield* fs.makeTempDirectoryScoped({prefix: 'coding-standards-home-'})
	const run = Effect.fnUntraced(function* (directory: string, flags: string[] = []) {
		const child = yield* ChildProcess.make(
			'node',
			[
				'--input-type=module',
				'-e',
				Array.join(
					[
						`import {NodeCrypto, NodeRuntime, NodeServices} from '${import.meta.resolve('@effect/platform-node')}'`,
						`import {Array, Effect, Layer, Option, Record, Schema, Stream, String} from '${import.meta.resolve('effect')}'`,
						`import {LanguageModel, Response} from '${import.meta.resolve('effect/ai')}'`,
						`import {judge, layerCache} from '${path.join(import.meta.dirname, 'judge.ts')}'`,
						`import {QUESTIONS} from '${path.join(import.meta.dirname, 'lib/questions.ts')}'`,
						'const model = LanguageModel.make({',
						'generateText: options => Effect.gen(function* () {',
						"const system = options.prompt.content.find(message => message.role === 'system').content",
						"const text = options.prompt.content.find(message => message.role === 'user').content[0].text",
						'const state = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)))(text)',
						"const questions = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(system.slice(system.indexOf('\\n\\n') + 2))",
						"const code = state['code']",
						'const yes = Array.some(Record.values(QUESTIONS), question => code === question.yes.example)',
						'const no = Array.some(Record.values(QUESTIONS), question => code === question.no.example)',
						'const names = Record.keys(questions)',
						"const answered = code.includes('Partial') ? names.slice(1) : names",
						'const answers = Record.fromEntries(answered.map(name => {',
						`if (yes) return [name, name !== '${misjudged}']`,
						'if (no) return [name, false]',
						`if (name === '${misjudged}') throw new Error('An untrusted question was used')`,
						"return [name, name === 'view-state-in-memory' && (code.includes('Flagged') || code.includes('Ignored'))]",
						'}))',
						"const textAnswer = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({analysis: '', answers})",
						"return [Response.makePart('text', {text: textAnswer}), Response.makePart('finish', {reason: 'stop', usage: new Response.Usage({inputTokens: {total: 100, uncached: 100, cacheRead: 0, cacheWrite: 0}, outputTokens: {total: 10, text: 10, reasoning: 0}})})]",
						'}), streamText: () => Stream.empty',
						'})',
						`NodeRuntime.runMain(Effect.provide(judge({base: Option.some('main'), dryRun: ${Array.contains(flags, '--dry-run')}, userAsked: ${Array.contains(flags, '--user-asked')}}, model), Layer.provideMerge(layerCache, Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))))`
					],
					'\n'
				)
			],
			{
				cwd: directory,
				env: {HOME: home, XDG_CACHE_HOME: path.join(home, 'cache')},
				extendEnv: true,
				stderr: 'pipe',
				stdout: 'pipe'
			}
		)
		const output = yield* Effect.all(
			[
				Stream.mkString(Stream.decodeText(child.stdout)),
				Stream.mkString(Stream.decodeText(child.stderr)),
				child.exitCode
			],
			{concurrency: 'unbounded'}
		)
		return {exitCode: output[2], output: output[0] + output[1]}
	}, Effect.scoped)
	return {checkout, run, write}
})

describe('coding-standards judge', () => {
	it('asks jobs, not rule visitors or router and Layer composition callbacks', () => {
		const body = Array.join(
			['const one = read()', 'const two = other()', 'save(one)', 'report(two)', 'return one'],
			'\n'
		)
		const padding = String.repeat(151)('\n')
		const ruleImport = "import {defineRule} from 'vite-plus/lint/plugins'\n"
		const routerImport = "import {HttpRouter} from 'effect/http'\n"
		const layerImport = "import {Layer} from 'effect'\n"
		const sources = [
			{
				asked: false,
				code: `${ruleImport}defineRule({create: context => ({\nCallExpression: node => {\n${body}\n}\n})})`
			},
			{
				asked: false,
				code: `${ruleImport}defineRule({create: context => ({\n${padding}CallExpression: node => {\n${body}\n}\n})})`
			},
			{asked: false, code: `${routerImport}HttpRouter.use(router => Effect.gen(function* () {\n${body}\n}))`},
			{asked: false, code: `${layerImport}Layer.effect(Service, Effect.gen(function* () {\n${body}\n}))`},
			{asked: false, code: `${layerImport}Layer.unwrap(Effect.gen(function* () {\n${body}\n}))`},
			{asked: true, code: `${layerImport}Layer.succeed(Service, {read: () => {\n${body}\n}})`},
			{
				asked: true,
				code: `${ruleImport}defineRule({create: context => {\n${padding}const helpers = {read: () => {\n${body}\n}}\nreturn {}\n}})`
			},
			{
				asked: true,
				code: `${layerImport}Layer.effect(Service, Effect.gen(function* () {\n${padding}function job() {\n${body}\n}\n}))`
			},
			{
				asked: true,
				code: `${routerImport}HttpRouter.use(router => Effect.gen(function* () {\n${padding}function job() {\n${body}\n}\n}))`
			},
			{asked: true, code: `defineRule({create: context => ({\nCallExpression: node => {\n${body}\n}\n})})`},
			{asked: true, code: `function job() {\n${body}\n}`},
			{asked: true, code: `const text = 'defineRule HttpRouter.use Layer.effect';\nfunction job() {\n${body}\n}`}
		]
		for (const source of sources) {
			const parsed = Result.getOrThrow(readSource('source.ts', source.code))
			assert.isAbove(parsed.units.length, 0)
			for (const unit of parsed.units) {
				assert.strictEqual(
					noUnrelatedJobs.gate(features(unit.text, unit.imports, unit.composition)),
					source.asked,
					source.code
				)
			}
		}
	})

	it.layer(NodeServices.layer, {excludeTestServices: true})(test => {
		test.effect(
			'reports findings and distinguishes suppressed findings from stale ignores',
			Effect.fnUntraced(function* () {
				const f = yield* fixture()
				const ignore = '// judge-ignore no-view-state-in-memory -- selection is temporary in this embedded widget'
				const result = yield* f.run(
					yield* f.checkout({
						'page.tsx': [
							"import {useState} from 'react'",
							'',
							...componentSource('Flagged'),
							ignore,
							...componentSource('Ignored'),
							ignore,
							...componentSource('Passing'),
							'// judge-ignore no-repeated-search -- retired question',
							'// judge-ignore toString -- inherited properties are not questions',
							...componentSource('Unknown')
						],
						'unused.ts': [
							'// judge-ignore no-silent-fallback -- no function follows this comment',
							'export const value = 1'
						]
					})
				)
				assert.strictEqual(result.exitCode, 1)
				assert.include(result.output, 'page.tsx:3-10 no-view-state-in-memory Keep the view in the URL')
				assert.include(
					result.output,
					'page.tsx:21-28 no-view-state-in-memory This now passes; remove its judge-ignore comment.'
				)
				assert.include(result.output, 'suppressed by judge-ignore: selection is temporary in this embedded widget')
				assert.include(result.output, 'no-repeated-search Unknown question; remove its judge-ignore comment.')
				assert.include(result.output, 'toString Unknown question; remove its judge-ignore comment.')
				assert.include(
					result.output,
					'unused.ts:1-1 judge-ignore This comment does not apply to a judged unit; remove it.'
				)
				assert.include(result.output, '— 5 findings, 0 could not read, 1 suppressed')
			}, Effect.scoped)
		)

		test.effect(
			'plans every registered case alone, including nested layers and parameterized long cases',
			Effect.fnUntraced(function* () {
				const f = yield* fixture()
				const result = yield* f.run(
					yield* f.checkout({
						'cases.test.ts': [
							"import {describe, it, layer as fixtures} from '@effect/vitest'",
							"import {Effect, Layer} from 'effect'",
							"describe('group', () => {",
							"it('plain', () => { assert.strictEqual(value, 1) })",
							'it.layer(Layer.empty)(check => {',
							"check.effect('layered', () => Effect.void)",
							"check.effect.each([1, 2])('each %d', value => Effect.succeed(value))",
							'check.layer(Layer.empty)(serverTest => {',
							"serverTest.effect('nested', () => Effect.void)",
							'})',
							'})',
							"it('long', () => {",
							...Array.makeBy(160, index => `const item${index} = ${index}`),
							'assert.strictEqual(answer, 160)',
							'})',
							'})',
							"const title = 'computed title'",
							'it(title, exercise)',
							"fixtures(Layer.empty)('suite', cases => {",
							"cases.effect('aliased layer', () => Effect.void)",
							'})'
						]
					}),
					['--dry-run']
				)
				assert.strictEqual(result.exitCode, 0)
				assert.include(result.output, '7 units in 1 files')
				assert.include(result.output, 'cases.test.ts:4-4 ~')
				assert.include(result.output, 'cases.test.ts:6-6 ~')
				assert.include(result.output, 'cases.test.ts:7-7 ~')
				assert.include(result.output, 'cases.test.ts:9-9 ~')
				assert.include(result.output, 'cases.test.ts:12-174 ~')
				assert.strictEqual(
					pipe(
						result.output,
						String.split('\n'),
						Array.filter(String.startsWith('cases.test.ts:')),
						Array.countBy(String.endsWith('no-internals-test, no-tautological-expectation'))
					),
					7
				)
				assert.include(result.output, 'nothing was sent')
			}, Effect.scoped)
		)

		test.effect(
			'refuses more than twenty planned calls until the user explicitly asks',
			Effect.fnUntraced(function* () {
				const f = yield* fixture()
				const directory = yield* f.checkout({
					'text.ts': [
						"import {Array, String} from 'effect'",
						...Array.flatMap(Array.range(1, 9), index => functionSource(`words${index}`, 'a'))
					]
				})
				const dry = yield* f.run(directory, ['--dry-run'])
				assert.strictEqual(dry.exitCode, 0)
				assert.include(dry.output, '9 units in 1 files')
				assert.include(dry.output, 'nothing was sent')
				const refused = yield* f.run(directory)
				assert.strictEqual(refused.exitCode, 1)
				assert.include(refused.output, 'nothing was sent. More than 20 calls requires --user-asked')
				const allowed = yield* f.run(directory, ['--user-asked'])
				assert.strictEqual(allowed.exitCode, 0)
				assert.include(allowed.output, '— 0 findings, 0 could not read, 0 suppressed')
			}, Effect.scoped)
		)

		// judge-ignore no-internals-test -- the call and token counts are the summary line the judge prints, its documented contract for remembered answers.
		test.effect(
			'reuses remembered answers and asks only the edited unit again',
			Effect.fnUntraced(function* () {
				const f = yield* fixture()
				const directory = yield* f.checkout({
					'text.ts': [
						"import {Array, String} from 'effect'",
						...functionSource('first', 'a'),
						...functionSource('second', 'b')
					]
				})
				const cold = yield* f.run(directory)
				assert.strictEqual(cold.exitCode, 0)
				assert.include(cold.output, '0 answered from memory')
				const warm = yield* f.run(directory)
				assert.strictEqual(warm.exitCode, 0)
				assert.include(warm.output, '0 calls made, 0 input tokens reported')
				yield* f.write(directory, {
					'text.ts': [
						"import {Array, String} from 'effect'",
						...functionSource('first', 'a'),
						...functionSource('second', 'c')
					]
				})
				const edited = yield* f.run(directory)
				assert.strictEqual(edited.exitCode, 0)
				assert.include(edited.output, '1 calls made, 100 input tokens reported')
			}, Effect.scoped)
		)

		test.effect(
			'reports a touched file the parser cannot read',
			Effect.fnUntraced(function* () {
				const f = yield* fixture()
				const result = yield* f.run(yield* f.checkout({'text.ts': ['\u0000', ...functionSource('first', 'a')]}))
				assert.strictEqual(result.exitCode, 1)
				assert.include(result.output, 'text.ts: the parser cannot read it:')
				assert.include(result.output, '— 0 findings, 1 could not read, 0 suppressed')
			}, Effect.scoped)
		)

		test.effect(
			'reports incomplete answers and leaves them to be asked again',
			Effect.fnUntraced(function* () {
				const f = yield* fixture()
				const directory = yield* f.checkout({
					'text.ts': ["import {Array, String} from 'effect'", ...functionSource('Partial', 'a')]
				})
				const first = yield* f.run(directory)
				assert.strictEqual(first.exitCode, 1)
				assert.include(
					first.output,
					'text.ts:2-8 no-contradicted-promise: Gateway or Haiku gave no answer the judge could read'
				)
				const retried = yield* f.run(directory)
				assert.strictEqual(retried.exitCode, 1)
				assert.include(retried.output, '1 calls made, 0 input tokens reported')
				assert.include(retried.output, '1 calls with unavailable usage')
				assert.include(retried.output, '— 0 findings, 4 could not read, 0 suppressed')
			}, Effect.scoped)
		)

		test.effect(
			'leaves a question unreadable when its self-check fails instead of trusting its unit answers',
			Effect.fnUntraced(function* () {
				const f = yield* fixture('contradicted-promise')
				const result = yield* f.run(
					yield* f.checkout({'text.ts': ["import {Array, String} from 'effect'", ...functionSource('first', 'a')]})
				)
				assert.strictEqual(result.exitCode, 1)
				assert.include(
					result.output,
					'no-contradicted-promise: self-check did not correctly answer its yes example; question not used'
				)
				assert.include(result.output, '— 0 findings, 1 could not read, 0 suppressed')
			}, Effect.scoped)
		)
	})
})
