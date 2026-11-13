// oxlint-disable-next-line effecttsgo/node-builtin-import -- The CLI runs in a separate process; its model is a loopback stand-in.
import {createServer} from 'node:http'

import {NodeHttpServer, NodeServices} from '@effect/platform-node'
import {assert, describe, it} from '@effect/vitest'

import {Array, Boolean, Context, Effect, FileSystem, Layer, Path, Record, Schema, Stream, String, pipe} from 'effect'

import {HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse} from 'effect/http'
import {ChildProcess} from 'effect/process'

import {QUESTIONS} from '#judge.ts'

const IDENTITY = {
	GIT_AUTHOR_EMAIL: 'judge@example.com',
	GIT_AUTHOR_NAME: 'Judge',
	GIT_COMMITTER_EMAIL: 'judge@example.com',
	GIT_COMMITTER_NAME: 'Judge'
}

type Asked = typeof Asked.Type
const Asked = Schema.Struct({
	questions: Schema.Record(Schema.String, Schema.Unknown),
	state: Schema.Record(Schema.String, Schema.String)
})

function score(name: string, code: string, misjudged: string) {
	const questions = Record.values(QUESTIONS)
	if (Array.some(questions, found => code === found.yes.example)) {
		if (name === misjudged) return 0.1
		return 0.95
	}
	if (Array.some(questions, found => code === found.no.example)) return 0.05
	if (name !== 'no-view-state-in-memory') return 0.05
	if (String.includes('Flagged')(code) || String.includes('Ignored')(code)) return 0.95
	if (String.includes('Wavering')(code)) return 0.7
	return 0.05
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

const fixture = Effect.fnUntraced(function* (misjudged: string = '') {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const server = yield* Layer.build(
		Layer.provideMerge(
			HttpRouter.serve(
				HttpRouter.add(
					'POST',
					'/ai/opencode-zen/systemone/v1/systemone',
					Effect.orDie(
						Effect.gen(function* () {
							const asked = yield* HttpServerRequest.schemaBodyJson(Asked)
							const code = asked.state['code'] ?? ''
							const names = Record.keys(asked.questions)
							return yield* HttpServerResponse.json({
								answers: Record.fromEntries(
									pipe(
										String.includes('Partial')(code),
										Boolean.match({onFalse: () => names, onTrue: () => Array.drop(names, 1)}),
										Array.map(name => [name, {noul: score(name, code, misjudged)}])
									)
								),
								usage: {input_tokens: 100}
							})
						})
					)
				)
			),
			NodeHttpServer.layer(createServer, {host: '127.0.0.1', port: 0})
		)
	)
	const gateway = HttpServer.formatAddress(Context.get(server, HttpServer.HttpServer).address)
	const home = yield* fs.makeTempDirectoryScoped({prefix: 'coding-standards-home-'})
	yield* fs.makeDirectory(path.join(home, '.deslop', 'coding-standards'), {recursive: true})
	yield* fs.writeFileString(
		path.join(home, '.deslop', 'coding-standards', 'session.json'),
		'{"accessToken":"test","clientId":"test","expiresAt":4102444800000,"refreshToken":"test"}'
	)
	const git = Effect.fnUntraced(function* (directory: string, args: string[]) {
		yield* Effect.scoped(
			Effect.flatMap(
				ChildProcess.make('git', args, {cwd: directory, env: IDENTITY, extendEnv: true}),
				handle => handle.exitCode
			)
		)
	})
	const write = Effect.fnUntraced(function* (directory: string, files: Record<string, string[]>) {
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
	const run = Effect.fnUntraced(function* (directory: string, flags: string[] = []) {
		const handle = yield* ChildProcess.make(
			'node',
			[path.join(import.meta.dirname, 'main.cli.ts'), 'judge', '--gateway', gateway, '--base', 'main', ...flags],
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
				Stream.mkString(Stream.decodeText(handle.stdout)),
				Stream.mkString(Stream.decodeText(handle.stderr)),
				handle.exitCode
			],
			{concurrency: 'unbounded'}
		)
		return {exitCode: output[2], output: output[0] + output[1]}
	}, Effect.scoped)
	return {checkout, run, write}
})

describe('coding-standards judge', () => {
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
							ignore,
							...componentSource('Wavering')
						]
					})
				)
				assert.strictEqual(result.exitCode, 1)
				assert.include(result.output, 'page.tsx:3-10 no-view-state-in-memory Keep the view in the URL')
				assert.include(
					result.output,
					'page.tsx:21-28 no-view-state-in-memory This now passes; remove its judge-ignore comment.'
				)
				assert.include(
					result.output,
					'suppressed by judge-ignore: selection is temporary in this embedded widget (0.95)'
				)
				assert.include(result.output, '— 2 findings, 0 could not read, 1 suppressed')
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
				assert.include(warm.output, '0 calls made, 0 input tokens read')
				yield* f.write(directory, {
					'text.ts': [
						"import {Array, String} from 'effect'",
						...functionSource('first', 'a'),
						...functionSource('second', 'c')
					]
				})
				const edited = yield* f.run(directory)
				assert.strictEqual(edited.exitCode, 0)
				assert.include(edited.output, '1 calls made, 100 input tokens read')
			}, Effect.scoped)
		)

		test.effect(
			'reports a call beyond the token limit as unreadable',
			Effect.fnUntraced(function* () {
				const f = yield* fixture()
				const result = yield* f.run(
					yield* f.checkout({'text.ts': ["import {Array, String} from 'effect'", ...functionSource('first', 'a')]}),
					['--max-call-tokens', '1']
				)
				assert.strictEqual(result.exitCode, 1)
				assert.include(result.output, 'Could not read, so the judge cannot vouch for the change:')
				assert.include(result.output, 'past --max-call-tokens 1; not sent')
				assert.include(result.output, '0 calls made, 0 input tokens read')
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
					'text.ts:2-8 no-contradicted-promise: Gateway or Jev gave no answer the judge could read'
				)
				const retried = yield* f.run(directory)
				assert.strictEqual(retried.exitCode, 1)
				assert.include(retried.output, '1 calls made, 100 input tokens read')
				assert.include(retried.output, '— 0 findings, 4 could not read, 0 suppressed')
			}, Effect.scoped)
		)

		test.effect(
			'reports a question that misjudges its own example',
			Effect.fnUntraced(function* () {
				const f = yield* fixture('no-contradicted-promise')
				const result = yield* f.run(yield* f.checkout({}))
				assert.strictEqual(result.exitCode, 1)
				assert.include(result.output, 'no-contradicted-promise misjudges its yes example. 0.1')
				assert.include(result.output, '— 1 findings, 0 could not read, 0 suppressed')
			}, Effect.scoped)
		)
	})
})
