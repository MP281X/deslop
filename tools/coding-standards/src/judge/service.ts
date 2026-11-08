import {
	Array,
	Boolean,
	Clock,
	Effect,
	FileSystem,
	HashSet,
	Number,
	Option,
	Path,
	Record,
	Redacted,
	Ref,
	Schema,
	Stream,
	String,
	SynchronizedRef,
	pipe
} from 'effect'

import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {ChildProcess} from 'effect/process'
import {parseSync, visitorKeys} from 'oxc-parser'

import {CACHE_DIRECTORY, THRESHOLD, Verdicts, questionKey, readVerdicts, unitKey} from '#judge/cache.ts'
import type {Question} from '#judge/rule.ts'
import {JUDGED_RULES} from '#judge/rules.ts'
import {JudgeError, accessToken} from '#judge/session.ts'
import type {Urls} from '#judge/session.ts'
import {importsOf, units} from '#judge/units.ts'

const CONCURRENCY = 16
// Where an example would live, so Jev reads a test as a test and a component as a component.
const EXAMPLE_FILES = {code: 'src/example.ts', component: 'src/example.tsx', test: 'src/example.test.ts'}
const QUESTIONS = Array.map(Record.toEntries(JUDGED_RULES), entry => ({
	key: questionKey(entry[1].question),
	name: entry[0],
	question: entry[1].question
}))

type Decision = typeof Decision.Type
const Decision = Schema.Struct({
	answers: Schema.Record(Schema.String, Schema.Struct({noul: Schema.Finite})),
	usage: Schema.optionalKey(Schema.Struct({cost: Schema.optionalKey(Schema.Finite)}))
})
type Refusal = typeof Refusal.Type
const Refusal = Schema.Struct({error: Schema.Struct({message: Schema.String})})

// A judged rule's question under the rule's name and the key its answers are cached by.
type Named = {key: string; name: string; question: Question}
type Asked = {code: string; file: string; imports: string; questions: Named[]}

// Jev's probability for each asked question it answered, by the question's key.
const decide = Effect.fnUntraced(function* (
	urls: Urls,
	token: SynchronizedRef.SynchronizedRef<Redacted.Redacted>,
	asked: Asked
) {
	const client = yield* HttpClient.HttpClient
	const request = yield* HttpClientRequest.bodyJson(
		HttpClientRequest.post(`${urls.gateway}/ai/openrouter/alpha/decisions`),
		{
			model: 'typesafe/jev-1.14',
			questions: Record.fromEntries(
				Array.map(asked.questions, entry => [
					entry.name,
					{criteria: entry.question.criteria, instructions: entry.question.question, type: 'noul'}
				])
			),
			state: {code: asked.code, file: asked.file, imports: asked.imports}
		}
	)
	const used = yield* SynchronizedRef.get(token)
	// Calls refused together refresh once: only the first to see the refused token replaces it.
	const response = yield* Effect.filterOrElse(
		client.execute(HttpClientRequest.bearerToken(request, Redacted.value(used))),
		sent => sent.status !== 401,
		() =>
			Effect.flatMap(
				SynchronizedRef.updateAndGetEffect(token, current =>
					Effect.gen(function* () {
						if (current !== used) return current
						return yield* accessToken(urls, true)
					})
				),
				fresh => client.execute(HttpClientRequest.bearerToken(request, Redacted.value(fresh)))
			)
	)
	if (response.status === 401) {
		return yield* JudgeError.make({
			message: 'Gateway refused the judge’s sign-in; run `deslop-coding-standards sign-in` again'
		})
	}
	if (response.status === 402) {
		return yield* JudgeError.make({
			message: (yield* HttpClientResponse.schemaBodyJson(Refusal)(response)).error.message
		})
	}
	const decision = yield* HttpClientResponse.schemaBodyJson(Decision)(
		yield* HttpClientResponse.filterStatusOk(response)
	)
	return {
		cost: decision.usage?.cost ?? 0,
		verdicts: Record.fromEntries(
			Array.flatMap(asked.questions, entry =>
				Option.match(Record.get(decision.answers, entry.name), {
					onNone: () => [],
					onSome: answer => [[entry.key, answer.noul] as const]
				})
			)
		)
	}
})

const git = Effect.fnUntraced(function* (args: string[]) {
	return yield* Stream.mkString(
		Stream.decodeText((yield* ChildProcess.make('git', args, {stderr: 'pipe', stdout: 'pipe'})).stdout)
	)
}, Effect.scoped)

function lines(output: string) {
	return Array.filter(String.split('\n')(output), String.isNonEmpty)
}

function judgedUnits(file: string, source: string) {
	const program = parseSync(file, source).program
	const imports = importsOf(program, source)
	return Array.map(units({filename: file, program, source, visitorKeys}), unit => ({
		file,
		imports,
		key: unitKey(unit, imports),
		unit
	}))
}

// Every unit of the checkout with `all`; otherwise only the units changed since the checkout left `base`, so the cost follows the change rather than the codebase or the cache.
const changedUnits = Effect.fnUntraced(function* (scope: {all: boolean; base: string}, ignore: readonly string[]) {
	const fs = yield* FileSystem.FileSystem
	const sources = ['--', '*.ts', '*.tsx', ...Array.map(ignore, glob => `:(exclude,glob)${glob}`)]
	const untracked = lines(yield* git(['ls-files', '--others', '--exclude-standard', ...sources]))
	const since = String.trim(yield* git(['merge-base', 'HEAD', scope.base]))
	const files = Boolean.match(scope.all, {
		onFalse: () => git(['diff', '--name-only', since, ...sources]),
		onTrue: () => git(['ls-files', '--cached', ...sources])
	})
	const found = yield* Effect.forEach(
		Array.dedupe([...lines(yield* files), ...untracked]),
		file =>
			Effect.gen(function* () {
				// A file listed but deleted in the working tree has nothing to judge.
				const now = Option.match(yield* Effect.option(fs.readFileString(file)), {
					onNone: () => [],
					onSome: source => judgedUnits(file, source)
				})
				if (scope.all) return now
				const before = HashSet.fromIterable(
					Array.map(judgedUnits(file, yield* git(['show', `${since}:${file}`])), entry => entry.key)
				)
				return Array.filter(now, entry => !HashSet.has(before, entry.key))
			}),
		{concurrency: CONCURRENCY}
	)
	return Array.flatten(found)
})

// Asks each unit in scope the questions its cached verdicts do not answer yet; the judged rules then report from the cache.
export const judge = Effect.fnUntraced(function* (
	urls: Urls,
	ignore: readonly string[],
	scope: {all: boolean; base: string}
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const started = yield* Clock.currentTimeMillis
	yield* fs.makeDirectory(CACHE_DIRECTORY, {recursive: true})
	const all = yield* changedUnits(scope, ignore)
	// A unit repeated across files is asked once and shares one verdicts file.
	const pending = pipe(
		Array.dedupeWith(all, (first, second) => first.key === second.key),
		Array.map(entry => {
			const cached = Option.getOrElse(readVerdicts(entry.key), () => ({}))
			return {
				...entry,
				cached,
				questions: Array.filter(
					QUESTIONS,
					question => question.question.kind === entry.unit.kind && !Record.has(cached, question.key)
				)
			}
		}),
		Array.filter(entry => Array.isReadonlyArrayNonEmpty(entry.questions))
	)
	const spent = yield* Ref.make({cost: 0, failed: 0})
	if (Array.isReadonlyArrayNonEmpty(pending)) {
		const token = yield* SynchronizedRef.make(yield* accessToken(urls, false))
		yield* Effect.forEach(
			pending,
			entry =>
				pipe(
					Effect.gen(function* () {
						const decided = yield* decide(urls, token, {
							code: entry.unit.text,
							file: entry.file,
							imports: entry.imports,
							questions: entry.questions
						})
						yield* Ref.update(spent, current => ({...current, cost: current.cost + decided.cost}))
						yield* fs.writeFileString(
							path.join(CACHE_DIRECTORY, `${entry.key}.json`),
							yield* Schema.encodeEffect(Schema.fromJsonString(Verdicts))({...entry.cached, ...decided.verdicts})
						)
						// An answer Jev left out stays unasked in the cache, so the next run asks it again.
						if (Array.some(entry.questions, question => !Record.has(decided.verdicts, question.key))) {
							yield* Ref.update(spent, current => ({...current, failed: current.failed + 1}))
						}
					}),
					// A unit Gateway or Jev could not answer stays unjudged and is asked again on the next run.
					Effect.catchIf(
						error => error._tag !== 'JudgeError',
						() => Ref.update(spent, current => ({...current, failed: current.failed + 1}))
					)
				),
			{concurrency: CONCURRENCY, discard: true}
		)
	}
	const totals = yield* Ref.get(spent)
	yield* Effect.log(
		`judge: ${all.length} ${Boolean.match(scope.all, {onFalse: () => 'changed ', onTrue: () => ''})}units, ${pending.length - totals.failed} judged, ${totals.failed} failed, $${Number.round(totals.cost, 4)}, ${Number.round(((yield* Clock.currentTimeMillis) - started) / 1000, 1)}s`
	)
	// Lint stays quiet on a unit without a verdict, so one left unjudged would pass the gate unchecked.
	if (totals.failed > 0) {
		return yield* JudgeError.make({
			message: `${totals.failed} units stayed unjudged; run the judge again once Gateway answers`
		})
	}
})

// Asks each question about its own bad and good example, so a reworded question shows whether it still tells them apart.
export const examples = Effect.fnUntraced(function* (urls: Urls) {
	const token = yield* SynchronizedRef.make(yield* accessToken(urls, false))
	function score(entry: Named, code: string) {
		return Effect.map(
			decide(urls, token, {code, file: EXAMPLE_FILES[entry.question.kind], imports: '', questions: [entry]}),
			decided => decided.verdicts[entry.key] ?? 0
		)
	}
	const scores = yield* Effect.forEach(
		QUESTIONS,
		entry =>
			Effect.map(
				Effect.all([score(entry, entry.question.examples.bad), score(entry, entry.question.examples.good)], {
					concurrency: 'unbounded'
				}),
				found => ({bad: found[0], good: found[1], name: entry.name})
			),
		{concurrency: CONCURRENCY}
	)
	for (const found of scores) {
		yield* Effect.log(
			`${Boolean.match(found.bad >= THRESHOLD && found.good < THRESHOLD, {onFalse: () => 'MISS', onTrue: () => 'ok  '})} ${Number.round(found.bad, 2)} ${Number.round(found.good, 2)} ${found.name}`
		)
	}
	if (Array.some(scores, found => found.bad < THRESHOLD || found.good >= THRESHOLD)) {
		return yield* JudgeError.make({message: 'Some questions do not tell their examples apart'})
	}
})
