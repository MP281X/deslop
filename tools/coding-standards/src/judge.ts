import {
	Array,
	Clock,
	Console,
	Effect,
	FileSystem,
	HashSet,
	Layer,
	Number,
	Option,
	Record,
	Redacted,
	Ref,
	Runtime,
	Schema,
	Stream,
	String,
	SynchronizedRef,
	pipe
} from 'effect'

import {Digest} from 'effect/crypto'
import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {KeyValueStore, UserDirectories} from 'effect/persistence'
import {ChildProcess} from 'effect/process'

import {noCompatibilityCode} from '#judge/no-compatibility-code.ts'
import {noControlForWrongJob} from '#judge/no-control-for-wrong-job.ts'
import {noDetachedActionError} from '#judge/no-detached-action-error.ts'
import {noDroppedContent} from '#judge/no-dropped-content.ts'
import {noHeroFailure} from '#judge/no-hero-failure.ts'
import {noHiddenSideEffect} from '#judge/no-hidden-side-effect.ts'
import {noImperativeAccumulation} from '#judge/no-imperative-accumulation.ts'
import {noImpossibleState} from '#judge/no-impossible-state.ts'
import {noInternalsTest} from '#judge/no-internals-test.ts'
import {noLibraryTest} from '#judge/no-library-test.ts'
import {noLogicInIo} from '#judge/no-logic-in-io.ts'
import {noMisleadingName} from '#judge/no-misleading-name.ts'
import {noMultiBehaviorTest} from '#judge/no-multi-behavior-test.ts'
import {noOneShotInterpreter} from '#judge/no-one-shot-interpreter.ts'
import {noRedundantCheck} from '#judge/no-redundant-check.ts'
import {noReinventedHelper} from '#judge/no-reinvented-helper.ts'
import {noRepeatedBlock} from '#judge/no-repeated-block.ts'
import {noRepeatedFact} from '#judge/no-repeated-fact.ts'
import {noRepeatedSearch} from '#judge/no-repeated-search.ts'
import {noRepeatedTextAction} from '#judge/no-repeated-text-action.ts'
import {noRestatingComment} from '#judge/no-restating-comment.ts'
import {noRoundaboutComputation} from '#judge/no-roundabout-computation.ts'
import {noRoundtrip} from '#judge/no-roundtrip.ts'
import {noSelfFetchingComponent} from '#judge/no-self-fetching-component.ts'
import {noSilentFallback} from '#judge/no-silent-fallback.ts'
import {noStaleComment} from '#judge/no-stale-comment.ts'
import {noStringlyTyped} from '#judge/no-stringly-typed.ts'
import {noTautologicalExpectation} from '#judge/no-tautological-expectation.ts'
import {noTitleMismatchTest} from '#judge/no-title-mismatch-test.ts'
import {noUninvalidatedWrite} from '#judge/no-uninvalidated-write.ts'
import {noUnmountedChrome} from '#judge/no-unmounted-chrome.ts'
import {noUnrelatedJobs} from '#judge/no-unrelated-jobs.ts'
import {noVacuousAssertion} from '#judge/no-vacuous-assertion.ts'
import {noVagueName} from '#judge/no-vague-name.ts'
import {noViewStateInMemory} from '#judge/no-view-state-in-memory.ts'
import {features} from '#lib/features.ts'
import type {Question} from '#lib/question.ts'
import {JudgeError, accessToken} from '#lib/session.ts'
import type {Urls} from '#lib/session.ts'
import type {Unit} from '#lib/units.ts'
import {units} from '#lib/units.ts'

const CONCURRENCY = 16
// At or above this probability a question reports: above TypeSafe's suggested 0.7, since a false yes blocks the gate and every rerun of Jev moves a score near 0.7 across it.
const THRESHOLD = 0.8
// Where an example would live, so Jev reads a test as a test and a component as a component.
const EXAMPLE_FILES = {code: 'src/example.ts', component: 'src/example.tsx', test: 'src/example.test.ts'}
// A component is code too, so it answers the code questions beside its own.
const ASKED = {code: ['code'], component: ['code', 'component'], test: ['test']}
const TACTICS =
	'Each finding is Jev reading that one unit alone. Fix what it names; when the unit cannot show the context that makes it right, put `// judge-ignore <question> -- <reason>` in the comment above it.'

const QUESTIONS = {
	'no-compatibility-code': noCompatibilityCode,
	'no-control-for-wrong-job': noControlForWrongJob,
	'no-detached-action-error': noDetachedActionError,
	'no-dropped-content': noDroppedContent,
	'no-hero-failure': noHeroFailure,
	'no-hidden-side-effect': noHiddenSideEffect,
	'no-imperative-accumulation': noImperativeAccumulation,
	'no-impossible-state': noImpossibleState,
	'no-internals-test': noInternalsTest,
	'no-library-test': noLibraryTest,
	'no-logic-in-io': noLogicInIo,
	'no-misleading-name': noMisleadingName,
	'no-multi-behavior-test': noMultiBehaviorTest,
	'no-one-shot-interpreter': noOneShotInterpreter,
	'no-redundant-check': noRedundantCheck,
	'no-reinvented-helper': noReinventedHelper,
	'no-repeated-block': noRepeatedBlock,
	'no-repeated-fact': noRepeatedFact,
	'no-repeated-search': noRepeatedSearch,
	'no-repeated-text-action': noRepeatedTextAction,
	'no-restating-comment': noRestatingComment,
	'no-roundabout-computation': noRoundaboutComputation,
	'no-roundtrip': noRoundtrip,
	'no-self-fetching-component': noSelfFetchingComponent,
	'no-silent-fallback': noSilentFallback,
	'no-stale-comment': noStaleComment,
	'no-stringly-typed': noStringlyTyped,
	'no-tautological-expectation': noTautologicalExpectation,
	'no-title-mismatch-test': noTitleMismatchTest,
	'no-uninvalidated-write': noUninvalidatedWrite,
	'no-unmounted-chrome': noUnmountedChrome,
	'no-unrelated-jobs': noUnrelatedJobs,
	'no-vacuous-assertion': noVacuousAssertion,
	'no-vague-name': noVagueName,
	'no-view-state-in-memory': noViewStateInMemory
}

type Decision = typeof Decision.Type
const Decision = Schema.Struct({
	answers: Schema.Record(Schema.String, Schema.Struct({noul: Schema.Finite})),
	usage: Schema.optionalKey(Schema.Struct({cost: Schema.optionalKey(Schema.Finite)}))
})
type Refusal = typeof Refusal.Type
const Refusal = Schema.Struct({error: Schema.Struct({message: Schema.String})})

// The judge has printed what failed, so the process exits 1 without logging it again.
class ReportedJudgeError extends Schema.TaggedError<ReportedJudgeError>()('ReportedJudgeError', {}) {
	override readonly [Runtime.errorReported] = false
}

// A question with `key`, the digest of everything Jev reads of it.
type Named = {key: string; name: string; question: Question}

// One unit's questions with no remembered answer, asked together in one call; `key` digests the unit's kind, imports and code.
type Asked = {code: string; file: string; imports: string; key: string; kind: Question['kind']; questions: Named[]}

// One unit's remembered answers by the digest of the question each answers, so rewording or adding a question asks only that question again.
type Verdicts = typeof Verdicts.Type
const Verdicts = Schema.Record(Schema.String, Schema.Finite)

// One cache per user, shared by every worktree and repository, so code judged in one is never asked again in another.
export const layerCache = Layer.provide(
	Layer.unwrap(
		Effect.gen(function* () {
			return KeyValueStore.layerFileSystem(yield* (yield* UserDirectories.UserDirectories).cache('coding-standards'))
		})
	),
	UserDirectories.layer
)

const digestOf = Effect.fnUntraced(function* (parts: readonly string[]) {
	const digest = yield* Digest.Digest
	return yield* digest.digestHex(Digest.sha256, new TextEncoder().encode(Array.join(parts, '\u0000')))
})

// A call missing one answer leaves the code unjudged.
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
				Array.map(asked.questions, named => [
					named.name,
					{
						criteria: {false: named.question.no, true: named.question.yes},
						instructions: named.question.question,
						type: 'noul'
					}
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
		return yield* JudgeError.make({message: 'Gateway refused the sign-in; run `coding-standards sign-in` again'})
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
		verdicts: pipe(
			decision.answers,
			Record.map(answer => answer.noul),
			Option.liftPredicate(found => Array.every(asked.questions, named => Record.has(found, named.name)))
		)
	}
})

const trackedFiles = Effect.fnUntraced(function* (ignore: readonly string[]) {
	const handle = yield* ChildProcess.make(
		'git',
		[
			'ls-files',
			'--cached',
			'--others',
			'--exclude-standard',
			// From the repository's root whichever directory it runs in.
			'--',
			':(top)*.ts',
			':(top)*.tsx',
			...Array.map(ignore, glob => `:(top,exclude,glob)${glob}`)
		],
		{stderr: 'pipe', stdout: 'pipe'}
	)
	return pipe(
		yield* Stream.mkString(Stream.decodeText(handle.stdout)),
		String.split('\n'),
		Array.filter(String.isNonEmpty)
	)
}, Effect.scoped)

type Judged = Asked & {skipped: Named[]; unit: Unit}

type Example = Asked & {side: 'no' | 'yes'; yes: boolean}

function verdictOf(judged: Judged[], examples: Example[], scores: Record<string, number>) {
	function scoreOf(key: string, name: string) {
		return Record.get(scores, `${key}-${name}`)
	}
	return {
		findings: Array.flatMap(judged, entry => [
			...Array.flatMap(entry.questions, named => {
				const where = `${entry.file}:${entry.unit.line} ${named.name}`
				const ignored = HashSet.has(entry.unit.ignores, named.name)
				return Option.match(scoreOf(entry.key, named.name), {
					onNone: () => [],
					onSome: score => {
						if (score >= THRESHOLD && !ignored) return [`${where} ${named.question.message} ${Number.round(score, 2)}`]
						// An ignore goes stale only once Jev clearly answers no: a unit asked again scores within about 0.06, so one near the threshold would otherwise flip between a finding and a stale ignore.
						if (score < 0.5 && ignored) {
							return [`${where} This now passes; remove its judge-ignore comment. ${Number.round(score, 2)}`]
						}
						return []
					}
				})
			}),
			...Array.flatMap(entry.skipped, named => {
				if (!HashSet.has(entry.unit.ignores, named.name)) return []
				return [
					`${entry.file}:${entry.unit.line} ${named.name} Its gate skips this code; remove its judge-ignore comment.`
				]
			})
		]),
		misjudged: Array.flatMap(examples, example =>
			Array.flatMap(example.questions, named =>
				Option.match(scoreOf(example.key, named.name), {
					onNone: () => [],
					onSome: score => {
						if (score >= THRESHOLD === example.yes) return []
						return [`${named.name} misjudges its ${example.side} example. ${Number.round(score, 2)}`]
					}
				})
			)
		)
	}
}

// The questions the unit's record does not answer go to Jev in one call; only a complete answer is written back, merged with the record.
const answer = Effect.fnUntraced(function* <R>(
	asked: Asked,
	store: KeyValueStore.SchemaStore<typeof Verdicts>,
	decided: (asked: Asked) => Effect.Effect<Option.Option<Record<string, number>>, JudgeError, R>
) {
	// Two judges writing one record at once can interleave into text neither wrote; such a record is reported, asked again and rewritten.
	const record = Option.getOrElse(
		yield* Effect.catchTag(store.get(asked.key), 'SchemaError', () =>
			Effect.as(
				Effect.logWarning(`${asked.file}: its remembered answers are unreadable, so it is asked again`),
				Option.none()
			)
		),
		() => Record.empty<string, number>()
	)
	const remembered = Array.flatMap(asked.questions, named =>
		Option.toArray(Option.map(Record.get(record, named.key), score => ({named, score})))
	)
	const missing = Array.filter(asked.questions, named => !Record.has(record, named.key))
	const fresh = yield* Array.match(missing, {
		onEmpty: () => Effect.succeed(Array.empty()),
		onNonEmpty: questions =>
			Effect.flatMap(decided({...asked, questions}), found =>
				Option.match(found, {
					onNone: () => Effect.succeed(Array.empty()),
					onSome: answers => {
						const scored = Array.flatMap(questions, named =>
							Option.toArray(Option.map(Record.get(answers, named.name), score => ({named, score})))
						)
						return Effect.as(
							store.set(asked.key, {
								...record,
								...Record.fromEntries(Array.map(scored, entry => [entry.named.key, entry.score]))
							}),
							scored
						)
					}
				})
			)
	})
	return {
		asked: missing.length,
		remembered: remembered.length,
		scores: Array.map([...remembered, ...fresh], entry => [`${asked.key}-${entry.named.name}`, entry.score] as const)
	}
})

export const judge = Effect.fnUntraced(function* (urls: Urls, ignore: readonly string[]) {
	const fs = yield* FileSystem.FileSystem
	const started = yield* Clock.currentTimeMillis
	const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Verdicts)
	const named = yield* Effect.forEach(
		Record.toEntries(QUESTIONS),
		entry =>
			Effect.map(
				digestOf([
					entry[0],
					entry[1].question,
					...entry[1].yes.cases,
					'\u0001',
					...entry[1].no.cases,
					entry[1].yes.example,
					entry[1].no.example
				]),
				key => ({key, name: entry[0], question: entry[1]})
			),
		{concurrency: 'unbounded'}
	)
	const judged = Array.flatten(
		yield* Effect.forEach(
			yield* trackedFiles(ignore),
			file =>
				Effect.gen(function* () {
					// A file deleted in the working tree stays tracked until the deletion is staged.
					return yield* pipe(
						yield* Effect.option(fs.readFileString(file)),
						Option.match({onNone: Array.empty<Unit>, onSome: source => units(file, source)}),
						Effect.forEach(
							unit => {
								const read = features(unit.text, unit.imports)
								const kind = Array.filter(named, entry => Array.contains(ASKED[unit.kind], entry.question.kind))
								return Effect.map(digestOf([unit.kind, unit.imports, unit.text]), key => ({
									code: unit.text,
									file,
									imports: unit.imports,
									key,
									kind: unit.kind,
									questions: Array.filter(kind, entry => entry.question.gate(read)),
									skipped: Array.filter(kind, entry => !entry.question.gate(read)),
									unit
								}))
							},
							{concurrency: 'unbounded'}
						)
					)
				}),
			{concurrency: CONCURRENCY}
		)
	)
	// A reworded question shows it still answers its own examples, and its gate admits its yes example.
	const allExamples = yield* pipe(
		named,
		Array.flatMap(
			entry =>
				[
					{entry, side: 'yes', yes: true},
					{entry, side: 'no', yes: false}
				] as const
		),
		Effect.forEach(
			example => {
				const code = example.entry.question[example.side].example
				return Effect.map(digestOf([example.entry.question.kind, '', code]), key => ({
					admitted: example.entry.question.gate(features(code, '')),
					code,
					file: EXAMPLE_FILES[example.entry.question.kind],
					imports: '',
					key,
					kind: example.entry.question.kind,
					questions: [example.entry],
					side: example.side,
					yes: example.yes
				}))
			},
			{concurrency: CONCURRENCY}
		)
	)
	const examples = Array.filter(allExamples, example => example.admitted)
	const spent = yield* Ref.make({calls: 0, cost: 0})
	// Signs in only once some code has no remembered answer.
	const token = yield* Effect.cached(Effect.flatMap(accessToken(urls, false), SynchronizedRef.make))
	function decided(asked: Asked) {
		return pipe(
			Effect.flatMap(token, current => decide(urls, current, asked)),
			Effect.tap(found => Ref.update(spent, current => ({calls: current.calls + 1, cost: current.cost + found.cost}))),
			Effect.map(found => found.verdicts),
			// Code Gateway or Jev could not answer stays unjudged and is asked again on the next run.
			Effect.catchIf(
				error => error._tag !== 'JudgeError',
				error => Effect.as(Effect.logWarning(`${asked.file}: ${error.message}`), Option.none<Record<string, number>>())
			)
		)
	}
	// Code that appears twice, or an example that is also a unit, is asked once with every question either needs.
	const answered = yield* Effect.forEach(
		Record.values(Array.groupBy([...judged, ...examples], asked => asked.key)),
		group =>
			answer(
				{
					...Array.headNonEmpty(group),
					questions: pipe(
						group,
						Array.flatMap(asked => asked.questions),
						Array.dedupeWith((first, second) => first.name === second.name)
					)
				},
				store,
				decided
			),
		{concurrency: CONCURRENCY}
	)
	const scores = Record.fromEntries(Array.flatMap(answered, found => found.scores))
	const verdict = verdictOf(judged, examples, scores)
	const misjudged = [
		...Array.flatMap(allExamples, example => {
			if (!example.yes || example.admitted) return []
			return Array.map(example.questions, entry => `${entry.name}'s gate skips its yes example.`)
		}),
		...verdict.misjudged
	]
	const asked = Number.sumAll(Array.map(answered, found => found.asked))
	const remembered = Number.sumAll(Array.map(answered, found => found.remembered))
	const unjudged = asked + remembered - Record.size(scores)
	const totals = yield* Ref.get(spent)
	yield* Effect.forEach([...verdict.findings, ...misjudged], line => Console.log(line), {concurrency: 1, discard: true})
	if (Array.isReadonlyArrayNonEmpty(verdict.findings)) yield* Console.log(TACTICS)
	const distinct = Array.dedupeWith(judged, (first, second) => first.key === second.key)
	yield* Effect.logInfo(
		`judge: ${distinct.length} units; ${asked} questions asked, ${remembered} answered from memory, ${Number.sumAll(Array.map(distinct, entry => entry.skipped.length))} skipped by gates; ${totals.calls} calls, $${Number.round(totals.cost, 4)}, ${Number.round(((yield* Clock.currentTimeMillis) - started) / 1000, 1)}s; ${verdict.findings.length + misjudged.length} findings, ${unjudged} unjudged`
	)
	if (Array.isReadonlyArrayNonEmpty(verdict.findings) || Array.isReadonlyArrayNonEmpty(misjudged) || unjudged > 0) {
		return yield* ReportedJudgeError.make({})
	}
})
