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
import {noUnmountedChrome} from '#judge/no-unmounted-chrome.ts'
import {noUnrelatedJobs} from '#judge/no-unrelated-jobs.ts'
import {noVacuousAssertion} from '#judge/no-vacuous-assertion.ts'
import {noVagueName} from '#judge/no-vague-name.ts'
import {noViewStateInMemory} from '#judge/no-view-state-in-memory.ts'
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
	'no-unmounted-chrome': noUnmountedChrome,
	'no-unrelated-jobs': noUnrelatedJobs,
	'no-vacuous-assertion': noVacuousAssertion,
	'no-vague-name': noVagueName,
	'no-view-state-in-memory': noViewStateInMemory
}

type Verdicts = typeof Verdicts.Type
const Verdicts = Schema.Record(Schema.String, Schema.Finite)

type Decision = typeof Decision.Type
const Decision = Schema.Struct({
	answers: Schema.Record(Schema.String, Schema.Struct({noul: Schema.Finite})),
	usage: Schema.optionalKey(Schema.Struct({cost: Schema.optionalKey(Schema.Finite)}))
})
type Refusal = typeof Refusal.Type
const Refusal = Schema.Struct({error: Schema.Struct({message: Schema.String})})

// The judge has printed what failed, so the process exits 1 without logging it again.
class Failed extends Schema.TaggedError<Failed>()('Failed', {}) {
	override readonly [Runtime.errorReported] = false
}

type Asked = {code: string; file: string; imports: string; kind: Question['kind']; questions: [string, Question][]}

// One cache per user, shared by every worktree and repository, so code judged in one is never asked again in another.
export const layerCache = pipe(
	Layer.unwrap(
		Effect.gen(function* () {
			return KeyValueStore.layerFileSystem(yield* (yield* UserDirectories.UserDirectories).cache('coding-standards'))
		})
	),
	Layer.provide(UserDirectories.layer)
)

// The answers change with the code, the imports it uses and everything Jev reads of each question asked, so rewording one question asks only its kind again.
const withKey = Effect.fnUntraced(function* (asked: Asked) {
	const digest = yield* Digest.Digest
	const parts = [
		asked.kind,
		asked.imports,
		asked.code,
		...Array.flatMap(asked.questions, entry => [
			entry[0],
			entry[1].question,
			...entry[1].yes.cases,
			'\u0001',
			...entry[1].no.cases,
			entry[1].yes.example,
			entry[1].no.example
		])
	]
	return {...asked, key: yield* digest.digestHex(Digest.sha256, new TextEncoder().encode(Array.join(parts, '\u0000')))}
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
				Array.map(asked.questions, entry => [
					entry[0],
					{criteria: {false: entry[1].no, true: entry[1].yes}, instructions: entry[1].question, type: 'noul'}
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
		verdicts: Option.liftPredicate(
			Record.map(decision.answers, answer => answer.noul),
			found => Array.every(asked.questions, entry => Record.has(found, entry[0]))
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
	return Array.filter(String.split('\n')(yield* Stream.mkString(Stream.decodeText(handle.stdout))), String.isNonEmpty)
}, Effect.scoped)

function verdictOf(
	judged: {asked: Asked & {key: string}; unit: Unit}[],
	examples: {asked: Asked & {key: string}; question: [string, Question]; side: 'no' | 'yes'; yes: boolean}[],
	answers: Record<string, Option.Option<Verdicts>>
) {
	function scoreOf(key: string, name: string) {
		return Option.flatMap(Option.flatten(Record.get(answers, key)), Record.get(name))
	}
	return {
		findings: Array.flatMap(judged, entry =>
			Array.flatMap(entry.asked.questions, question => {
				const where = `${entry.asked.file}:${entry.unit.line} ${question[0]}`
				const ignored = HashSet.has(entry.unit.ignores, question[0])
				return Option.match(scoreOf(entry.asked.key, question[0]), {
					onNone: () => [],
					onSome: score => {
						if (score >= THRESHOLD && !ignored) return [`${where} ${question[1].message} ${Number.round(score, 2)}`]
						// An ignore goes stale only once Jev clearly answers no: a unit asked again scores within about 0.06, so one near the threshold would otherwise flip between a finding and a stale ignore.
						if (score < 0.5 && ignored) {
							return [`${where} This now passes; remove its judge-ignore comment. ${Number.round(score, 2)}`]
						}
						return []
					}
				})
			})
		),
		misjudged: Array.flatMap(examples, example =>
			Option.match(scoreOf(example.asked.key, example.question[0]), {
				onNone: () => [],
				onSome: score => {
					if (score >= THRESHOLD === example.yes) return []
					return [`${example.question[0]} misjudges its ${example.side} example. ${Number.round(score, 2)}`]
				}
			})
		),
		unjudged: Array.countBy(Record.values(answers), Option.isNone)
	}
}

export const judge = Effect.fnUntraced(function* (urls: Urls, ignore: readonly string[]) {
	const fs = yield* FileSystem.FileSystem
	const started = yield* Clock.currentTimeMillis
	const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Verdicts)
	const named = Record.toEntries(QUESTIONS)
	const judged = Array.flatten(
		yield* Effect.forEach(
			yield* trackedFiles(ignore),
			file =>
				Effect.gen(function* () {
					// A file deleted in the working tree stays tracked until the deletion is staged.
					return yield* Effect.forEach(
						Option.match(yield* Effect.option(fs.readFileString(file)), {
							onNone: () => [],
							onSome: source => units(file, source)
						}),
						unit =>
							Effect.map(
								withKey({
									code: unit.text,
									file,
									imports: unit.imports,
									kind: unit.kind,
									questions: Array.filter(named, entry => Array.contains(ASKED[unit.kind], entry[1].kind))
								}),
								asked => ({asked, unit})
							),
						{concurrency: 'unbounded'}
					)
				}),
			{concurrency: CONCURRENCY}
		)
	)
	// A reworded question shows it still answers its own examples.
	const examples = yield* Effect.forEach(
		Array.flatMap(
			named,
			question =>
				[
					{question, side: 'yes', yes: true},
					{question, side: 'no', yes: false}
				] as const
		),
		example =>
			Effect.map(
				withKey({
					code: example.question[1][example.side].example,
					file: EXAMPLE_FILES[example.question[1].kind],
					imports: '',
					kind: example.question[1].kind,
					questions: [example.question]
				}),
				asked => ({...example, asked})
			),
		{concurrency: CONCURRENCY}
	)
	const spent = yield* Ref.make({calls: 0, cost: 0})
	// Signs in only once some code has no cached answer.
	const token = yield* Effect.cached(Effect.flatMap(accessToken(urls, false), SynchronizedRef.make))
	const answers = Record.fromEntries(
		yield* Effect.forEach(
			pipe(
				[...Array.map(judged, entry => entry.asked), ...Array.map(examples, entry => entry.asked)],
				Array.dedupeWith((first, second) => first.key === second.key)
			),
			asked =>
				pipe(
					Effect.gen(function* () {
						const cached = yield* store.get(asked.key)
						if (Option.isSome(cached)) return cached
						const decided = yield* decide(urls, yield* token, asked)
						yield* Ref.update(spent, current => ({calls: current.calls + 1, cost: current.cost + decided.cost}))
						yield* Option.match(decided.verdicts, {
							onNone: () => Effect.void,
							onSome: verdicts => store.set(asked.key, verdicts)
						})
						return decided.verdicts
					}),
					// Code Gateway or Jev could not answer stays unjudged and is asked again on the next run.
					Effect.catchIf(
						error => error._tag !== 'JudgeError',
						error => Effect.as(Effect.logWarning(`${asked.file}: ${error.message}`), Option.none<Verdicts>())
					),
					Effect.map(verdicts => [asked.key, verdicts] as const)
				),
			{concurrency: CONCURRENCY}
		)
	)
	const verdict = verdictOf(judged, examples, answers)
	const totals = yield* Ref.get(spent)
	yield* Effect.forEach([...verdict.findings, ...verdict.misjudged], line => Console.log(line), {
		concurrency: 1,
		discard: true
	})
	if (Array.isReadonlyArrayNonEmpty(verdict.findings)) yield* Console.log(TACTICS)
	yield* Effect.log(
		`judge: ${Array.dedupe(Array.map(judged, entry => entry.asked.key)).length} units, ${totals.calls} calls, $${Number.round(totals.cost, 4)}, ${Number.round(((yield* Clock.currentTimeMillis) - started) / 1000, 1)}s; ${verdict.findings.length + verdict.misjudged.length} findings, ${verdict.unjudged} unjudged`
	)
	if (
		Array.isReadonlyArrayNonEmpty(verdict.findings) ||
		Array.isReadonlyArrayNonEmpty(verdict.misjudged) ||
		verdict.unjudged > 0
	) {
		return yield* Failed.make({})
	}
})
