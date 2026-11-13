// oxlint-disable-next-line effecttsgo/node-builtin-import -- The judge runs as its own process, so its Gateway is a real loopback server.
import {createServer} from 'node:http'

import {NodeHttpServer, NodeServices} from '@effect/platform-node'
import {assert, describe, it} from '@effect/vitest'

import {
	Array,
	Boolean,
	Context,
	Effect,
	FileSystem,
	Layer,
	Option,
	Path,
	Record,
	Ref,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse} from 'effect/http'
import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import {CHANGE_QUESTIONS, QUESTIONS} from '#judge.ts'

import {matches} from '#lib/ast.ts'
import {features} from '#lib/features.ts'

// The commits' author, so a checkout commits whatever the machine's git configuration says.
const IDENTITY = {
	GIT_AUTHOR_EMAIL: 'judge@example.com',
	GIT_AUTHOR_NAME: 'Judge',
	GIT_COMMITTER_EMAIL: 'judge@example.com',
	GIT_COMMITTER_NAME: 'Judge'
}

// Every yes example is asked, each no example its own gate admits, and both examples of every change question.
const EXAMPLE_CALLS =
	Record.size(QUESTIONS) +
	Array.countBy(Record.values(QUESTIONS), question => question.gate(features(question.no.example, ''))) +
	2 * Record.size(CHANGE_QUESTIONS)
const EXAMPLES: Record<
	string,
	{no: {example: string | Record<string, string>}; yes: {example: string | Record<string, string>}}
> = {...QUESTIONS, ...CHANGE_QUESTIONS}

type Asked = typeof Asked.Type
const Asked = Schema.Struct({
	model: Schema.String,
	questions: Schema.Record(
		Schema.String,
		Schema.Struct({
			criteria: Schema.Struct({false: Schema.Unknown, true: Schema.Unknown}),
			instructions: Schema.String,
			type: Schema.String
		})
	),
	state: Schema.Record(Schema.String, Schema.String)
})

function isExample(state: Record<string, string>, example: string | Record<string, string>) {
	if (String.isString(example)) return pipe(state, Record.get('code'), Option.contains(example))
	return Record.makeEquivalence(String.Equivalence)(state, example)
}

// Jev's stand-in: each question's own examples answer as written unless the question is `misjudged`; otherwise a component named Flagged or Ignored fetches its own data, one named Wavering sits between a stale ignore and a finding, a hunk naming Unrelated is unrelated to the request, a claim naming Unproven is not shown working, and a state naming Partial is left without its first answer.
function score(name: string, state: Record<string, string>, misjudged: string) {
	const question = Record.get(EXAMPLES, name)
	function holds(field: string, word: string) {
		return pipe(state, Record.get(field), Option.exists(String.includes(word)))
	}
	if (Option.exists(question, found => isExample(state, found.yes.example))) {
		return Boolean.match(name === misjudged, {onFalse: () => 0.95, onTrue: () => 0.1})
	}
	if (Option.exists(question, found => isExample(state, found.no.example))) return 0.05
	if (name === 'no-unrelated-edit' && holds('edit', 'Unrelated')) return 0.95
	if (name === 'no-unproven-claim' && holds('claim', 'Unproven')) return 0.95
	if (name !== 'no-self-fetching-component') return 0.05
	if (holds('code', 'Flagged') || holds('code', 'Ignored')) return 0.95
	if (holds('code', 'Wavering')) return 0.7
	return 0.05
}

function componentSource(name: string) {
	return [
		`export function ${name}() {`,
		"\tconst [open, setOpen] = useState('')",
		'\treturn (',
		'\t\t<div>',
		'\t\t\t<button onClick={() => setOpen(name)}>{open}</button>',
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

const fixture = Effect.fnUntraced(function* (misjudged: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const calls = yield* Ref.make(Array.empty<Asked>())
	const server = yield* Layer.build(
		Layer.provideMerge(
			HttpRouter.serve(
				HttpRouter.add(
					'POST',
					'/ai/openrouter/alpha/decisions',
					Effect.orDie(
						Effect.gen(function* () {
							const asked = yield* HttpServerRequest.schemaBodyJson(Asked)
							yield* Ref.update(calls, made => [...made, asked])
							const answers = Record.toEntries(
								Record.map(asked.questions, (_, name) => ({noul: score(name, asked.state, misjudged)}))
							)
							return yield* HttpServerResponse.json({
								answers: Record.fromEntries(
									Boolean.match(pipe(asked.state, Record.values, Array.some(String.includes('Partial'))), {
										onFalse: () => answers,
										onTrue: () => Array.drop(answers, 1)
									})
								),
								usage: {cost: 0.0001}
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
		'{"accessToken": "test", "clientId": "test", "expiresAt": 4102444800000, "refreshToken": "test"}'
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
				Effect.flatMap(fs.makeDirectory(path.dirname(path.join(directory, entry[0])), {recursive: true}), () =>
					fs.writeFileString(path.join(directory, entry[0]), Array.join(entry[1], '\n'))
				),
			{concurrency: 'unbounded'}
		)
	})
	const commit = Effect.fnUntraced(function* (directory: string, message: string) {
		yield* git(directory, ['add', '-A'])
		yield* git(directory, ['commit', '-q', '--allow-empty', '-m', message])
	})
	// A repository whose `main` holds a README and `base`, and a change on top: `files` committed with `message`.
	const checkout = Effect.fnUntraced(function* (
		files: Record<string, string[]>,
		message: string,
		base: Record<string, string[]> = {}
	) {
		const directory = yield* fs.makeTempDirectoryScoped({prefix: 'coding-standards-checkout-'})
		yield* git(directory, ['init', '-q', '-b', 'main'])
		yield* write(directory, {...base, 'README.md': ['# Notes']})
		yield* commit(directory, 'Start')
		yield* git(directory, ['checkout', '-q', '-b', 'change'])
		yield* write(directory, files)
		yield* commit(directory, message)
		return directory
	})
	const judge = Effect.fnUntraced(function* (directory: string, flags: string[] = ['--base', 'main']) {
		yield* Ref.set(calls, [])
		const handle = yield* ChildProcess.make(
			'node',
			[path.join(import.meta.dirname, 'main.cli.ts'), 'judge', '--gateway', gateway, ...flags],
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
		const lines = pipe(output[0], String.split('\n'), Array.filter(String.isNonEmpty))
		// Log lines open with their time; the rest is the findings and, after them, the tactics.
		const printed = Array.filter(lines, line => !String.startsWith('[')(line))
		const made = yield* Ref.get(calls)
		return {
			asked: made,
			calls: made.length,
			exitCode: output[2],
			findings: pipe(
				printed,
				Array.filter(line => Option.isSome(String.match(/ \d+(?:\.\d+)?$/u)(line))),
				Array.map(line => {
					const words = String.split(line, ' ')
					return Array.join([...Array.take(words, 2), ...Option.toArray(Array.last(words))], ' ')
				})
			),
			output: output[0],
			printed,
			summary: pipe(
				lines,
				Array.findFirst(String.includes('judge')),
				Option.getOrElse(() => '')
			),
			tactics: Option.exists(Array.last(printed), String.includes('judge-ignore <question> -- <reason>'))
		}
	}, Effect.scoped)
	return {checkout, commit, judge, write}
})

// The calls that asked line-level questions, by the units' code, and the change-level ones, by what their state holds.
function lineLevel(asked: Asked[]) {
	return Array.filter(
		asked,
		call => Record.has(call.state, 'code') && !String.startsWith('src/example')(call.state['file'] ?? '')
	)
}

function changeLevel(asked: Asked[]) {
	return Array.filter(
		asked,
		call =>
			!Record.has(call.state, 'code') &&
			!Array.some(
				Record.values(CHANGE_QUESTIONS),
				question => isExample(call.state, question.yes.example) || isExample(call.state, question.no.example)
			)
	)
}

describe('coding-standards judge', () => {
	it.layer(NodeServices.layer, {excludeTestServices: true})(test => {
		test.effect(
			'reports a unit at or above 0.8 with its lines, keeps a judge-ignore, and reports an ignore once its unit clearly passes',
			Effect.fnUntraced(function* () {
				const f = yield* fixture('')
				const ignore = '// judge-ignore no-self-fetching-component -- the view lives in a parent route'
				const result = yield* f.judge(
					yield* f.checkout(
						{
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
						},
						'Add the page'
					)
				)
				assert.deepStrictEqual(result.findings, [
					'page.tsx:3-10 no-self-fetching-component 0.95',
					'page.tsx:21-28 no-self-fetching-component 0.05'
				])
				assert.deepStrictEqual(
					{exitCode: result.exitCode, tactics: result.tactics},
					{exitCode: ChildProcessSpawner.ExitCode(1), tactics: true}
				)
			}, Effect.scoped)
		)

		test.effect(
			'asks each hunk alone and beside the request, each claim beside its proof, and quotes what a change-level finding contradicts',
			Effect.fnUntraced(function* () {
				const f = yield* fixture('')
				const result = yield* f.judge(
					yield* f.checkout(
						{'notes.md': ['# Notes', '', 'Lists notes.'], 'other.md': ['Unrelated settings']},
						'Add the notes list\n\nThe notes list loads offline. Unproven.'
					)
				)
				assert.deepStrictEqual(
					pipe(
						changeLevel(result.asked),
						Array.map(call => ({
							fields: Array.sort(Record.keys(call.state), String.Order),
							questions: Record.keys(call.questions)
						})),
						Array.sortWith(entry => Array.join(entry.fields, ','), String.Order)
					),
					[
						{fields: ['claim', 'proof'], questions: ['no-unproven-claim']},
						{fields: ['claim', 'proof'], questions: ['no-unproven-claim']},
						{fields: ['edit', 'file'], questions: ['no-boundary-crossing', 'no-needless-machinery']},
						{fields: ['edit', 'file'], questions: ['no-boundary-crossing', 'no-needless-machinery']},
						{fields: ['edit', 'file', 'request'], questions: ['no-unrelated-edit']},
						{fields: ['edit', 'file', 'request'], questions: ['no-unrelated-edit']}
					]
				)
				const unrelated = Array.findFirst(
					changeLevel(result.asked),
					call => pipe(call.state, Record.get('file'), Option.contains('other.md')) && Record.has(call.state, 'request')
				)
				assert.deepStrictEqual(
					Option.map(unrelated, call => call.state['request']),
					Option.some('Add the notes list\n\nThe notes list loads offline. Unproven.')
				)
				assert.isTrue(
					Array.some(
						result.printed,
						line =>
							String.startsWith('other.md:1-1 no-unrelated-edit ')(line) &&
							String.endsWith(' Request: "Add the notes list". 0.95')(line)
					)
				)
				assert.isTrue(
					Array.some(
						result.printed,
						line =>
							matches(/^commit [0-9a-f]+:3 no-unproven-claim /u)(line) &&
							String.endsWith(' Claim: "The notes list loads offline. Unproven.". 0.95')(line)
					)
				)
				assert.strictEqual(result.exitCode, ChildProcessSpawner.ExitCode(1))
			}, Effect.scoped)
		)

		test.effect(
			'asks again only what an edit touched, never an unused import, a moved unit or another checkout of the same change',
			Effect.fnUntraced(function* () {
				const f = yield* fixture('')
				// The first helper names Option only in a string, so importing Option leaves it unchanged.
				const files = {
					'src/text.ts': [
						"import {Array, String} from 'effect'",
						'',
						...functionSource('first', 'Option'),
						...functionSource('second', 'b')
					]
				}
				const directory = yield* f.checkout(files, 'Add the text helpers')
				const cold = yield* f.judge(directory)
				assert.deepStrictEqual(
					{
						calls: cold.calls,
						exitCode: cold.exitCode,
						units: Array.map(lineLevel(cold.asked), call => String.slice(0, 22)(call.state['code'] ?? ''))
					},
					{
						// Two units, the file's one hunk alone and beside the request, and the request's one claim.
						calls: 5 + EXAMPLE_CALLS,
						exitCode: ChildProcessSpawner.ExitCode(0),
						units: ['function first(items: ', 'function second(items:']
					}
				)
				assert.strictEqual((yield* f.judge(directory)).calls, 0)
				assert.strictEqual((yield* f.judge(yield* f.checkout(files, 'Add the text helpers'))).calls, 0)
				yield* f.write(directory, {
					'src/text.ts': [
						"import {Array, Option, String} from 'effect'",
						'',
						...functionSource('first', 'Option'),
						...functionSource('second', 'b')
					]
				})
				const imported = yield* f.judge(directory)
				assert.deepStrictEqual(
					{changeLevel: changeLevel(imported.asked).length, lineLevel: lineLevel(imported.asked).length},
					{changeLevel: 2, lineLevel: 0}
				)
				yield* f.write(directory, {
					'src/text.ts': [
						"import {Array, Option, String} from 'effect'",
						'',
						...functionSource('first', 'Option'),
						...functionSource('second', 'c')
					]
				})
				assert.deepStrictEqual(
					Array.map(lineLevel((yield* f.judge(directory)).asked), call =>
						String.slice(0, 22)(call.state['code'] ?? '')
					),
					['function second(items:']
				)
			}, Effect.scoped)
		)

		test.effect(
			'reads only the units the change touched, with the comments right above them',
			Effect.fnUntraced(function* () {
				const f = yield* fixture('')
				const commented = yield* f.judge(
					yield* f.checkout(
						{
							'src/text.ts': [
								"import {Array, String} from 'effect'",
								'',
								...functionSource('first', 'a'),
								'// Tags each kept item with a suffix.',
								...functionSource('second', 'b')
							]
						},
						'Say what the second helper tags',
						{
							'src/text.ts': [
								"import {Array, String} from 'effect'",
								'',
								...functionSource('first', 'a'),
								'// Tags each kept item.',
								...functionSource('second', 'b')
							]
						}
					)
				)
				assert.deepStrictEqual(
					Array.map(lineLevel(commented.asked), call =>
						pipe(call.state['code'] ?? '', String.split('\n'), Array.take(2))
					),
					[['// Tags each kept item with a suffix.', 'function second(items: string[]) {']]
				)
			}, Effect.scoped)
		)

		test.effect(
			'asks a unit only the questions its gates admit, and reports a judge-ignore its gate now skips',
			Effect.fnUntraced(function* () {
				const f = yield* fixture('')
				const result = yield* f.judge(
					yield* f.checkout(
						{
							'page.tsx': [
								'// judge-ignore no-self-fetching-component -- the view lives in a parent route',
								'export function Static(props: {name: string}) {',
								'\tconst title = props.name',
								'\treturn (',
								'\t\t<div>',
								'\t\t\t<p>{title}</p>',
								'\t\t</div>',
								'\t)',
								'}'
							]
						},
						'Add the static page'
					)
				)
				const asked = Array.flatMap(lineLevel(result.asked), call => Record.keys(call.questions))
				assert.deepStrictEqual(
					{
						printed: Array.take(result.printed, 1),
						selfFetching: Array.contains(asked, 'no-self-fetching-component'),
						vagueName: Array.contains(asked, 'no-vague-name')
					},
					{
						printed: [
							'page.tsx:2-9 no-self-fetching-component Its gate skips this code; remove its judge-ignore comment.'
						],
						selfFetching: false,
						vagueName: true
					}
				)
			}, Effect.scoped)
		)

		test.effect(
			'remembers nothing from a call missing an answer',
			Effect.fnUntraced(function* () {
				const f = yield* fixture('')
				const directory = yield* f.checkout(
					{'src/text.ts': ["import {Array, String} from 'effect'", '', ...functionSource('Partial', 'a')]},
					'Add the text helper'
				)
				const first = yield* f.judge(directory)
				// The unit and the hunk twice name Partial: three calls missing an answer, and one claim.
				assert.deepStrictEqual(
					{calls: first.calls, exitCode: first.exitCode},
					{calls: 4 + EXAMPLE_CALLS, exitCode: ChildProcessSpawner.ExitCode(1)}
				)
				assert.strictEqual((yield* f.judge(directory)).calls, 3)
			}, Effect.scoped)
		)

		test.effect(
			'fails the judge when a line-level or a change-level question misjudges its own example',
			Effect.fnUntraced(function* () {
				const line = yield* fixture('no-control-for-wrong-job')
				const lineLevelResult = yield* line.judge(yield* line.checkout({}, 'Nothing'))
				assert.deepStrictEqual(
					{exitCode: lineLevelResult.exitCode, findings: lineLevelResult.findings},
					{exitCode: ChildProcessSpawner.ExitCode(1), findings: ['no-control-for-wrong-job misjudges 0.1']}
				)
				const change = yield* fixture('no-unproven-claim')
				assert.deepStrictEqual((yield* change.judge(yield* change.checkout({}, 'Nothing'))).findings, [
					'no-unproven-claim misjudges 0.1'
				])
			}, Effect.scoped)
		)

		test.effect(
			'prints what a dry run would ask with its estimated tokens, sends nothing and exits 0',
			Effect.fnUntraced(function* () {
				const f = yield* fixture('')
				const directory = yield* f.checkout(
					{'src/text.ts': ["import {Array, String} from 'effect'", '', ...functionSource('first', 'a')]},
					'Add the text helper'
				)
				const dry = yield* f.judge(directory, ['--base', 'main', '--dry-run'])
				assert.deepStrictEqual(
					{
						calls: dry.calls,
						exitCode: dry.exitCode,
						lines: dry.printed.length,
						unit: Array.some(dry.printed, matches(/^src\/text\.ts:3-9 ~\d+ tokens: no-compatibility-code, /u))
					},
					{calls: 0, exitCode: ChildProcessSpawner.ExitCode(0), lines: 4 + EXAMPLE_CALLS, unit: true}
				)
				assert.isTrue(
					matches(
						/judge, dry run: 1 commits since main: 1 units, 1 hunks, 1 claims; \d+ questions asked .* in \d+ calls, ~\d+ tokens;/u
					)(dry.summary)
				)
				yield* f.judge(directory)
				// After a run, a dry run has nothing left to ask.
				assert.deepStrictEqual((yield* f.judge(directory, ['--base', 'main', '--dry-run'])).printed, [])
			}, Effect.scoped)
		)

		test.effect(
			'needs a base when the repository has no origin and no pull request names one',
			Effect.fnUntraced(function* () {
				const f = yield* fixture('')
				const result = yield* f.judge(yield* f.checkout({}, 'Nothing'), [])
				assert.deepStrictEqual(
					{calls: result.calls, exitCode: result.exitCode, named: String.includes('--base <ref>')(result.output)},
					{calls: 0, exitCode: ChildProcessSpawner.ExitCode(1), named: true}
				)
			}, Effect.scoped)
		)
	})
})
