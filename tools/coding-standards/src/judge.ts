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
	Order,
	Path,
	Record,
	Redacted,
	Ref,
	Runtime,
	Schema,
	String,
	SynchronizedRef,
	pipe
} from 'effect'

import {Digest} from 'effect/crypto'
import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {KeyValueStore, UserDirectories} from 'effect/persistence'

import {noBoundaryCrossing} from '#judge/no-boundary-crossing.ts'
import {noCompatibilityCode} from '#judge/no-compatibility-code.ts'
import {noContradictedPromise} from '#judge/no-contradicted-promise.ts'
import {noControlForWrongJob} from '#judge/no-control-for-wrong-job.ts'
import {noDetachedActionError} from '#judge/no-detached-action-error.ts'
import {noDroppedContent} from '#judge/no-dropped-content.ts'
import {noHeroFailure} from '#judge/no-hero-failure.ts'
import {noImpossibleState} from '#judge/no-impossible-state.ts'
import {noInternalsTest} from '#judge/no-internals-test.ts'
import {noLibraryTest} from '#judge/no-library-test.ts'
import {noLogicInIo} from '#judge/no-logic-in-io.ts'
import {noMultiBehaviorTest} from '#judge/no-multi-behavior-test.ts'
import {noNeedlessMachinery} from '#judge/no-needless-machinery.ts'
import {noReinventedHelper} from '#judge/no-reinvented-helper.ts'
import {noRepeatedFact} from '#judge/no-repeated-fact.ts'
import {noRepeatedTextAction} from '#judge/no-repeated-text-action.ts'
import {noRestatingComment} from '#judge/no-restating-comment.ts'
import {noSelfFetchingComponent} from '#judge/no-self-fetching-component.ts'
import {noSilentFallback} from '#judge/no-silent-fallback.ts'
import {noStringlyTyped} from '#judge/no-stringly-typed.ts'
import {noTautologicalExpectation} from '#judge/no-tautological-expectation.ts'
import {noTitleMismatchTest} from '#judge/no-title-mismatch-test.ts'
import {noUninvalidatedWrite} from '#judge/no-uninvalidated-write.ts'
import {noUnmountedChrome} from '#judge/no-unmounted-chrome.ts'
import {noUnprovenClaim} from '#judge/no-unproven-claim.ts'
import {noUnrelatedEdit} from '#judge/no-unrelated-edit.ts'
import {noVacuousAssertion} from '#judge/no-vacuous-assertion.ts'
import {noVagueName} from '#judge/no-vague-name.ts'
import {noViewStateInMemory} from '#judge/no-view-state-in-memory.ts'
import {matches} from '#lib/ast.ts'
import {change} from '#lib/change.ts'
import type {Hunk} from '#lib/change.ts'
import {features} from '#lib/features.ts'
import type {Features} from '#lib/features.ts'
import type {ChangeStates, Kind} from '#lib/question.ts'
import {JudgeError, accessToken} from '#lib/session.ts'
import type {Urls} from '#lib/session.ts'
import type {Unit} from '#lib/units.ts'
import {units} from '#lib/units.ts'

const MODEL = 'typesafe/jev-1.14'
const CONCURRENCY = 16
// At or above this probability a question reports: above TypeSafe's suggested 0.7, since a false yes blocks the gate and every rerun of Jev moves a score near 0.7 across it.
const THRESHOLD = 0.8
// Where an example would live, so Jev reads a test as a test and a component as a component.
const EXAMPLE_FILES = {code: 'src/example.ts', component: 'src/example.tsx', test: 'src/example.test.ts'}
// A component is code too, so it answers the code questions beside its own.
const ASKED: Record<Kind, Kind[]> = {code: ['code'], component: ['code', 'component'], test: ['test']}
const TACTICS =
	'Each finding is Jev reading one unit, one hunk or one claim with what the line names. Fix what it names. When a unit or hunk cannot show the context that makes it right, put `judge-ignore <question> -- <reason>` in a comment above the unit or inside the hunk; when the request already explains a hunk or a claim is not proven, say so in the request.'

// Questions about one function, component or test case the change touches.
export const QUESTIONS = {
	'no-compatibility-code': noCompatibilityCode,
	'no-contradicted-promise': noContradictedPromise,
	'no-control-for-wrong-job': noControlForWrongJob,
	'no-detached-action-error': noDetachedActionError,
	'no-dropped-content': noDroppedContent,
	'no-hero-failure': noHeroFailure,
	'no-impossible-state': noImpossibleState,
	'no-internals-test': noInternalsTest,
	'no-library-test': noLibraryTest,
	'no-logic-in-io': noLogicInIo,
	'no-multi-behavior-test': noMultiBehaviorTest,
	'no-reinvented-helper': noReinventedHelper,
	'no-repeated-fact': noRepeatedFact,
	'no-repeated-text-action': noRepeatedTextAction,
	'no-restating-comment': noRestatingComment,
	'no-self-fetching-component': noSelfFetchingComponent,
	'no-silent-fallback': noSilentFallback,
	'no-stringly-typed': noStringlyTyped,
	'no-tautological-expectation': noTautologicalExpectation,
	'no-title-mismatch-test': noTitleMismatchTest,
	'no-uninvalidated-write': noUninvalidatedWrite,
	'no-unmounted-chrome': noUnmountedChrome,
	'no-vacuous-assertion': noVacuousAssertion,
	'no-vague-name': noVagueName,
	'no-view-state-in-memory': noViewStateInMemory
}

// Questions about the change as a whole, asked of each of its hunks and each line of what it says it does.
export const CHANGE_QUESTIONS = {
	'no-boundary-crossing': noBoundaryCrossing,
	'no-needless-machinery': noNeedlessMachinery,
	'no-unproven-claim': noUnprovenClaim,
	'no-unrelated-edit': noUnrelatedEdit
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

// What one question sends Jev, and `key`, the digest of those bytes and the model reading them.
type Named = {
	key: string
	message: string
	name: string
	prompt: {criteria: {false: unknown; true: unknown}; instructions: string; type: 'noul'}
}

// One call's worth: `state`, everything Jev reads, keyed by its digest, and the questions asked of it. `where` places a finding and `evidence` quotes the request or claim it is about.
type Asked = {
	evidence: string
	ignores: HashSet.HashSet<string>
	key: string
	level: 'change' | 'line'
	questions: Named[]
	skipped: Named[]
	state: Record<string, string>
	where: string
}

type Example = Asked & {yes: boolean}

// One state's remembered answers by the digest of the question each answers, so rewording or adding a question asks only that question again.
type Verdicts = typeof Verdicts.Type
const Verdicts = Schema.Record(Schema.String, Schema.Finite)

// One cache per user, shared by every worktree and repository: a state read in one is never asked again in another.
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

// A state or an example as the digest reads it: every field, in key order.
function fieldsOf(value: string | Record<string, string>) {
	if (String.isString(value)) return [value]
	return pipe(
		Record.toEntries(value),
		Array.sort(Order.mapInput(String.Order, (entry: readonly [string, string]) => entry[0])),
		Array.flatten
	)
}

const namedOf = Effect.fnUntraced(function* (
	name: string,
	question: {
		message: string
		no: {cases: readonly string[]; example: string | Record<string, string>}
		question: string
		yes: {cases: readonly string[]; example: string | Record<string, string>}
	}
) {
	return {
		key: yield* digestOf([
			MODEL,
			name,
			question.question,
			...question.yes.cases,
			'\u0001',
			...question.no.cases,
			'\u0001',
			...fieldsOf(question.yes.example),
			'\u0001',
			...fieldsOf(question.no.example)
		]),
		message: question.message,
		name,
		prompt: {criteria: {false: question.no, true: question.yes}, instructions: question.question, type: 'noul' as const}
	}
})

function bodyOf(asked: Asked) {
	return {
		model: MODEL,
		questions: Record.fromEntries(Array.map(asked.questions, named => [named.name, named.prompt])),
		state: asked.state
	}
}

// About four characters a token, the usual rate for English and code; the price per token is Gateway's to report.
const tokensOf = Effect.fnUntraced(function* (asked: Asked) {
	return Number.round((yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(bodyOf(asked))).length / 4, 0)
})

// A call missing one answer leaves the state unjudged.
const decide = Effect.fnUntraced(function* (
	urls: Urls,
	token: SynchronizedRef.SynchronizedRef<Redacted.Redacted>,
	asked: Asked
) {
	const client = yield* HttpClient.HttpClient
	const request = yield* HttpClientRequest.bodyJson(
		HttpClientRequest.post(`${urls.gateway}/ai/openrouter/alpha/decisions`),
		bodyOf(asked)
	)
	const used = yield* SynchronizedRef.get(token)
	// Calls refused together refresh once: only the first to see the refused token replaces it.
	const response = yield* Effect.filterOrElse(
		client.execute(HttpClientRequest.bearerToken(request, Redacted.value(used))),
		sent => sent.status !== 401,
		() =>
			pipe(
				token,
				SynchronizedRef.updateAndGetEffect(current =>
					Effect.gen(function* () {
						if (current !== used) return current
						return yield* accessToken(urls, true)
					})
				),
				Effect.flatMap(fresh => client.execute(HttpClientRequest.bearerToken(request, Redacted.value(fresh))))
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

function placeOf(file: string, start: number, end: number) {
	if (start === 0) return file
	return `${file}:${start}-${end}`
}

function verdictOf(judged: Asked[], examples: Example[], scores: Record<string, number>) {
	function scoreOf(key: string, name: string) {
		return Record.get(scores, `${key}-${name}`)
	}
	return {
		findings: Array.flatMap(judged, entry => [
			...Array.flatMap(entry.questions, named => {
				const ignored = HashSet.has(entry.ignores, named.name)
				return Option.match(scoreOf(entry.key, named.name), {
					onNone: () => [],
					onSome: score => {
						if (score >= THRESHOLD && !ignored) {
							return [`${entry.where} ${named.name} ${named.message}${entry.evidence} ${Number.round(score, 2)}`]
						}
						// An ignore goes stale only once Jev clearly answers no: a state asked again scores within about 0.06, so one near the threshold would otherwise flip between a finding and a stale ignore.
						if (score < 0.5 && ignored) {
							return [
								`${entry.where} ${named.name} This now passes; remove its judge-ignore comment. ${Number.round(score, 2)}`
							]
						}
						return []
					}
				})
			}),
			...Array.flatMap(entry.skipped, named => {
				if (!HashSet.has(entry.ignores, named.name)) return []
				return [`${entry.where} ${named.name} Its gate skips this code; remove its judge-ignore comment.`]
			})
		]),
		misjudged: Array.flatMap(examples, example =>
			Array.flatMap(example.questions, named =>
				Option.match(scoreOf(example.key, named.name), {
					onNone: () => [],
					onSome: score => {
						if (score >= THRESHOLD === example.yes) return []
						return [`${named.name} misjudges its ${example.where}. ${Number.round(score, 2)}`]
					}
				})
			)
		)
	}
}

// A state's record, read once; a record two judges wrote at once can interleave into text neither wrote, and is reported, asked again and rewritten.
const recordOf = Effect.fnUntraced(function* (asked: Asked, store: KeyValueStore.SchemaStore<typeof Verdicts>) {
	return Option.getOrElse(
		yield* Effect.catchTag(store.get(asked.key), 'SchemaError', () =>
			Effect.as(
				Effect.logWarning(`${asked.where}: its remembered answers are unreadable, so it is asked again`),
				Option.none()
			)
		),
		() => Record.empty<string, number>()
	)
})

// The questions a state's record does not answer go to Jev in one call; only a complete answer is written back, merged with the record.
const answer = Effect.fnUntraced(function* <R>(
	planned: {asked: Asked; missing: Named[]; record: Record<string, number>},
	store: KeyValueStore.SchemaStore<typeof Verdicts>,
	decided: (asked: Asked) => Effect.Effect<Option.Option<Record<string, number>>, JudgeError, R>
) {
	const remembered = Array.flatMap(planned.asked.questions, named =>
		pipe(
			planned.record,
			Record.get(named.key),
			Option.map(score => ({named, score})),
			Option.toArray
		)
	)
	const fresh = yield* Array.match(planned.missing, {
		onEmpty: () => Effect.succeed(Array.empty<{named: Named; score: number}>()),
		onNonEmpty: questions =>
			Effect.flatMap(decided({...planned.asked, questions}), found =>
				Option.match(found, {
					onNone: () => Effect.succeed(Array.empty<{named: Named; score: number}>()),
					onSome: answers => {
						const scored = Array.flatMap(questions, named =>
							pipe(
								answers,
								Record.get(named.name),
								Option.map(score => ({named, score})),
								Option.toArray
							)
						)
						return Effect.as(
							store.set(planned.asked.key, {
								...planned.record,
								...Record.fromEntries(Array.map(scored, entry => [entry.named.key, entry.score]))
							}),
							scored
						)
					}
				})
			)
	})
	return Array.map(
		[...remembered, ...fresh],
		entry => [`${planned.asked.key}-${entry.named.name}`, entry.score] as const
	)
})

const stateKey = Effect.fnUntraced(function* (state: Record<string, string>) {
	return yield* digestOf(fieldsOf(state))
})

export const judge = Effect.fnUntraced(function* (
	urls: Urls,
	options: {base: Option.Option<string>; dryRun: boolean; ignore: readonly string[]}
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const started = yield* Clock.currentTimeMillis
	const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Verdicts)
	const lineQuestions = yield* Effect.forEach(
		Record.toEntries(QUESTIONS),
		entry =>
			Effect.map(namedOf(entry[0], entry[1]), named => ({
				...named,
				gate: entry[1].gate,
				kind: entry[1].kind,
				no: entry[1].no.example,
				yes: entry[1].yes.example
			})),
		{concurrency: 'unbounded'}
	)
	const changeQuestions = yield* Effect.forEach(
		Record.toEntries(CHANGE_QUESTIONS),
		entry =>
			Effect.map(namedOf(entry[0], entry[1]), named => ({
				...named,
				kind: entry[1].kind,
				no: entry[1].no.example,
				yes: entry[1].yes.example
			})),
		{concurrency: 'unbounded'}
	)
	function askedOf(kind: keyof ChangeStates) {
		return Array.filter(changeQuestions, named => named.kind === kind)
	}
	const found = yield* change(options.base, options.ignore)

	const unitAsked = Effect.fnUntraced(function* (file: string, unit: Unit) {
		const read: Features = features(unit.text, unit.imports)
		const kind = Array.filter(lineQuestions, named => Array.contains(ASKED[unit.kind], named.kind))
		const state = {code: unit.text, file, imports: unit.imports}
		return {
			evidence: '',
			ignores: unit.ignores,
			key: yield* stateKey(state),
			level: 'line' as const,
			questions: Array.filter(kind, named => named.gate(read)),
			skipped: Array.filter(kind, named => !named.gate(read)),
			state,
			where: placeOf(file, unit.line, unit.end)
		}
	})
	// Line-level questions read the units whose lines, or the comments right above them, the change touched.
	const lineAsked = Array.flatten(
		yield* Effect.forEach(
			Record.toEntries(found.touched),
			entry => {
				if (!matches(/\.tsx?$/u)(entry[0])) return Effect.succeed(Array.empty<Asked>())
				const touched = HashSet.fromIterable(entry[1])
				return pipe(
					fs.readFileString(path.join(found.root, entry[0])),
					Effect.map(source =>
						Array.filter(units(entry[0], source), unit =>
							Array.some(Array.range(unit.start, unit.end), line => HashSet.has(touched, line))
						)
					),
					Effect.flatMap(Effect.forEach(unit => unitAsked(entry[0], unit), {concurrency: 'unbounded'}))
				)
			},
			{concurrency: CONCURRENCY}
		)
	)
	const hunkAsked = Effect.fnUntraced(function* (hunk: Hunk) {
		const edit = {edit: hunk.text, file: hunk.file}
		const scope = {...edit, request: found.request}
		const where = placeOf(hunk.file, hunk.start, hunk.end)
		return [
			{
				evidence: '',
				ignores: hunk.ignores,
				key: yield* stateKey(edit),
				level: 'change' as const,
				questions: askedOf('edit'),
				skipped: [],
				state: edit,
				where
			},
			{
				evidence: ` Request: "${pipe(found.request, String.trim, String.split('\n'), Array.headNonEmpty)}".`,
				ignores: hunk.ignores,
				key: yield* stateKey(scope),
				level: 'change' as const,
				questions: askedOf('scope'),
				skipped: [],
				state: scope,
				where
			}
		]
	})
	const changeAsked = [
		...Array.flatten(yield* Effect.forEach(found.hunks, hunkAsked, {concurrency: 'unbounded'})),
		...(yield* Effect.forEach(
			found.claims,
			claim =>
				Effect.map(stateKey({claim: claim.text, proof: claim.proof}), key => ({
					evidence: ` Claim: "${claim.text}".`,
					ignores: HashSet.empty<string>(),
					key,
					level: 'change' as const,
					questions: askedOf('claim'),
					skipped: [],
					state: {claim: claim.text, proof: claim.proof},
					where: claim.where
				})),
			{concurrency: 'unbounded'}
		))
	]
	const judged: Asked[] = [...lineAsked, ...changeAsked]

	// A reworded question shows it still answers its own examples, and its gate admits its yes example.
	const lineExamples = yield* pipe(
		lineQuestions,
		Array.flatMap(named => [
			{code: named.yes, named, side: 'yes', yes: true},
			{code: named.no, named, side: 'no', yes: false}
		]),
		Effect.forEach(
			example => {
				const state = {code: example.code, file: EXAMPLE_FILES[example.named.kind], imports: ''}
				return Effect.map(stateKey(state), key => ({
					admitted: example.named.gate(features(example.code, '')),
					evidence: '',
					ignores: HashSet.empty<string>(),
					key,
					level: 'line' as const,
					questions: [example.named],
					skipped: [],
					state,
					where: `${example.side} example`,
					yes: example.yes
				}))
			},
			{concurrency: CONCURRENCY}
		)
	)
	const changeExamples = yield* pipe(
		changeQuestions,
		Array.flatMap(named => [
			{named, side: 'yes', state: named.yes, yes: true},
			{named, side: 'no', state: named.no, yes: false}
		]),
		Effect.forEach(
			example =>
				Effect.map(stateKey(example.state), key => ({
					evidence: '',
					ignores: HashSet.empty<string>(),
					key,
					level: 'change' as const,
					questions: [example.named],
					skipped: [],
					state: example.state,
					where: `${example.side} example`,
					yes: example.yes
				})),
			{concurrency: CONCURRENCY}
		)
	)
	const examples: Example[] = [...Array.filter(lineExamples, example => example.admitted), ...changeExamples]
	const gateMisses = Array.flatMap(lineExamples, example => {
		if (!example.yes || example.admitted) return []
		return Array.map(example.questions, named => `${named.name}'s gate skips its yes example.`)
	})

	// A state that appears twice, or an example that is also a unit, is asked once with every question either needs.
	const planned = yield* Effect.forEach(
		Record.values(Array.groupBy([...judged, ...examples], asked => asked.key)),
		group => {
			const asked = {
				...Array.headNonEmpty(group),
				questions: pipe(
					group,
					Array.flatMap(entry => entry.questions),
					Array.dedupeWith((first, second) => first.name === second.name)
				)
			}
			return Effect.gen(function* () {
				const record = yield* recordOf(asked, store)
				const missing = Array.filter(asked.questions, named => !Record.has(record, named.key))
				return {asked, missing, record, tokens: yield* tokensOf({...asked, questions: missing})}
			})
		},
		{concurrency: CONCURRENCY}
	)
	const calls = Array.filter(planned, entry => Array.isArrayNonEmpty(entry.missing))
	function askedAt(level: Asked['level']) {
		return pipe(
			calls,
			Array.filter(entry => entry.asked.level === level),
			Array.map(entry => entry.missing.length),
			Number.sumAll
		)
	}
	const asked = askedAt('line') + askedAt('change')
	const remembered = Number.sumAll(Array.map(planned, entry => entry.asked.questions.length - entry.missing.length))
	const scale = `${found.source}: ${Array.dedupeWith(lineAsked, (first, second) => first.key === second.key).length} units, ${found.hunks.length} hunks, ${found.claims.length} claims; ${asked} questions asked (${askedAt('line')} line-level, ${askedAt('change')} change-level) in ${calls.length} calls, ~${Number.sumAll(Array.map(calls, entry => entry.tokens))} tokens; ${remembered} answered from memory, ${Number.sumAll(Array.map(lineAsked, entry => entry.skipped.length))} skipped by gates`

	if (options.dryRun) {
		yield* Effect.forEach(
			calls,
			entry =>
				Console.log(
					`${entry.asked.where} ~${entry.tokens} tokens: ${pipe(
						entry.missing,
						Array.map(named => named.name),
						Array.join(', ')
					)}`
				),
			{concurrency: 1, discard: true}
		)
		yield* Effect.logInfo(`judge, dry run: ${scale}; nothing was sent`)
		return
	}

	const spent = yield* Ref.make({calls: 0, cost: 0})
	// Signs in only once some state has no remembered answer.
	const token = yield* Effect.cached(Effect.flatMap(accessToken(urls, false), SynchronizedRef.make))
	function decided(call: Asked) {
		return pipe(
			Effect.flatMap(token, current => decide(urls, current, call)),
			Effect.tap(result =>
				Ref.update(spent, current => ({calls: current.calls + 1, cost: current.cost + result.cost}))
			),
			Effect.map(result => result.verdicts),
			// A state Gateway or Jev could not answer stays unjudged and is asked again on the next run.
			Effect.catchIf(
				error => error._tag !== 'JudgeError',
				error => Effect.as(Effect.logWarning(`${call.where}: ${error.message}`), Option.none<Record<string, number>>())
			)
		)
	}
	const scores = Record.fromEntries(
		Array.flatten(yield* Effect.forEach(planned, entry => answer(entry, store, decided), {concurrency: CONCURRENCY}))
	)
	const verdict = verdictOf(judged, examples, scores)
	const misjudged = [...gateMisses, ...verdict.misjudged]
	const unjudged = asked + remembered - Record.size(scores)
	const totals = yield* Ref.get(spent)
	yield* Effect.forEach([...verdict.findings, ...misjudged], line => Console.log(line), {concurrency: 1, discard: true})
	if (Array.isReadonlyArrayNonEmpty(verdict.findings)) yield* Console.log(TACTICS)
	yield* Effect.logInfo(
		`judge: ${scale}; ${totals.calls} calls made, $${Number.round(totals.cost, 4)}, ${Number.round(((yield* Clock.currentTimeMillis) - started) / 1000, 1)}s; ${verdict.findings.length + misjudged.length} findings, ${unjudged} unjudged`
	)
	if (Array.isReadonlyArrayNonEmpty(verdict.findings) || Array.isReadonlyArrayNonEmpty(misjudged) || unjudged > 0) {
		return yield* ReportedJudgeError.make({})
	}
})
