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

import {features} from '#lib/features.ts'
import type {Question} from '#lib/question.ts'

const QUESTIONS = Record.fromEntries(
	Array.flatMap(Record.toEntries(import.meta.glob<Record<string, Question>>('./judge/*.ts', {eager: true})), entry =>
		Array.map(
			Record.values(entry[1]),
			question => [String.replaceAll(/^.*\/|\.ts$/gu, '')(entry[0]), question] as const
		)
	)
)
// Every yes example is asked, and each no example its own gate admits.
const EXAMPLE_CALLS =
	Record.size(QUESTIONS) +
	Array.countBy(Record.values(QUESTIONS), question => question.gate(features(question.no.example, '')))

type Asked = typeof Asked.Type
const Asked = Schema.Struct({
	questions: Schema.Record(Schema.String, Schema.Unknown),
	state: Schema.Struct({code: Schema.String})
})

// Jev's stand-in: each question's own examples answer as written unless the question is `misjudged`; otherwise only a component named Flagged or Ignored fetches its own data, one named Wavering sits between a stale ignore and a finding, and code naming Partial is left without its first answer.
function score(name: string, code: string, misjudged: string) {
	const question = QUESTIONS[name]
	if (code === question?.yes.example && name === misjudged) return 0.1
	if (code === question?.yes.example) return 0.95
	if (code === question?.no.example) return 0.05
	if (name !== 'no-self-fetching-component') return 0.05
	if (String.includes('Flagged')(code) || String.includes('Ignored')(code)) return 0.95
	if (String.includes('Wavering')(code)) return 0.7
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
	const calls = yield* Ref.make(Array.empty<{code: string; questions: string[]}>())
	const server = yield* Layer.build(
		pipe(
			HttpRouter.serve(
				HttpRouter.add(
					'POST',
					'/ai/openrouter/alpha/decisions',
					pipe(
						Effect.gen(function* () {
							const asked = yield* HttpServerRequest.schemaBodyJson(Asked)
							yield* Ref.update(calls, made => [
								...made,
								{code: asked.state.code, questions: Record.keys(asked.questions)}
							])
							const answers = Record.toEntries(
								Record.map(asked.questions, (_, name) => ({noul: score(name, asked.state.code, misjudged)}))
							)
							return yield* HttpServerResponse.json({
								answers: Record.fromEntries(
									Boolean.match(String.includes('Partial')(asked.state.code), {
										onFalse: () => answers,
										onTrue: () => Array.drop(answers, 1)
									})
								),
								usage: {cost: 0.0001}
							})
						}),
						Effect.orDie
					)
				)
			),
			Layer.provideMerge(NodeHttpServer.layer(createServer, {host: '127.0.0.1', port: 0}))
		)
	)
	const gateway = HttpServer.formatAddress(Context.get(server, HttpServer.HttpServer).address)
	const home = yield* fs.makeTempDirectoryScoped({prefix: 'coding-standards-home-'})
	yield* fs.makeDirectory(path.join(home, '.deslop', 'coding-standards'), {recursive: true})
	yield* fs.writeFileString(
		path.join(home, '.deslop', 'coding-standards', 'session.json'),
		'{"accessToken": "test", "clientId": "test", "expiresAt": 4102444800000, "refreshToken": "test"}'
	)
	const checkout = Effect.fnUntraced(function* (files: Record<string, string[]>) {
		const directory = yield* fs.makeTempDirectoryScoped({prefix: 'coding-standards-checkout-'})
		yield* Effect.forEach(
			Record.toEntries(files),
			entry =>
				Effect.flatMap(fs.makeDirectory(path.dirname(path.join(directory, entry[0])), {recursive: true}), () =>
					fs.writeFileString(path.join(directory, entry[0]), Array.join(entry[1], '\n'))
				),
			{concurrency: 'unbounded'}
		)
		yield* Effect.scoped(
			Effect.flatMap(ChildProcess.make('git', ['init', '-q'], {cwd: directory}), handle => handle.exitCode)
		)
		return directory
	})
	const judge = Effect.fnUntraced(function* (directory: string) {
		yield* Ref.set(calls, [])
		const handle = yield* ChildProcess.make(
			'node',
			[path.join(import.meta.dirname, 'main.cli.ts'), '--judge', '--gateway', gateway],
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
		// Log lines open with their time; the rest is the findings and, after them, the tactics.
		const printed = Array.filter(
			String.split('\n')(output[0]),
			line => String.isNonEmpty(line) && !String.startsWith('[')(line)
		)
		const made = yield* Ref.get(calls)
		return {
			asked: made,
			calls: made.length,
			exitCode: output[2],
			findings: pipe(
				printed,
				Array.filter(line => Option.isSome(String.match(/ \d+(?:\.\d+)?$/u)(line))),
				Array.map(line => {
					const words = String.split(' ')(line)
					return Array.join([...Array.take(words, 2), ...Option.toArray(Array.last(words))], ' ')
				})
			),
			printed,
			tactics: Option.exists(Array.last(printed), String.includes('judge-ignore <question> -- <reason>'))
		}
	}, Effect.scoped)
	return {checkout, judge}
})

describe('coding-standards --judge', () => {
	it.layer(NodeServices.layer, {excludeTestServices: true})(test => {
		test.effect(
			'reports a score at or above 0.8, keeps a judge-ignore, and reports an ignore once its unit clearly passes',
			Effect.fnUntraced(function* () {
				const f = yield* fixture('')
				const ignore = '// judge-ignore no-self-fetching-component -- the view lives in a parent route'
				const result = yield* f.judge(
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
				assert.deepStrictEqual(result.findings, [
					'page.tsx:3 no-self-fetching-component 0.95',
					'page.tsx:21 no-self-fetching-component 0.05'
				])
				assert.deepStrictEqual(
					{exitCode: result.exitCode, tactics: result.tactics},
					{exitCode: ChildProcessSpawner.ExitCode(1), tactics: true}
				)
			}, Effect.scoped)
		)

		test.effect(
			'asks again only for edited code, never for an unused import or another checkout of the same code',
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
				const directory = yield* f.checkout(files)
				const cold = yield* f.judge(directory)
				assert.deepStrictEqual(
					{calls: cold.calls, exitCode: cold.exitCode},
					{calls: 2 + EXAMPLE_CALLS, exitCode: ChildProcessSpawner.ExitCode(0)}
				)
				assert.strictEqual((yield* f.judge(directory)).calls, 0)
				assert.strictEqual((yield* f.judge(yield* f.checkout(files))).calls, 0)
				const unused = yield* f.checkout({
					'src/text.ts': [
						"import {Array, Option, String} from 'effect'",
						'',
						...functionSource('first', 'Option'),
						...functionSource('second', 'b')
					]
				})
				assert.strictEqual((yield* f.judge(unused)).calls, 0)
				const edited = yield* f.checkout({
					'src/text.ts': [
						"import {Array, String} from 'effect'",
						'',
						...functionSource('first', 'Option'),
						...functionSource('second', 'c')
					]
				})
				assert.strictEqual((yield* f.judge(edited)).calls, 1)
			}, Effect.scoped)
		)

		test.effect(
			'asks a unit only the questions its gates admit, and reports a judge-ignore its gate now skips',
			Effect.fnUntraced(function* () {
				const f = yield* fixture('')
				const result = yield* f.judge(
					yield* f.checkout({
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
					})
				)
				const asked = Array.flatMap(result.asked, call => {
					if (!String.includes('Static')(call.code)) return []
					return call.questions
				})
				assert.deepStrictEqual(
					{
						printed: Array.take(result.printed, 1),
						selfFetching: Array.contains(asked, 'no-self-fetching-component'),
						vagueName: Array.contains(asked, 'no-vague-name')
					},
					{
						printed: [
							'page.tsx:2 no-self-fetching-component Its gate skips this code; remove its judge-ignore comment.'
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
				const directory = yield* f.checkout({
					'src/text.ts': ["import {Array, String} from 'effect'", '', ...functionSource('Partial', 'a')]
				})
				const first = yield* f.judge(directory)
				assert.deepStrictEqual(
					{calls: first.calls, exitCode: first.exitCode},
					{calls: 1 + EXAMPLE_CALLS, exitCode: ChildProcessSpawner.ExitCode(1)}
				)
				assert.strictEqual((yield* f.judge(directory)).calls, 1)
			}, Effect.scoped)
		)

		test.effect(
			'fails the judge when a question misjudges its own example',
			Effect.fnUntraced(function* () {
				const f = yield* fixture('no-control-for-wrong-job')
				const result = yield* f.judge(yield* f.checkout({'README.md': ['# Empty']}))
				assert.deepStrictEqual(result.findings, ['no-control-for-wrong-job misjudges 0.1'])
				assert.strictEqual(result.exitCode, ChildProcessSpawner.ExitCode(1))
			}, Effect.scoped)
		)
	})
})
