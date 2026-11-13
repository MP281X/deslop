import {NodeServices} from '@effect/platform-node'
import {assert, describe, it} from '@effect/vitest'

import {Array, Effect, FileSystem, HashSet, Option, Order, Path, Record, Schema, Stream, String, pipe} from 'effect'

import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import plugin from '#lint.ts'

type OxlintOutput = typeof OxlintOutput.Type
const OxlintOutput = Schema.Struct({
	diagnostics: Schema.Array(
		Schema.Struct({
			code: Schema.String,
			filename: Schema.optional(Schema.String),
			labels: Schema.Array(Schema.Struct({span: Schema.Struct({line: Schema.Finite})})),
			message: Schema.String
		})
	)
})

const lintSource = Effect.fnUntraced(function* (input: Record<string, string>, flags: string[] = []) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const directory = yield* fs.makeTempDirectoryScoped({prefix: 'deslop-lint-'})
	yield* Effect.forEach(
		Record.toEntries(input),
		entry => {
			const file = path.join(directory, entry[0])
			return Effect.flatMap(fs.makeDirectory(path.dirname(file), {recursive: true}), () =>
				fs.writeFileString(file, String.replace(/^((?:import[^\n]*\n)+)(?!\n)/u, '$1\n')(entry[1]))
			)
		},
		{concurrency: 'unbounded'}
	)
	const files = Array.map(Record.keys(input), name => path.join(directory, name))
	const root = path.resolve(import.meta.dirname, '../../..')
	const read = Effect.forEach(files, file => fs.readFileString(file), {concurrency: 'unbounded'})
	const lint = Effect.scoped(
		Effect.flatMap(
			ChildProcess.make('vp', ['lint', ...files, '--format=json', '--type-aware', '--type-check', ...flags], {
				cwd: root,
				stderr: 'pipe',
				stdout: 'pipe'
			}),
			handle =>
				Effect.all(
					{
						exitCode: handle.exitCode,
						stderr: Stream.mkString(Stream.decodeText(handle.stderr)),
						stdout: Stream.mkString(Stream.decodeText(handle.stdout))
					},
					{concurrency: 'unbounded'}
				)
		)
	)
	// A fix that edits an import and its use spans both, so overlapping fixes land on the next `fix` run; the test asserts where those runs settle.
	const pass = Effect.gen(function* () {
		const before = yield* read
		const linted = yield* lint
		const after = yield* read
		return {
			linted,
			settled: !Array.contains(flags, '--fix') || Array.makeEquivalence(String.Equivalence)(before, after)
		}
	})
	const result = (yield* Effect.repeat(pass, {times: 9, until: outcome => outcome.settled})).linted
	// The repository's fix command formats after the lint fixes, so a fixed source is compared as the formatter leaves it.
	if (Array.contains(flags, '--fix')) {
		yield* Effect.flatMap(ChildProcess.make('vp', ['fmt', ...files], {cwd: root}), formatter => formatter.exitCode)
	}
	return {
		exitCode: result.exitCode,
		sources: yield* read,
		// Rolldown appends a plugin timing warning on a loaded host; it is not a lint diagnostic.
		stderr: pipe(
			String.split(result.stderr, '\n'),
			Array.takeWhile(line => !String.includes('[PLUGIN_TIMINGS]')(line)),
			Array.join('\n'),
			String.trim
		),
		stdout: yield* Schema.decodeEffect(Schema.fromJsonString(OxlintOutput))(result.stdout)
	}
})

// The lines a rule reports in the first source, beside the lines that source marks `// reported`.
function reportedLines(result: {sources: string[]; stdout: OxlintOutput}, rule: string) {
	return {
		marked: pipe(
			String.split(result.sources[0] ?? '', '\n'),
			Array.map((line, index) => ({line, number: index + 1})),
			Array.filter(entry => String.includes('// reported')(entry.line)),
			Array.map(entry => entry.number)
		),
		reported: pipe(
			result.stdout.diagnostics,
			Array.filter(diagnostic => diagnostic.code === `@deslop/coding-standards(${rule})`),
			Array.map(diagnostic => diagnostic.labels[0]?.span.line ?? 0),
			Array.dedupe,
			Array.sort(Order.Number)
		)
	}
}

function customCodes(output: OxlintOutput) {
	const codes = HashSet.fromIterable(Array.map(Record.keys(plugin.rules), rule => `@deslop/coding-standards(${rule})`))
	return pipe(
		output.diagnostics,
		Array.map(diagnostic => diagnostic.code),
		Array.filter(code => HashSet.has(codes, code)),
		Array.sort(String.Order)
	)
}

describe('deslop Oxlint plugin', {concurrent: true}, () => {
	it.layer(NodeServices.layer)(testApi => {
		testApi.effect(
			'checks service ownership names against their folders',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'src/lib/utils.ts': 'export const value = 1',
					'src/services/ai/service.ts':
						"import {Context} from 'effect'\nexport class AiProxy extends Context.Service<AiProxy, {}>()('AiProxy') {}",
					'src/services/ai-proxy/service.ts':
						"import {Context} from 'effect'\nexport class AiProxy extends Context.Service<AiProxy, {}>()('AiProxy') {}",
					'src/services/github/service.ts':
						"import {Context} from 'effect'\nexport class GitHub extends Context.Service<GitHub, {}>()('GitHub') {}",
					'src/services/notes/lib/utils.ts': 'export const value = 1',
					'src/services/tracking/service.ts':
						"import {Context} from 'effect'\nexport class Tracker extends Context.Service<Tracker, {}>()('Tracker') {}"
				})
				assert.deepStrictEqual(customCodes(result.stdout), [
					'@deslop/coding-standards(service-schema-file)',
					'@deslop/coding-standards(service-schema-file)',
					'@deslop/coding-standards(service-schema-file)'
				])
			})
		)
		testApi.effect(
			'reports literal partials, effect wrappers, type aliases and forwarded component props',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'wrappers.tsx': Array.join(
						[
							"import {Effect, Number} from 'effect'",
							'declare const Widget: (props: {title: string; size: string}) => React.ReactNode',
							'type Original = {id: string}',
							'export type Alias = Original',
							'function rounded(value: number) { return Number.round(value, 1) }',
							'export const points = [rounded(1.25), rounded(2.25)]',
							'const read = Effect.fnUntraced(function* (id: string) { return yield* Effect.succeed(id) })',
							'export const task = read("a")',
							'const traced = Effect.fn("Task.read")(function* (id: string) { return yield* Effect.succeed(id) })',
							'export const namedTask = traced("b")',
							'export function AppBarTab(props: {title: string}) { return <Widget title={props.title} size="sm" /> }',
							'function MenuFailure(props: {title: string}) { return <Widget title={props.title} size="sm" /> }',
							'export const menus = <><MenuFailure title="a" /><MenuFailure title="b" /></>',
							'function Forward(props: {title: string; size: string}) { return <Widget title={props.title} size={props.size} /> }',
							'export const forwarded = <Forward title="a" size="sm" />',
							'export function Label(props: {title: string}) { return <span>{props.title}</span> }',
							'export function Computed(props: {title: string}) { return <Widget title={`${props.title}!`} size="sm" /> }'
						],
						'\n'
					)
				})
				assert.lengthOf(
					Array.filter(customCodes(result.stdout), code => code === '@deslop/coding-standards(no-trivial-indirection)'),
					5
				)
			})
		)
		testApi.effect(
			'fixes call forms to a convergent pipeline without moving effectful arguments',
			Effect.fnUntraced(function* () {
				const fixed = yield* lintSource(
					{
						'calls.ts': Array.join(
							[
								"import {Array, Context, Effect, Option, pipe, String} from 'effect'",
								'declare const values: number[]',
								'declare const read: () => number',
								'declare const readValues: () => number[]',
								'declare const count: number',
								'declare const transform: (values: number[], count: number) => number[]',
								'export const one = pipe(values, Array.take(2))',
								'export const nested = Array.join(Array.map(values, value => `${value}`), ",")',
								'export const applied = Array.take(2)(values)',
								'export const ordered = Array.take(Array.drop(values, read()), read())',
								'export const curriedOnly = String.includes("x")("text")',
								'export const unchanged = pipe(values, Array.drop(1), Array.take(2))',
								'export const unsafe = Array.take(read())(readValues())',
								'export class Service extends Context.Service<Service, {}>()("Service") {}',
								'export const forwarding = pipe(Option.some(1), value => Option.filter(value, value => value > 0), value => Option.map(value, value => value + 1))',
								'export const singleForward = pipe(values, value => Array.take(value, 2))',
								'export const appliedArrow = (value => Array.take(value, 2))(values)',
								'export const ordinaryForward = pipe(values, value => transform(value, 2))',
								'export const ordinaryApplied = (value => transform(value, 2))(values)',
								'export function shadow(Array: {take: (value: number) => number}) { return Array.take(count) }'
							],
							'\n'
						)
					},
					['--fix']
				)
				assert.include(fixed.sources[0] ?? '', 'Array.take(values, 2)')
				assert.include(fixed.sources[0] ?? '', 'export const singleForward = Array.take(values, 2)')
				assert.include(fixed.sources[0] ?? '', 'export const appliedArrow = Array.take(values, 2)')
				assert.include(fixed.sources[0] ?? '', 'export const ordinaryForward = transform(values, 2)')
				assert.include(fixed.sources[0] ?? '', 'export const ordinaryApplied = transform(values, 2)')
				assert.notInclude(fixed.sources[0] ?? '', 'value => Option.filter(value,')
				assert.include(fixed.sources[0] ?? '', 'Array.map(value => `${value}`)')
				assert.include(fixed.sources[0] ?? '', 'Array.take(Array.drop(values, read()), read())')
				assert.include(fixed.sources[0] ?? '', "Context.Service<Service, {}>()('Service')")
				assert.include(fixed.sources[0] ?? '', 'Option.filter(value => value > 0)')
				assert.notMatch(fixed.sources[0] ?? '', /\b(?:pipelineSubject|subject)\d+\b/u)
				assert.include(fixed.sources[0] ?? '', "String.includes('x')('text')")
				assert.include(fixed.sources[0] ?? '', 'Array.take(read())(readValues())')
				assert.lengthOf(
					Array.filter(
						fixed.stdout.diagnostics,
						diagnostic => diagnostic.code === '@deslop/coding-standards(effect-call-form)'
					),
					1
				)
				assert.deepStrictEqual(
					(yield* lintSource({'calls.ts': fixed.sources[0] ?? ''}, ['--fix'])).sources,
					fixed.sources
				)
			})
		)
		testApi.effect(
			'rejects copying fold accumulators while keeping scalar, persistent and fixed-shape folds',
			Effect.fnUntraced(function* () {
				const source = [
					"import {Array, Boolean, HashMap, MutableList, Record, pipe} from 'effect'",
					'',
					'declare const items: string[]',
					'export const badSpread = Array.reduce(items, [], (all, item) => [...all, item])',
					'export const badPrepend = Array.reduceRight(items, [], (all, item) => [item, ...all])',
					'export const badRecord = Array.reduce(items, {}, (all, item) => ({...all, [item]: item}))',
					'export const badAppend = Array.reduce(items, [], (all, item) => Array.append(all, item))',
					'export const badOptionalCopy = Array.reduce(items, [], (all, item) => Array.append?.(all, item))',
					'export const badAppendAll = Array.reduce(items, [], (all, item) => Array.appendAll(all, [item]))',
					'export const badPrependAll = Array.reduce(items, [], (all, item) => Array.prependAll(all, [item]))',
					'export const badRightAppendAll = Array.reduce(items, [], (all, item) => Array.appendAll([item], all))',
					'export const badRightPrependAll = Array.reduce(items, [], (all, item) => Array.prependAll([item], all))',
					'export const badCurriedAppendAll = Array.reduce(items, [], (all, item) => Array.appendAll(all)([item]))',
					'export const badCurriedPrependAll = Array.reduce(items, [], (all, item) => Array.prependAll(all)([item]))',
					'export const badPipedAppendAll = Array.reduce(items, [], (all, item) => pipe([item], Array.appendAll(all)))',
					'export const badPipedPrependAll = Array.reduce(items, [], (all, item) => pipe([item], Array.prependAll(all)))',
					'export const badSet = Array.reduce(items, {}, (all, item) => Record.set(all, item, item))',
					'export const badCurried = pipe(items, Array.reduce([], (all, item) => Array.prepend(item)(all)))',
					'export const badPipe = Array.reduce(items, [], (all, item) => pipe(all, Array.append(item)))',
					'export const badCurriedSet = Array.reduce(items, {}, (all, item) => Record.set(item, item)(all))',
					'export const badFunction = Array.reduce(items, [], function (all, item) { return [...all, item] })',
					'export const badBranch = Array.reduce(items, [], (all, item) => Boolean.match(item.length > 0, {onFalse: () => all, onTrue: () => [...all, item]}))',
					'export const badDuplicate = Array.reduce(items, [], (all, item) => [...all, ...all, item])',
					'export const goodScalar = Array.reduce(items, 0, (all, item) => all + item.length)',
					'export const goodPersistent = Array.reduce(items, HashMap.empty(), (all, item) => HashMap.set(all, item, item))',
					'export const goodFixed = Array.reduce(items, {count: 0}, (all, item) => ({...all, count: all.count + item.length}))',
					'export const goodCollector = Array.reduce(items, MutableList.make(), (all, item) => { MutableList.append(all, item); return all })',
					'export const goodElement = Array.reduce(items, [], (all, item) => [all, item])',
					'export const goodAppendElement = Array.reduce(items, [], (all, item) => Array.append([item], all))',
					'export const goodPrependElement = Array.reduce(items, [], (all, item) => Array.prepend([item], all))',
					'export const goodCurriedElement = Array.reduce(items, [], (all, item) => Array.append(all)([item]))',
					'export const goodPipedElement = Array.reduce(items, [], (all, item) => pipe([item], Array.prepend(all)))',
					'export const goodRecordValue = Array.reduce(items, {}, (all, item) => Record.set({}, item, all))',
					'export const goodBareAppendAll = Array.reduce(items, Array.empty<unknown>(), (all, item) => [item, Array.appendAll(all)])',
					'export const goodBarePrependAll = Array.reduce(items, Array.empty<unknown>(), (all, item) => [item, Array.prependAll(all)])',
					'export const goodShadow = Array.reduce(items, [], (all, item) => { const copy = (all: string[]) => [...all, item]; return [all, copy(items)] })',
					'export const goodOther = Array.reduce(items, [], (all, item) => [...items, item])',
					'export const goodReset = Array.reduce(items, [], (all, item) => pipe(all, () => [], Array.append(item)))',
					'export function goodLocal(Array: {reduce: Function}) { return Array.reduce(items, [], (all, item) => [...all, item]) }'
				]
				const result = yield* lintSource({'copies.ts': Array.join(source, '\n')})
				assert.strictEqual(result.stderr, '')
				assert.deepStrictEqual(
					pipe(
						result.stdout.diagnostics,
						Array.filter(diagnostic => diagnostic.code === '@deslop/coding-standards(no-accumulating-copy)'),
						Array.map(diagnostic => source[(diagnostic.labels[0]?.span.line ?? 0) - 1] ?? ''),
						Array.sort(String.Order)
					),
					pipe(source, Array.filter(String.startsWith('export const bad')), Array.sort(String.Order))
				)
			})
		)

		testApi.effect(
			'reports every project-specific invalid state',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'invalid.tsx': Array.join(
						[
							"import {Array, Context, Effect, Layer, Option as Maybe, Schema, SchemaGetter, SchemaTransformation, identity, pipe} from 'effect'",
							"import * as React from 'react'",
							"import {useRef, useState} from 'react'",
							'',
							'declare const input: unknown',
							'declare const source: string',
							'declare const values: string[]',
							'const mappedValues = values.map(value => value.length)',
							'const decode =Schema.decodeUnknownSync(Schema.String)',
							'const operations = {decode: Schema.decodeUnknownSync(Schema.String)}',
							'export const frozen = Object.freeze({decode: Schema.decodeUnknownSync(Schema.String)})',
							'class Codecs { decode = Schema.decodeUnknownSync(Schema.String) }',
							'const decoders = [Schema.decodeUnknownSync(Schema.String)]',
							'const IsString = Schema.is(Schema.String)',
							'const AssertString = Schema.asserts(Schema.String)',
							'let assigned = decode',
							'assigned = Schema.decodeUnknownSync(Schema.String)',
							'const MissingType = Schema.Struct({value: Schema.String})',
							'type NonEmpty = typeof NonEmpty.Type',
							'const NonEmpty = Schema.String.check(Schema.isMinLength(1))',
							'type PipedNonEmpty = typeof PipedNonEmpty.Type',
							'const PipedNonEmpty = pipe(Schema.String, Schema.check(Schema.isNonEmpty()))',
							'type PipedTrimmed = typeof PipedTrimmed.Type',
							'const PipedTrimmed = Schema.String.pipe(Schema.check(Schema.isTrimmed()))',
							'const MissingFluent = Schema.String.annotate({description: "value"})',
							'const MissingTransform = Schema.decodeTo(Schema.Number, SchemaTransformation.transform({decode: Number, encode: String}))(Schema.String)',
							'const MissingDecode = Schema.decode({decode: SchemaGetter.transform(identity), encode: SchemaGetter.transform(identity)})(Schema.String)',
							'const MissingEncode = Schema.encode({decode: SchemaGetter.transform(identity), encode: SchemaGetter.transform(identity)})(Schema.String)',
							'type Tree = typeof Tree.Type',
							'const Tree: Schema.Codec<Tree> = Schema.Struct({children: Schema.Array(Schema.suspend((): Schema.Codec<Tree> => Tree))})',
							'export type Public = typeof Public.Type',
							'const Public = Schema.Struct({name: Schema.String})',
							'type Private = typeof Private.Type',
							'export const Private = Schema.Struct({name: Schema.String})',
							'type InlineType = typeof InlineType.Type',
							'const InlineType = Schema.Struct({name: Schema.String})',
							'export {type InlineType}',
							'export function publicName(value: typeof Public.Type) { return value.name }',
							'class Clock extends Context.Service<Clock, {now: Effect.Effect<number>; get tick(): Effect.Effect<void>}>()("Clock") {}',
							'const makeClock = Effect.gen(function* () { return {now: Effect.succeed(1), tick: () => Effect.void} })',
							'declare const ClockLive: {layer: Layer.Layer<Clock>}',
							'const clockService = ClockLive.layer',
							'const clockLayers = Layer.mergeAll(Layer.effect(Clock, makeClock), clockService)',
							'const ref = useRef<HTMLElement | null>(null)',
							'const namespaceRef = React.useRef<HTMLElement | null>(null)',
							'const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(source)',
							'function forward(value: string) { return consume(value) }',
							'function ready() { return source.length > 0 }',
							'const noValues = values.length === 0',
							'function run() { consume(source) }',
							'function consume(value: string) { return value.length }',
							'function sourceLength(value: {text: string}) { return consume(value.text) }',
							'const measured = sourceLength({text: source})',
							'const callbacks = {consume: (value: string) => consume(value)}',
							'const alias = source',
							'export const legacyAlias = consume',
							'function Fallback() { return <div className="missing" /> }',
							'const fallbacks = Array.map([input], Fallback)',
							'const notFound = () => Array.empty<string>()',
							'const emptyNames = () => "none"',
							'declare const maybe: Maybe.Option<string>',
							'const unwrapped = Maybe.isSome(maybe) ? maybe.value : ""',
							'declare const loosely: string | null | undefined',
							'const present = loosely !== null && loosely !== undefined',
							'const absent = Array.isArrayEmpty(values) || loosely === null || loosely === undefined',
							'declare const holder: {slot: Maybe.Option<string>}',
							'function slotLength() { if (Maybe.isNone(holder.slot)) return 0; return holder.slot.value.length }',
							'function kind(value: number) { switch (value) { case 1: return "one"; default: return "many" } }',
							'const namesA = emptyNames()',
							'const namesB = emptyNames()',
							'const asyncConstant = async () => "ready"',
							'const recipients = Array.isArray(input) ? input : [input]',
							'const wrapped = !Array.isArray(input) ? [input] : input',
							'const [fake] = useState(() => ({current: null}))',
							'const state = useState(0)',
							'const [fakeNamespace] = React.useState(() => ({current: null}))',
							'const stateNamespace = React.useState(0)',
							'function isText(value: unknown): value is string { return typeof value === "string" }',
							'const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)',
							'const label = "ready"',
							'const labelled = consume(label)',
							'declare function download(id: string): Promise<string>',
							'const handlers = {load: (id: string) => Effect.tryPromise(() => download(id)), size: (id: string) => pipe(id, Effect.succeed)}',
							'function greet(name: string): string { return `hi ${name}` }',
							'function logName(name: string): void { consume(name) }',
							'declare class Box { constructor(size: number) }',
							'const makeBox = (size: number): Box => new Box(size)',
							'export const makeBytes = (): Uint8Array => new Uint8Array(4)',
							'function slotPair() { const slot = holder.slot; return [slot, slot] }',
							'const keyed = "slot" in holder',
							'function succeed(value: number) { return Effect.succeed(value) }',
							'function withHead(rest: string[]) { return Array.prepend("a")(rest) }',
							'const lazy = Effect.suspend((): Effect.Effect<number> => Effect.succeed(1))',
							'function described(): string { return described.name }',
							'const empties: string[] = []',
							'class Missing extends Schema.TaggedError<Missing>()("Missing", {}) {}',
							'const failing = Effect.gen(function* () { yield* Effect.void; return yield* Effect.fail(new Missing()) })',
							'const failingFn = Effect.fn("failing")(function* (id: string) { yield* Effect.logInfo(id); return yield* Effect.fail(Missing.make({})) })',
							'// The loader reads the value first.',
							'// Then it checks the value.',
							'/* Explains the next line\n   across two lines */',
							'// Compares the raw state.',
							'// judge-ignore no-repeated-search -- this input keeps its reason',
							'// oxlint-disable-next-line eqeqeq',
							'const loose = source == "ready"',
							'// oxlint-disable-next-line sort-keys -- this input keeps its order',
							'const unsortedKeys = {b: 1, a: 2}',
							'// @effect-diagnostics-next-line floatingEffect:off',
							'export {AssertString, Clock, clockLayers, Codecs, NonEmpty, PipedNonEmpty, PipedTrimmed, absent, Fallback, IsString, Maybe, MissingDecode, MissingEncode, MissingFluent, MissingTransform, MissingType, Tree, alias, assigned, asyncConstant, callbacks, decode, decoded, decoders, empties, failing, failingFn, fake, fakeNamespace, fallbacks, forward, greet, handlers, input, isRecord, isText, makeBox, labelled, logName, loose, kind, mappedValues, measured, keyed, lazy, described, namesA, namesB, namespaceRef, noValues, present, slotLength, slotPair, notFound, operations, ready, recipients, ref, run, stateNamespace, succeed, unsortedKeys, unwrapped, withHead, wrapped}'
						],
						'\n'
					)
				})
				assert.strictEqual(result.exitCode, ChildProcessSpawner.ExitCode(1))
				assert.deepStrictEqual(
					customCodes(result.stdout),
					Array.sort(
						[
							'@deslop/coding-standards(effect-call-form)',
							'@deslop/coding-standards(effect-call-form)',
							'@deslop/coding-standards(effect-call-form)',
							'@deslop/coding-standards(module-constant)',
							'@deslop/coding-standards(no-trivial-indirection)',
							'@deslop/coding-standards(no-effect-property-arrow)',
							'@deslop/coding-standards(no-effect-property-arrow)',
							'@deslop/coding-standards(no-double-nullish-check)',
							'@deslop/coding-standards(no-double-nullish-check)',
							'@deslop/coding-standards(no-fake-ref-state)',
							'@deslop/coding-standards(no-fake-ref-state)',
							'@deslop/coding-standards(prefer-predicate)',
							'@deslop/coding-standards(prefer-predicate)',
							'@deslop/coding-standards(no-multiline-comment)',
							'@deslop/coding-standards(no-multiline-comment)',
							'@deslop/coding-standards(no-native-emptiness-check)',
							'@deslop/coding-standards(no-native-emptiness-check)',
							'@deslop/coding-standards(no-option-value-access)',
							'@deslop/coding-standards(no-option-value-access)',
							'@deslop/coding-standards(no-return-type)',
							'@deslop/coding-standards(no-return-type)',
							'@deslop/coding-standards(no-return-type)',
							'@deslop/coding-standards(no-return-type)',
							'@deslop/coding-standards(no-return-type)',
							'@deslop/coding-standards(no-return-type)',
							'@deslop/coding-standards(no-property-alias)',
							'@deslop/coding-standards(no-trivial-indirection)',
							'@deslop/coding-standards(no-redundant-use-ref-null-type)',
							'@deslop/coding-standards(no-redundant-use-ref-null-type)',
							'@deslop/coding-standards(no-redundant-variable-annotation)',
							'@deslop/coding-standards(no-reinvented-schema)',
							'@deslop/coding-standards(no-reinvented-schema)',
							'@deslop/coding-standards(no-reinvented-schema)',
							'@deslop/coding-standards(no-renamed-import)',
							'@deslop/coding-standards(no-stored-schema-operation)',
							'@deslop/coding-standards(no-stored-schema-operation)',
							'@deslop/coding-standards(no-stored-schema-operation)',
							'@deslop/coding-standards(no-stored-schema-operation)',
							'@deslop/coding-standards(no-stored-schema-operation)',
							'@deslop/coding-standards(no-stored-schema-operation)',
							'@deslop/coding-standards(no-stored-schema-operation)',
							'@deslop/coding-standards(no-stored-schema-operation)',
							'@deslop/coding-standards(no-trivial-indirection)',
							'@deslop/coding-standards(no-trivial-indirection)',
							'@deslop/coding-standards(no-trivial-indirection)',
							'@deslop/coding-standards(no-trivial-indirection)',
							'@deslop/coding-standards(no-trivial-indirection)',
							'@deslop/coding-standards(no-trivial-indirection)',
							'@deslop/coding-standards(no-trivial-indirection)',
							'@deslop/coding-standards(no-trivial-indirection)',
							'@deslop/coding-standards(no-trivial-indirection)',
							'@deslop/coding-standards(no-trivial-indirection)',
							'@deslop/coding-standards(no-trivial-indirection)',
							'@deslop/coding-standards(no-trivial-indirection)',
							'@deslop/coding-standards(no-trivial-indirection)',
							'@deslop/coding-standards(no-unexplained-disable)',
							'@deslop/coding-standards(no-unexplained-disable)',
							'@deslop/coding-standards(no-unexplained-disable)',
							'@deslop/coding-standards(no-unvalidated-json-decode)',
							'@deslop/coding-standards(schema-type-pair)',
							'@deslop/coding-standards(schema-type-pair)',
							'@deslop/coding-standards(schema-type-pair)',
							'@deslop/coding-standards(schema-type-pair)',
							'@deslop/coding-standards(schema-type-pair)',
							'@deslop/coding-standards(schema-type-pair)',
							'@deslop/coding-standards(schema-type-pair)'
						],
						String.Order
					)
				)
				assert.strictEqual(result.stderr, '')
			})
		)

		testApi.effect(
			'rejects redundant branches and callbacks without rejecting narrowing or consumer-owned exports',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'consumer.ts':
						"import {Schema} from 'effect'\nimport type {TypeOnly} from './type-only.ts'\nimport {ValueOnly} from './value-only.ts'\nexport type Viewed = typeof ValueOnly.Type\nexport const decoded = Schema.decodeSync(ValueOnly)('example' satisfies TypeOnly)",
					'simplification.test.ts': Array.join(
						[
							"import {assert} from '@effect/vitest'",
							"import {Array, Boolean, Effect, Function, Option, String, pipe} from 'effect'",
							'',
							'declare const tags: string[]',
							'declare const maybe: Option.Option<string>',
							'declare const flags: boolean[]',
							'declare const maybeFlag: Option.Option<boolean>',
							'declare const load: Effect.Effect<number, {message: string}>',
							'declare const note: Effect.Effect<{message: string}>',
							'declare const flag: boolean',
							'export function bounded(text: string) { return Boolean.match(String.length(text) > 3, {onFalse: () => text, onTrue: () => String.slice(0, 3)(text)}) }',
							'export function direct(text: string) { if (String.length(text) > 3) return String.slice(0, 3)(text); return text }',
							'function label(done: boolean) { return Boolean.match(done, {onFalse: () => "Running", onTrue: () => "Done"}) }',
							'export const labelled = label(flag)',
							'export const generator = Effect.gen(function* () { yield* Effect.void; return Boolean.match(flag, {onFalse: () => "Running", onTrue: () => "Done"}) })',
							'export const grouped = pipe(tags, Array.groupBy(tag => tag))',
							'export const groupedFirst = Array.groupBy(tags, tag => tag)',
							'export const mapped = Option.map(maybe, value => value)',
							'export const identity = Array.groupBy(tags, Function.identity)',
							'export const narrowed = Option.filter((list: string[]) => Array.isReadonlyArrayNonEmpty(list))',
							'export const typed = Array.groupBy(tags, (tag: string) => tag)',
							'export const truths: true[] = Array.filter(flags, (value): value is true => value)',
							'export const trueOption: Option.Option<true> = Option.filter(maybeFlag, (value): value is true => value)',
							'export const indexed = Array.map(tags, (tag, index) => tag + index)',
							'export const expression = Array.map(tags, tag => Boolean.match(flag, {onFalse: () => tag, onTrue: () => String.toUpperCase(tag)}))',
							'export function nested(done: boolean) { if (done) { return Boolean.match(flag, {onFalse: () => "Running", onTrue: () => "Done"}) } return "Other" }',
							'export function methods(done: boolean) { return Boolean.match(done, {onFalse() { return "Running" }, onTrue() { return "Done" }}) }',
							'export function computed(done: boolean) { return Boolean.match(done, {["onFalse"]: () => "Running", onTrue: () => "Done"}) }',
							'export function asynchronous(done: boolean) { return Boolean.match(done, {onFalse: async () => "Running", onTrue: async () => "Done"}) }',
							'export function block(done: boolean) { return Boolean.match(done, {onFalse: () => { return "Running" }, onTrue: () => "Done"}) }',
							'export function curried(done: boolean) { return pipe(done, Boolean.match({onFalse: () => "Running", onTrue: () => "Done"})) }',
							'export function callbacks(done: boolean) { return Boolean.match(done, {onFalse: Function.constFalse, onTrue: Function.constTrue}) }',
							'export const failures = Effect.gen(function* () {',
							'  assert.strictEqual((yield* Effect.flip(load)).message, "gone")',
							'  const missing = yield* Effect.flip(load)',
							'  assert.strictEqual(missing.message, "gone")',
							'  const piped = yield* pipe(load, Effect.flip)',
							'  assert.strictEqual(piped.message, "gone")',
							'  const value = yield* note',
							'  assert.strictEqual(value.message, "hello")',
							'  return [missing, piped, value]',
							'})'
						],
						'\n'
					),
					'type-only.ts':
						"import {Schema} from 'effect'\nexport type TypeOnly = typeof TypeOnly.Type\nconst TypeOnly = Schema.String",
					'value-only.ts':
						"import {Schema} from 'effect'\ntype ValueOnly = typeof ValueOnly.Type\nexport const ValueOnly = Schema.String"
				})
				assert.deepStrictEqual(customCodes(result.stdout), [
					'@deslop/coding-standards(effect-call-form)',
					'@deslop/coding-standards(effect-call-form)',
					'@deslop/coding-standards(effect-call-form)',
					'@deslop/coding-standards(no-error-message-assertion)',
					'@deslop/coding-standards(no-error-message-assertion)',
					'@deslop/coding-standards(no-error-message-assertion)',
					'@deslop/coding-standards(no-trivial-indirection)',
					'@deslop/coding-standards(no-trivial-indirection)',
					'@deslop/coding-standards(no-trivial-indirection)',
					'@deslop/coding-standards(no-trivial-indirection)',
					'@deslop/coding-standards(no-trivial-indirection)',
					'@deslop/coding-standards(no-trivial-indirection)'
				])
			})
		)

		testApi.effect(
			'counts filtered matches with one diagnostic while retaining consumed arrays and nonmatching bindings',
			Effect.fnUntraced(function* () {
				const source = [
					"import {Array, String, pipe} from 'effect'",
					'',
					'declare const values: string[]',
					'declare const flags: boolean[]',
					'export const count = Array.filter(values, value => value.length > 3).length',
					'export const empty = Array.filter(values, value => value.length > 3).length === 0',
					'export const present = Array.filter(values, value => value.length > 3).length > 0',
					'export const computed = Array["filter"](values, String.isNonEmpty)["length"]',
					'export const refined = Array.filter(flags, (value): value is true => value).length',
					'export const direct = Array.countBy(values, value => value.length > 3)',
					'export const directEmpty = Array.countBy(values, value => value.length > 3) === 0',
					'export const directPresent = Array.countBy(values, value => value.length > 3) > 0',
					'export function kept() { const matches = Array.filter(values, String.isNonEmpty); return {entries: matches, total: matches.length} }',
					'export const native = values.filter(String.isNonEmpty).length',
					'export function shadowed(Array: {filter: (values: string[], predicate: (value: string) => boolean) => string[]}) { return Array.filter(values, String.isNonEmpty).length }',
					'export const curried = pipe(values, Array.filter(String.isNonEmpty)).length',
					'export const optionalCall = Array.filter?.(values, String.isNonEmpty).length',
					'export const optionalMember = Array.filter(values, String.isNonEmpty)?.length',
					'export const optionalCallee = Array?.filter(values, String.isNonEmpty).length',
					'export const spread = Array.filter(...[values, String.isNonEmpty] as const).length',
					'Array.filter(values, String.isNonEmpty).length = 0',
					'Array.filter(values, String.isNonEmpty).length++',
					'delete Array.filter(values, String.isNonEmpty).length',
					';[Array.filter(values, String.isNonEmpty).length] = [0]',
					';({length: Array.filter(values, String.isNonEmpty).length} = {length: 0})',
					';[Array.filter(values, String.isNonEmpty).length = 0] = []',
					';[...Array.filter(values, String.isNonEmpty).length] = []',
					'for (Array.filter(values, String.isNonEmpty).length of [0]) {}',
					'for (Array.filter(values, String.isNonEmpty).length in {zero: 0}) {}',
					'export function defaultRead() { const [count = Array.filter(values, String.isNonEmpty).length] = []; return [count, count] }',
					'export function keyRead(input: Record<number, string>) { const {[Array.filter(values, String.isNonEmpty).length]: value} = input; return [value, value] }',
					'export const someNonZero = Array.filter(values, String.isNonEmpty).length !== 0',
					'export const someAtLeastOne = Array.filter(values, String.isNonEmpty).length >= 1',
					'export const noneBelowOne = Array.filter(values, String.isNonEmpty).length < 1',
					'export const nonZero = values.length !== 0',
					'export const atLeastOne = values.length >= 1',
					'export const belowOne = values.length < 1',
					'export const single = values.length === 1'
				]
				const result = yield* lintSource({'counts.ts': Array.join(source, '\n')})
				assert.strictEqual(result.stderr, '')
				assert.deepStrictEqual(
					pipe(
						result.stdout.diagnostics,
						Array.filter(diagnostic =>
							Array.contains(
								[
									'@deslop/coding-standards(no-intermediate-collection)',
									'@deslop/coding-standards(no-native-emptiness-check)'
								],
								diagnostic.code
							)
						),
						Array.sort(
							Order.mapInput(
								Order.Number,
								(diagnostic: OxlintOutput['diagnostics'][number]) => diagnostic.labels[0]?.span.line ?? 0
							)
						),
						Array.map(diagnostic => ({code: diagnostic.code, line: diagnostic.labels[0]?.span.line}))
					),
					[
						{code: '@deslop/coding-standards(no-intermediate-collection)', line: 5},
						{code: '@deslop/coding-standards(no-intermediate-collection)', line: 6},
						{code: '@deslop/coding-standards(no-intermediate-collection)', line: 7},
						{code: '@deslop/coding-standards(no-intermediate-collection)', line: 8},
						{code: '@deslop/coding-standards(no-intermediate-collection)', line: 9},
						{code: '@deslop/coding-standards(no-intermediate-collection)', line: 30},
						{code: '@deslop/coding-standards(no-intermediate-collection)', line: 31},
						{code: '@deslop/coding-standards(no-intermediate-collection)', line: 32},
						{code: '@deslop/coding-standards(no-intermediate-collection)', line: 33},
						{code: '@deslop/coding-standards(no-intermediate-collection)', line: 34},
						{code: '@deslop/coding-standards(no-native-emptiness-check)', line: 35},
						{code: '@deslop/coding-standards(no-native-emptiness-check)', line: 36},
						{code: '@deslop/coding-standards(no-native-emptiness-check)', line: 37}
					]
				)
				assert.deepStrictEqual(
					pipe(
						result.stdout.diagnostics,
						Array.filter(diagnostic => String.includes('Array.some')(diagnostic.message)),
						Array.map(diagnostic => diagnostic.labels[0]?.span.line ?? 0),
						Array.sort(Order.Number)
					),
					[6, 7, 32, 33, 34]
				)
			})
		)

		testApi.effect(
			'allows valid schemas and semantic owners',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'valid.tsx': Array.join(
						[
							"import {it as test} from '@effect/vitest'",
							"import {Array, Context, Effect, Layer, Result, Schema, SchemaGetter, SchemaTransformation, identity, pipe} from 'effect'",
							"import {useState} from 'react'",
							"import * as EffectArray from 'effect/Array'",
							"import {String} from 'effect/Schema'",
							'',
							'// GitHub caps a page at 100 items.',
							'const LIMIT = 2',
							'const VERSION_PATTERN = /^v/u',
							'declare const input: unknown',
							'declare const names: string[]',
							'const namespaced = EffectArray.map([input], identity)',
							'const singleName = names.length === 1',
							'declare const layer: Layer.Layer<never>',
							'declare const outcome: Result.Result<number, string>',
							'const mappedOutcome = Result.map(outcome, value => value + 1)',
							'const layers = pipe(layer, Layer.provide(layer), Layer.provide(layer), Layer.provide(layer))',
							'declare function combine(left: string, right: string): string',
							'declare const snapshot: {width: number}',
							'declare namespace Ledger { export type Base = {readonly add: (value: number) => Effect.Effect<number>}; export type Shape = Base & {readonly count: Effect.Effect<number>} }',
							'class Ledger extends Context.Service<Ledger, Ledger.Shape>()("Ledger") {}',
							'type User = typeof User.Type',
							'const User = Schema.Struct({name: Schema.String})',
							'const Minimum = Schema.isMinLength(2)',
							'type CheckedName = typeof CheckedName.Type',
							'const CheckedName = Schema.String.check(Minimum)',
							'export const checkedName = Schema.decodeSync(CheckedName)("ab")',
							'type Annotated = typeof Annotated.Type',
							'const Annotated = Schema.String.annotate({description: "value"})',
							'type CodeStep = typeof CodeStep.Type',
							'const CodeStep = Schema.Struct({code: Schema.String, kind: Schema.Literal("code")})',
							'type CallStep = {readonly do: readonly Step[]; readonly kind: "call"}',
							'const CallStep = Schema.Struct({do: Schema.Array(Schema.suspend((): Schema.Codec<Step> => Step)), kind: Schema.Literal("call")})',
							'type Step = CallStep | CodeStep',
							'const Step = Schema.Union([CallStep, CodeStep])',
							'type LinearIssue = typeof LinearIssue.Type',
							'const LinearIssue = Schema.Struct({id: Schema.String})',
							'export type Exported = typeof Exported.Type',
							'export const Exported = Schema.Struct({name: Schema.String})',
							'type Listed = typeof Listed.Type',
							'const Listed = Schema.Struct({name: Schema.String})',
							'type Normalized = typeof Normalized.Type',
							'const Normalized = Schema.decodeTo(Schema.Struct({value: Schema.String}), SchemaTransformation.transform({decode: identity, encode: identity}))(Schema.Struct({value: Schema.String}))',
							'type Decoded = typeof Decoded.Type',
							'const Decoded = Schema.decode({decode: SchemaGetter.transform(identity), encode: SchemaGetter.transform(identity)})(Schema.String)',
							'type Encoded = typeof Encoded.Type',
							'const Encoded = Schema.encode({decode: SchemaGetter.transform(identity), encode: SchemaGetter.transform(identity)})(Schema.String)',
							'const decoded = Schema.decodeUnknownEffect(User)(input)',
							'const encoded = Schema.encodeUnknownSync(Schema.fromJsonString(User))(input)',
							'const decodedMany = Array.map([input], value => Schema.decodeUnknownSync(User)(value))',
							'const isUser = Schema.is(User)(input)',
							'Schema.asserts(User, input)',
							'const Formatter = Schema.toFormatter(User)',
							'function transform(value: string) { return value.length }',
							'function swap(left: string, right: string) { return combine(right, left) }',
							'function withDefault(value = "ready") { return transform(value) }',
							'const tuple = ["ready", 1] as const',
							'const ensured = Array.ensure(input)',
							'const constants = Array.map([input], () => input)',
							'function identify(value: {id: string}) { return value.id }',
							'function circle() { return Math.PI }',
							'const circles = Array.map([input], circle)',
							'function readSnapshot() { return snapshot.width }',
							'const snapshots = Array.map([input], readSnapshot)',
							'const DefaultInput = Schema.JsonObject.make({schema: {type: "object"}})',
							'function isCall(node: {type: string}): node is {type: "CallExpression"} { return node.type === "CallExpression" }',
							'const limits = [LIMIT, LIMIT]',
							'const version = "1"',
							'const versionPatterns = [VERSION_PATTERN, VERSION_PATTERN]',
							'const thunks = {size: () => Array.map(names, identity)}',
							'const measure = Effect.fn("measure")(function* (value: string) { return yield* Effect.succeed(value.length) }, Effect.map(length => length + 1))',
							'const payload: unknown = names',
							'const counts: Record<string, number> = {}',
							'const flags: Partial<Record<"a" | "b", boolean>> = {}',
							'const labels: {[Key in "a" | "b"]?: Key} = {}',
							'type Profile = {nickname?: string}',
							'const nickname: Profile["nickname"] = undefined',
							'const noUser: User | null = null',
							'const annotatedName: string = names[0] ?? ""',
							'declare function currentPhase(): "idle" | "ready"',
							'export const status: string = currentPhase()',
							'export function transition(value: typeof status) { return value.length }',
							'export const transitioned = transition("done")',
							'export function useCounter() { const [state, setState] = useState(() => ({current: 0, previous: 0})); return {increment: () => { setState(value => ({current: value.current + 1, previous: value.current})) }, state} }',
							'function depth(value: number): number { if (value <= 0) return 0; return depth(value - 1) + 1 }',
							'function even(value: number): boolean { if (value === 0) return true; return odd(value - 1) }',
							'function odd(value: number): boolean { if (value === 0) return false; return even(value - 1) }',
							'const countdown = Effect.fnUntraced(function* (value: number): Effect.fn.Return<number> { if (value <= 0) return 0; return yield* countdown(value - 1) })',
							'// oxlint-disable-next-line no-use-before-define -- a cycle of constants has no order',
							'const ping = Effect.fnUntraced(function* (value: number): Effect.fn.Return<number> { return yield* pong(value) })',
							'// oxlint-disable-next-line no-use-before-define -- a cycle of constants has no order',
							'const pong = Effect.fnUntraced(function* (value: number): Effect.fn.Return<number> { return yield* pang(value) })',
							'const pang = Effect.fnUntraced(function* (value: number): Effect.fn.Return<number> { if (value <= 0) return 0; return yield* ping(value - 1) })',
							'class Walker { walk(value: number): number { if (value <= 0) return 0; return this.walk(value - 1) + 1 } }',
							'const counter = Array.map([3], function count(value: number): number { if (value <= 0) return 0; return count(value - 1) + 1 })',
							'declare const receiver: {parse: (value: string) => number}',
							'function parseWith(value: string) { return receiver.parse(value) }',
							'declare function factory(left: string): (right: string) => string',
							'function curried(left: string, right: string) { return factory(left)(right) }',
							'function annotate(annotations: Parameters<typeof Schema.String.annotate>[0]) { return Schema.String.annotate(annotations) }',
							'function annotateString(annotations: Parameters<typeof String.annotate>[0]) { return String.annotate(annotations) }',
							'// oxlint-disable-next-line typescript/no-restricted-types -- this input forwards to a Promise API',
							'declare function fetchName(id: string): Promise<string>',
							'async function loadName(id: string) { return fetchName(id) }',
							'function* echo(value: string) { return transform(value) }',
							'declare class Missing { _tag: "Missing" }',
							'const missing = Effect.fail(new Missing())',
							'const nestedFailure = Effect.fn("nestedFailure")(function* (id: string) { return yield* Effect.flatMap(Effect.succeed(id), () => Effect.fail(new Missing())) })',
							'// oxlint-disable-next-line eqeqeq -- this input keeps a reasoned disable',
							'const loose = snapshot.width == 1',
							'declare const db: {insert: (table: string) => {values: (row: {id: number}) => void}}',
							'db.insert("user").values({id: 1})',
							'const hasWindow = typeof window !== "undefined"',
							'function unavailable() { return Effect.die("unused") }',
							'const stubs = {load: unavailable, save: unavailable}',
							'function HomeLayout() { return <div /> }',
							'const route = {component: HomeLayout}',
							'declare function createRoute(options: {validateSearch: (value: unknown) => User}): void',
							'createRoute({validateSearch: Schema.decodeUnknownSync(User)})',
							'const added = Effect.fn("added")(function* (value: number) { const ledger = yield* Ledger; return yield* ledger.add(value) })',
							'export {added, Annotated, CallStep, hasWindow, route, stubs, CodeStep, Decoded, DefaultInput, Encoded, Formatter, Ledger, LinearIssue, Listed, Normalized, Step, circle, circles, constants, countdown, counter, counts, curried, annotate, annotateString, decoded, decodedMany, echo, encoded, ensured, flags, depth, identify, isCall, isUser, labels, layers, limits, loadName, loose, mappedOutcome, measure, missing, namespaced, nestedFailure, annotatedName, nickname, noUser, payload, odd, parseWith, ping, readSnapshot, singleName, snapshots, swap, test, thunks, Walker, transform, tuple, version, versionPatterns, withDefault}'
						],
						'\n'
					)
				})
				assert.deepStrictEqual(customCodes(result.stdout), [])
				assert.strictEqual(result.stderr, '')
			})
		)

		testApi.effect(
			'reports runtime typeof and error wording assertions',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'assertions.ts': Array.join(
						[
							"import {Predicate} from 'effect'",
							'',
							'declare const properties: unknown',
							'declare const value: unknown',
							'declare const failure: {message: string}',
							'declare const assert: {strictEqual: (actual: unknown, expected: unknown) => void}',
							"const isText = typeof value === 'string'",
							"if (typeof properties === 'object') Predicate.isNotNull(properties)",
							"assert.strictEqual(failure.message, 'negative')",
							'export {isText}'
						],
						'\n'
					)
				})
				assert.deepStrictEqual(
					customCodes(result.stdout),
					Array.sort(
						[
							'@deslop/coding-standards(no-error-message-assertion)',
							'@deslop/coding-standards(prefer-predicate)',
							'@deslop/coding-standards(prefer-predicate)'
						],
						String.Order
					)
				)
			})
		)

		testApi.effect(
			'leaves rewrites that would change behavior alone',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'behavior.test.tsx': Array.join(
						[
							"import {assert, it} from '@effect/vitest'",
							"import {Array, Effect, MutableRef, pipe} from 'effect'",
							"import type {Ref} from 'react'",
							"import {owner} from './owner.ts'",
							'',
							'declare const ticket: {message: string}',
							'function cell() { return MutableRef.make(0) }',
							'const cells = [cell(), cell()]',
							'function allocate() { return owner.cell }',
							'export const allocations = [allocate(), allocate()]',
							'function matcher() { return /token/gu }',
							'export const patterns = [matcher(), matcher()]',
							'export function parseOwned(value: string) { return owner.parse(value) }',
							'const operations = {normalize: Array.reverse}',
							'const recovered = Effect.gen(function* () { return yield* Effect.catch(Effect.fail("missing"), () => Effect.succeed(1)) })',
							'function Field({ref, ...props}: {ref?: Ref<HTMLInputElement>; label: string}) { return <input ref={ref} aria-label={props.label} /> }',
							'export const primitiveFailure = Effect.gen(function* () { return yield* Effect.fail("missing") })',
							'it("keeps the trimmed message", () => { assert.strictEqual(ticket.message, "hello") })',
							'export {Field, cells, operations, recovered}'
						],
						'\n'
					),
					'owner.ts':
						"import {MutableRef} from 'effect'\nexport const owner = {get cell() { return MutableRef.make(0) }, parse(value: string) { return this.prefix + value }, prefix: 'id'}"
				})
				assert.deepStrictEqual(customCodes(result.stdout), [])
			})
		)

		testApi.effect(
			'reports single-use values, property aliases and native regex checks only where the rewrite keeps behavior',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'inline.ts': Array.join(
						[
							"import {Array, Effect, Predicate, Ref, pipe} from 'effect'",
							'',
							'declare const text: string',
							'declare const items: string[]',
							'declare const maybe: string | undefined',
							'declare const flag: boolean',
							'declare const state: Ref.Ref<number>',
							'declare function consume(...values: number[]): number',
							'declare function compute(): string[]',
							'declare const pattern: RegExp',
							'export function inlined() { const size = text.length; return consume(size) }',
							'export function interpolated() { const label = `${text}!`; return consume(label.length) }',
							'export function header() { const listed = compute(); for (const item of listed) consume(item.length) }',
							'export const enclosed = Effect.gen(function* () { const first = yield* Ref.get(state); return yield* Ref.set(state, first) })',
							'export const measured = Effect.gen(function* () { const listed = yield* Effect.succeed(items); return listed.length })',
							'export const keyed = Effect.gen(function* () { const index = yield* Ref.get(state); return items[index] })',
							'export function multiline() {',
							'	const size = Array.reduce(items, 0, (total, item) =>',
							'		total + item.length)',
							'	return consume(size)',
							'}',
							'export function repeated() { const size = text.length; return Array.map(items, () => consume(size)) }',
							'export function looped() { const size = text.length; for (const item of items) consume(size + item.length) }',
							'export function skipped() { const size = text.length; return flag && consume(size) }',
							'export function later() { const size = text.length; consume(1); return consume(size) }',
							'export function twice() { const size = text.length; return consume(size) + size }',
							'declare const box: {size?: number; read: () => number}',
							'export function snapshot() { const size = box.size; box.size = 2; return consume(size ?? 0) }',
							'export function removed() { const size = box.size; delete box.size; return consume(size ?? 0) }',
							'export function keyedWrite(key: "size") { const size = box.size; box[key] = 2; return consume(size ?? 0) }',
							'export function detachedRead() { const read = box.read; return consume(read()) }',
							'export function literal() { const limit = 42; return consume(limit) }',
							'export const ordered = Effect.gen(function* () { const first = yield* Ref.get(state); return consume((yield* Ref.get(state)) + first) })',
							'export function nested() { const mode = flag ? 1 : 2; return consume(flag ? mode : 0) }',
							'export function condition() { const mode = flag ? 1 : 2; return mode > 0 ? 3 : 4 }',
							'export const literalTest = /x/u.test(text)',
							'export const calledExec = RegExp("x", "u").exec(text)',
							'export const globalExec = /(a)(b)/gu.exec(text)',
							'export const variableTest = pattern.test(text)',
							'export const fallback = maybe === undefined ? "none" : maybe',
							'export const predicateFallback = Predicate.isNullish(maybe) ? "none" : maybe',
							'export const choice = consume(1) > 0 ? "some" : "none"',
							'export function aliased(input: string) { const value = input; return consume(value.length) }'
						],
						'\n'
					)
				})
				assert.deepStrictEqual(customCodes(result.stdout), [
					'@deslop/coding-standards(no-native-method-call)',
					'@deslop/coding-standards(no-native-method-call)',
					'@deslop/coding-standards(no-property-alias)',
					'@deslop/coding-standards(no-property-alias)',
					'@deslop/coding-standards(no-property-alias)',
					'@deslop/coding-standards(no-property-alias)',
					'@deslop/coding-standards(no-property-alias)',
					'@deslop/coding-standards(no-property-alias)',
					'@deslop/coding-standards(no-single-use-value)',
					'@deslop/coding-standards(no-single-use-value)',
					'@deslop/coding-standards(no-single-use-value)',
					'@deslop/coding-standards(no-single-use-value)',
					'@deslop/coding-standards(no-single-use-value)',
					'@deslop/coding-standards(no-single-use-value)',
					'@deslop/coding-standards(no-trivial-indirection)',
					'@deslop/coding-standards(no-trivial-indirection)'
				])
			})
		)

		testApi.effect(
			'fixes dropped causes, empty arrays and renamed imports while leaving native-only violations reported',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource(
					{
						'fixes.ts': Array.join(
							[
								"import {Array, Effect, Option as Maybe, Schema} from 'effect'",
								"class Failed extends Schema.TaggedError<Failed>()('Failed', {cause: Schema.Defect(), message: Schema.String}) {}",
								'declare const work: Effect.Effect<number, string>',
								'declare const value: object',
								'declare const maybe: Maybe.Option<string>',
								'declare const socket: {pipe: (target: unknown) => unknown}',
								'export const piped = Effect.succeed(1).pipe(Effect.map(n => n + 1)).pipe(',
								'	Effect.asVoid,',
								')',
								'export const streamed = socket.pipe(value)',
								"export const decoded = Schema.decodeUnknownEffect(Schema.String)(value).pipe(Effect.mapError(() => Failed.make({message: 'bad'})))",
								"export const absent = Effect.mapError(Effect.fromOption(maybe), () => Failed.make({message: 'none'}))",
								'export const named = Effect.mapError(work, error => new Failed({message: error}))',
								"export const caught = Effect.tryPromise({catch: () => Failed.make({message: 'down'}), try: () => fetch('/')})",
								'export const read = (path: string): Effect.Effect<string> => Effect.succeed(path)',
								'export const next = (count: number): number => count + 1',
								'export function shown(panel: string | null) {',
								"	if (panel === null) return ''",
								'	const show = () => panel.length',
								'	return show()',
								'}',
								'export function pick(flag: boolean, other: boolean) {',
								"	return flag ? 'a' : other ? 'b' : 'c'",
								'}',
								"export const label = (done: boolean) => (done ? 'Done' : 'Running')",
								'export const kept = (flag: boolean) => ({value: flag ? 1 : 2})',
								'export const pattern = /a.b/i',
								"export const keyed = 'key' in value",
								'export const empties: string[] = []',
								'export const wrapped = {Maybe}',
								'export const titles = (notes: (typeof Note.Type)[]) => Array.map(notes, note => note.title)',
								'export const Note = Schema.Struct({title: Schema.String})'
							],
							'\n'
						),
						// Every fix here would change types or evaluation order, so each stays reported only.
						'kept.ts': Array.join(
							[
								"import {Array, Effect, Schema} from 'effect'",
								"class Narrow extends Schema.TaggedError<Narrow>()('Narrow', {cause: Schema.String, message: Schema.String}) {}",
								'declare const loaded: string | undefined',
								'declare function step(): <A>(self: A) => A',
								"if (loaded === undefined) throw new Error('missing')",
								'export const size = () => loaded.length',
								'export const frozen: readonly string[] = []',
								'export const Label = Schema.String',
								'export function shadowed(Label: typeof Schema.Number) {',
								'	const parsed: typeof Label.Type = 1',
								'	return Array.of(parsed)',
								'}',
								'export const ordered = Effect.succeed(2).pipe(Effect.asVoid).pipe(step())',
								"export const narrowed = Effect.mapError(Effect.fail(1), () => Narrow.make({message: 'bad'}))",
								'export const inherited = new RegExp(/a/u)'
							],
							'\n'
						)
					},
					['--fix']
				)
				assert.deepStrictEqual(result.sources, [
					Array.join(
						[
							"import {Array, Effect, Option, Schema} from 'effect'",
							'',
							"class Failed extends Schema.TaggedError<Failed>()('Failed', {cause: Schema.Defect(), message: Schema.String}) {}",
							'declare const work: Effect.Effect<number, string>',
							'declare const value: object',
							'declare const maybe: Option.Option<string>',
							'declare const socket: {pipe: (target: unknown) => unknown}',
							'export const piped = Effect.succeed(1)',
							'	.pipe(Effect.map(n => n + 1))',
							'	.pipe(Effect.asVoid)',
							'export const streamed = socket.pipe(value)',
							'export const decoded = Schema.decodeUnknownEffect(Schema.String)(value).pipe(',
							"	Effect.mapError(cause => Failed.make({cause, message: 'bad'}))",
							')',
							"export const absent = Effect.mapError(Effect.fromOption(maybe), () => Failed.make({message: 'none'}))",
							'export const named = Effect.mapError(work, error => new Failed({cause: error, message: error}))',
							"export const caught = Effect.tryPromise({catch: cause => Failed.make({cause, message: 'down'}), try: () => fetch('/')})",
							'export const read = (path: string): Effect.Effect<string> => Effect.succeed(path)',
							'export const next = (count: number) => count + 1',
							'export function shown(panel: string | null) {',
							"	if (panel === null) return ''",
							'	const show = () => panel.length',
							'	return show()',
							'}',
							'export function pick(flag: boolean, other: boolean) {',
							"	return flag ? 'a' : other ? 'b' : 'c'",
							'}',
							"export const label = (done: boolean) => (done ? 'Done' : 'Running')",
							'export const kept = (flag: boolean) => ({value: flag ? 1 : 2})',
							'export const pattern = /a.b/i',
							"export const keyed = 'key' in value",
							'export const empties = Array.empty<string>()',
							'export const wrapped = {Maybe: Option}',
							'export const titles = (notes: Note[]) => Array.map(notes, note => note.title)',
							'export type Note = typeof Note.Type',
							'export const Note = Schema.Struct({title: Schema.String})',
							''
						],
						'\n'
					),
					Array.join(
						[
							"import {Array, Effect, Schema} from 'effect'",
							'',
							"class Narrow extends Schema.TaggedError<Narrow>()('Narrow', {cause: Schema.String, message: Schema.String}) {}",
							'declare const loaded: string | undefined',
							'declare function step(): <A>(self: A) => A',
							"if (loaded === undefined) throw new Error('missing')",
							'export const size = () => loaded.length',
							'export const frozen: readonly string[] = []',
							'export type Label = typeof Label.Type',
							'export const Label = Schema.String',
							'export function shadowed(Label: typeof Schema.Number) {',
							'	const parsed: typeof Label.Type = 1',
							'	return Array.of(parsed)',
							'}',
							'export const ordered = Effect.succeed(2).pipe(Effect.asVoid).pipe(step())',
							"export const narrowed = Effect.mapError(Effect.fail(1), () => Narrow.make({message: 'bad'}))",
							'export const inherited = new RegExp(/a/u)',
							''
						],
						'\n'
					)
				])
				// Native rules keep reporting without the deleted migration fixes; retained custom fixes still converge.
				assert.deepStrictEqual(customCodes(result.stdout), [
					'@deslop/coding-standards(no-redundant-variable-annotation)',
					'@deslop/coding-standards(no-return-type)',
					'@deslop/coding-standards(no-trivial-indirection)',
					'@deslop/coding-standards(no-trivial-indirection)',
					'@deslop/coding-standards(preserve-error-cause)'
				])
			})
		)

		testApi.effect(
			'reports native controls, discarded failures and React Query outside their owners',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'controls.test.ts': Array.join(
						[
							"import {Effect} from 'effect'",
							'',
							'declare const load: Effect.Effect<number, string>',
							'export const setup = Effect.orDie(load)'
						],
						'\n'
					),
					'controls.tsx': Array.join(
						[
							"import {useQuery} from '@tanstack/react-query'",
							"import {Effect} from 'effect'",
							'',
							'declare const load: Effect.Effect<number, string>',
							'export const ignored = Effect.ignore(load)',
							'export const causeIgnored = Effect.ignoreCause(load)',
							'export const caught = Effect.tryPromise({catch: cause => cause, try: () => Promise.resolve(1)})',
							'export const crashed = Effect.orDie(load)',
							"export const logged = Effect.ignore(load, {log: 'Warn', message: 'The preview was not kept'})",
							"export const curried = Effect.ignore({'log': 'Warn'})(load)",
							'export const unset = Effect.ignore(load, {log: undefined})',
							"export const overridden = Effect.ignore(load, {log: 'Warn', ...{log: false}})",
							'export function Save() { return <button type="button" className="hover:bg-muted rounded-md px-2">Save</button> }',
							'export function Row() { return <button type="button" className="min-w-0 bg-transparent p-0 text-left">Open</button> }',
							'export function Pick() { return <select aria-label="Kind" /> }',
							'export {useQuery}'
						],
						'\n'
					)
				})
				assert.deepStrictEqual(customCodes(result.stdout), [
					'@deslop/coding-standards(effect-call-form)',
					'@deslop/coding-standards(no-discarded-failure)',
					'@deslop/coding-standards(no-discarded-failure)',
					'@deslop/coding-standards(no-discarded-failure)',
					'@deslop/coding-standards(no-discarded-failure)',
					'@deslop/coding-standards(no-discarded-failure)',
					'@deslop/coding-standards(no-native-control)',
					'@deslop/coding-standards(no-native-control)'
				])
			})
		)

		testApi.effect(
			'keeps shadcn components as shipped, allowing only placement classes',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'primitives.tsx': Array.join(
						[
							"import {Button} from '@deslop/components-web/ui/button'",
							"import {Card} from '#components/ui/card.tsx'",
							"import {cn} from '#lib/utils.ts'",
							"import {Widget} from 'some-lib'",
							'',
							'export function Painted() { return <Button className="mt-2 w-full hover:bg-muted sm:!px-2 data-[state=open]:text-red-500">Save</Button> } // reported',
							'export function Placed() { return <Button className="mt-2 w-full max-w-sm flex-1 relative z-10 self-center -mt-1 sm:inset-0 hidden md:block sm:flex shrink-0 -translate-x-1/2 pointer-events-auto [&_svg:not([class*=size-])]:size-4">Save</Button> }',
							"export function Combined() { return <Card className={cn('mt-2', 'bg-red-500')}>Body</Card> } // reported",
							'export function Templated() { return <Card className={`mt-2 text-lg`}>Body</Card> } // reported',
							'export function Passed({className}: {className: string}) { return <Card className={className}>Body</Card> }',
							'export function Foreign() { return <Widget className="bg-red-500" /> }'
						],
						'\n'
					)
				})
				assert.deepStrictEqual(
					pipe(
						result.stdout.diagnostics,
						Array.filter(diagnostic => diagnostic.code === 'shadcn(no-restyle)'),
						Array.map(diagnostic => diagnostic.labels[0]?.span.line ?? 0),
						Array.dedupe,
						Array.sort(Order.Number)
					),
					pipe(
						String.split(result.sources[0] ?? '', '\n'),
						Array.map((line, index) => ({line, number: index + 1})),
						Array.filter(entry => String.includes('// reported')(entry.line)),
						Array.map(entry => entry.number)
					)
				)
			})
		)

		testApi.effect(
			'draws Phosphor icons light from 20px and regular up to 16px, fixing the weight',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource(
					{
						'icons.tsx': Array.join(
							[
								"import {GearIcon, TrashIcon} from '@phosphor-icons/react'",
								"import {Badge} from '@deslop/components-web/ui/badge'",
								'',
								'export function Large() { return <GearIcon className="size-6" /> }',
								'export function LargeRegular() { return <GearIcon className="size-5" weight="regular" /> }',
								'export function Small() { return <TrashIcon className="size-4" weight="light" /> }',
								'export function Plain() { return <TrashIcon className="size-4" /> }',
								'export function Labelled() { return <Badge onClick={() => undefined}>New</Badge> }'
							],
							'\n'
						)
					},
					['--fix']
				)
				assert.include(result.sources[0] ?? '', '<GearIcon className="size-6" weight="light" />')
				assert.include(result.sources[0] ?? '', '<GearIcon className="size-5" weight="light" />')
				assert.include(result.sources[0] ?? '', '<TrashIcon className="size-4" />\n')
				assert.deepStrictEqual(reportedLines(result, 'no-clickable-badge').reported, [9])
			})
		)

		testApi.effect(
			'keeps labeled tuples and component refs without opening object bypasses',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'parameters.tsx': Array.join(
						[
							"import type {Ref} from 'react'",
							'export type Named = [label: string, count: number]',
							'export type Alias = Named',
							'export function labeled([label, count]: [label: string, count: number]) { return `${label}:${count}` }',
							'export function aliased([label, count]: Alias) { return `${label}:${count}` }',
							'export function positional([first]: string[]) { return first }',
							'export function byRef({ref, ...rest}: {ref: string; name: string}) { return `${ref}:${rest.name}` }',
							'export function Pretend({ref, ...rest}: {ref: string; name: string}) { return `${ref}:${rest.name}` }',
							'export function Field({ref, ...rest}: {ref?: Ref<HTMLInputElement>; name: string}) { return <input ref={ref} aria-label={rest.name} /> }',
							'export const FieldArrow = ({ref, ...rest}: {ref?: Ref<HTMLInputElement>; name: string}) => <input ref={ref} aria-label={rest.name} />',
							'for (const {ref, ...rest} of [{ref: "x", name: "y"}]) console.info(ref, rest.name)',
							'export function local(input: {name: string}) { const {name} = input; return name }'
						],
						'\n'
					)
				})
				assert.deepStrictEqual(
					pipe(
						result.stdout.diagnostics,
						Array.filter(diagnostic => diagnostic.code === '@deslop/coding-standards(no-destructured-parameter)'),
						Array.map(diagnostic => diagnostic.labels[0]?.span.line)
					),
					[7, 8, 9, 12, 13]
				)
			})
		)

		testApi.effect(
			'inlines one-line functions read once and keeps one name per export',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'single.ts': Array.join(
						[
							"import {Array} from 'effect'",
							'declare const entries: {tag: string}[]',
							'declare const first: {tag: string}',
							'declare function load(): {tag: string}',
							'function tagLine(entry: {tag: string}) { return `- ${entry.tag}` }',
							'function once(entry: {tag: string}) { return `- ${entry.tag}` }',
							// Inlining would call load() twice.
							'function twice(entry: {tag: string}) { return `${entry.tag}${entry.tag}` }',
							'function shown(entry: {tag: string}) { return `- ${entry.tag}` }',
							'export const lines = Array.map(entries, tagLine)',
							'export const single = once(first)',
							'export const doubled = twice(load())',
							'export const repeated = [shown(first), shown(first)]',
							'export {entries as allEntries}',
							"export {first as 'module.exports'}"
						],
						'\n'
					)
				})
				assert.deepStrictEqual(
					pipe(
						result.stdout.diagnostics,
						Array.filter(diagnostic =>
							Array.contains(
								['@deslop/coding-standards(no-renamed-import)', '@deslop/coding-standards(no-trivial-indirection)'],
								diagnostic.code
							)
						),
						Array.map(diagnostic => diagnostic.labels[0]?.span.line)
					),
					[6, 7, 14]
				)
			})
		)

		testApi.effect(
			'reports destructured parameters',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'destructured.ts': Array.join(
						[
							"import {Array} from 'effect'",
							'',
							'const sizes = Array.map([[1, 2]], ([width]) => width)',
							'for (const {length} of ["a"]) consume(length)',
							'const labelOf = ({ref, label}: {ref: string; label: string}) => [ref, label]',
							'declare function consume(value: number): void',
							'export {labelOf, sizes}'
						],
						'\n'
					)
				})
				assert.deepStrictEqual(customCodes(result.stdout), [
					'@deslop/coding-standards(no-destructured-parameter)',
					'@deslop/coding-standards(no-destructured-parameter)',
					'@deslop/coding-standards(no-destructured-parameter)'
				])
			})
		)

		testApi.effect(
			'fixes single-use values and property aliases without changing behavior',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource(
					{
						'fixable.ts': Array.join(
							[
								"import {Context} from 'effect'",
								"import type {Effect} from 'effect'",
								'declare const text: string',
								'declare function consume(...values: unknown[]): number',
								'export class Clock extends Context.Service<Clock, {now: Effect.Effect<number>}>()("Clock") {}',
								'export function sum() {',
								'	const size = text.length + 1',
								'	return consume(size * 2)',
								'}',
								'export function shorthand() {',
								'	const label = consume(text)',
								'	return consume({label})',
								'}',
								'declare const obj: {method: () => number; first: () => number; second: number; p: number; make: () => {Component: new () => object}}',
								'export function detached() {',
								'	const method = obj.method',
								'	return method()',
								'}',
								'export function constructed() {',
								'	const make = obj.make()',
								'	return new make.Component()',
								'}',
								'export function statement() {',
								'	obj.first()',
								'	const values = [obj.p]',
								'	values.slice(1)',
								'}',
								'export function asserted() {',
								'	const method = obj.method',
								'	return method!()',
								'}',
								'export function pattern() {',
								'	obj.first()',
								'	const matcher = /x/u',
								'	matcher.lastIndex = 1',
								'}',
								'export function named() {',
								'	const Value = class {} satisfies object',
								'	return Value.name',
								'}',
								'export function aliased() {',
								'	const second = obj.second',
								'	return consume(second, second)',
								'}',
								'export function mutated() {',
								'	const second = obj.second',
								'	obj.first()',
								'	return consume(second)',
								'}',
								'export function reordered() {',
								'	const second = obj.second',
								'	return consume(obj.p, second)',
								'}',
								'export function moved() {',
								'	const second = obj.second',
								'	return consume(text, second)',
								'}',
								'declare const other: {p: number}',
								'declare const flag: boolean',
								'export function getter() {',
								'	const second = obj.second',
								'	return consume(other.p, second)',
								'}',
								'export function conditional() {',
								'	const second = obj.second',
								'	return flag && consume(second)',
								'}',
								'export function early() {',
								'	const second = obj.second',
								'	if (flag) return 0',
								'	return consume(second)',
								'}',
								'export function spread() {',
								'	const second = obj.second',
								'	return consume({...other, second})',
								'}'
							],
							'\n'
						)
					},
					['--fix']
				)
				assert.deepStrictEqual(result.sources, [
					Array.join(
						[
							"import {Context} from 'effect'",
							"import type {Effect} from 'effect'",
							'',
							'declare const text: string',
							'declare function consume(...values: unknown[]): number',
							"export class Clock extends Context.Service<Clock, {now: Effect.Effect<number>}>()('Clock') {}",
							'export function sum() {',
							'	return consume((text.length + 1) * 2)',
							'}',
							'export function shorthand() {',
							'	return consume({label: consume(text)})',
							'}',
							'declare const obj: {',
							'	method: () => number',
							'	first: () => number',
							'	second: number',
							'	p: number',
							'	make: () => {Component: new () => object}',
							'}',
							'export function detached() {',
							'	const method = obj.method',
							'	return method()',
							'}',
							'export function constructed() {',
							'	return new (obj.make().Component)()',
							'}',
							'export function statement() {',
							'	obj.first()',
							'',
							'	;[obj.p].slice(1)',
							'}',
							'export function asserted() {',
							'	const method = obj.method',
							'	return method!()',
							'}',
							'export function pattern() {',
							'	obj.first()',
							'',
							'	;/x/u.lastIndex = 1',
							'}',
							'export function named() {',
							'	const Value = class {} satisfies object',
							'	return Value.name',
							'}',
							'export function aliased() {',
							'	const second = obj.second',
							'	return consume(second, second)',
							'}',
							'export function mutated() {',
							'	const second = obj.second',
							'	obj.first()',
							'	return consume(second)',
							'}',
							'export function reordered() {',
							'	const second = obj.second',
							'	return consume(obj.p, second)',
							'}',
							'export function moved() {',
							'	return consume(text, obj.second)',
							'}',
							'declare const other: {p: number}',
							'declare const flag: boolean',
							'export function getter() {',
							'	const second = obj.second',
							'	return consume(other.p, second)',
							'}',
							'export function conditional() {',
							'	const second = obj.second',
							'	return flag && consume(second)',
							'}',
							'export function early() {',
							'	const second = obj.second',
							'	if (flag) return 0',
							'	return consume(second)',
							'}',
							'export function spread() {',
							'	const second = obj.second',
							'	return consume({...other, second})',
							'}',
							''
						],
						'\n'
					)
				])
			})
		)

		testApi.effect(
			'fixes state types, nullable ref types, nullish checks, typeof, compiler opt-outs and schema types without changing behavior',
			Effect.fnUntraced(function* () {
				const fixed = yield* lintSource(
					{
						'fixes.tsx': Array.join(
							[
								"import {MutableRef, Predicate, Schema, SubscriptionRef} from 'effect'",
								"import {useRef, useState} from 'react'",
								'declare const loose: string | null | undefined',
								'declare const flag: boolean',
								"export const text = MutableRef.make<string>('')",
								'export const enabled = SubscriptionRef.make<boolean>(false)',
								'export function Frame() {',
								"	'use no memo'",
								'	const both = useRef<(() => void) | null | string>(null)',
								'	const handler = useRef<null | (() => void)>(null)',
								'	const element = useRef<HTMLDivElement | null>(null)',
								'	const [size] = useState<number>(1)',
								'	return <div ref={element} data-size={size} data-handler={handler} data-both={both} />',
								'}',
								"// The user's record.",
								'export const User = Schema.Struct({name: Schema.String})',
								'const Local = Schema.Struct({id: Schema.String})',
								'export const locals = [Local]',
								'export const present = loose !== null && loose !== undefined',
								'export const absent = flag || loose === null || loose === undefined',
								"export function kinds(value: unknown) { return {isText: typeof value === 'string', isWhole: typeof value === 'bigint', notCallable: typeof value !== 'function'} }"
							],
							'\n'
						),
						'guard.ts': Array.join(
							[
								"import {Array} from 'effect'",
								"export function kinds(value: unknown) { return {isText: typeof value === 'string'} }",
								'export const names = Array.empty<string>()'
							],
							'\n'
						),
						'nullish.ts': Array.join(
							[
								"import {pipe} from 'effect'",
								'declare const loose: string | null | undefined',
								'export const present = loose !== null && loose !== undefined',
								'export const piped = pipe(loose)'
							],
							'\n'
						)
					},
					['--fix']
				)
				assert.deepStrictEqual(fixed.sources, [
					Array.join(
						[
							"import {MutableRef, Predicate, Schema, SubscriptionRef} from 'effect'",
							'',
							"import {useRef, useState} from 'react'",
							'',
							'declare const loose: string | null | undefined',
							'declare const flag: boolean',
							"export const text = MutableRef.make('')",
							'export const enabled = SubscriptionRef.make(false)',
							'export function Frame() {',
							'	const both = useRef<(() => void) | string>(null)',
							'	const handler = useRef<() => void>(null)',
							'	const element = useRef<HTMLDivElement>(null)',
							'	const [size] = useState(1)',
							'	return <div ref={element} data-size={size} data-handler={handler} data-both={both} />',
							'}',
							'export type User = typeof User.Type',
							"// The user's record.",
							'export const User = Schema.Struct({name: Schema.String})',
							'type Local = typeof Local.Type',
							'const Local = Schema.Struct({id: Schema.String})',
							'export const locals = [Local]',
							'export const present = Predicate.isNotNullish(loose)',
							'export const absent = flag || Predicate.isNullish(loose)',
							'export function kinds(value: unknown) {',
							'	return {',
							'		isText: Predicate.isString(value),',
							'		isWhole: Predicate.isBigInt(value),',
							'		notCallable: !Predicate.isFunction(value)',
							'	}',
							'}',
							''
						],
						'\n'
					),
					Array.join(
						[
							"import {Array, Predicate} from 'effect'",
							'',
							'export function kinds(value: unknown) {',
							'	return {isText: Predicate.isString(value)}',
							'}',
							'export const names = Array.empty<string>()',
							''
						],
						'\n'
					),
					Array.join(
						[
							"import {Predicate, pipe} from 'effect'",
							'',
							'declare const loose: string | null | undefined',
							'export const present = Predicate.isNotNullish(loose)',
							'export const piped = pipe(loose)',
							''
						],
						'\n'
					)
				])
				const relinted = yield* lintSource({
					'fixes.tsx': fixed.sources[0] ?? '',
					'guard.ts': fixed.sources[1] ?? '',
					'nullish.ts': fixed.sources[2] ?? ''
				})
				assert.deepStrictEqual(customCodes(relinted.stdout), [])
			})
		)

		testApi.effect(
			'keeps unsafe nullish checks, typeof checks and conflicting schema types reported after fixing',
			Effect.fnUntraced(function* () {
				const unfixable = yield* lintSource(
					{
						'bare.ts': "declare const value: unknown\nexport const isText = typeof value === 'string'\n",
						'unfixable.ts': Array.join(
							[
								"import {Predicate, Schema} from 'effect'",
								'',
								'declare const box: {size?: number | null}',
								'declare const value: unknown',
								'export const sized = box.size !== null && box.size !== undefined',
								'export const wrapped = (value !== null) && value !== undefined',
								"export const isObject = typeof value === 'object'",
								"export const hasGlobal = typeof value === 'undefined'",
								'export function shadowed(input: unknown, undefined: unknown) { return input !== null && input !== undefined }',
								'export const nullish = Predicate.isNullish(value)',
								'export type Taken = {name: string}',
								'export const Taken = Schema.Struct({name: Schema.String})',
								'export const First = Schema.String, Second = Schema.Number'
							],
							'\n'
						)
					},
					['--fix']
				)
				assert.deepStrictEqual(customCodes(unfixable.stdout), [
					'@deslop/coding-standards(no-double-nullish-check)',
					'@deslop/coding-standards(no-double-nullish-check)',
					'@deslop/coding-standards(prefer-predicate)',
					'@deslop/coding-standards(prefer-predicate)',
					'@deslop/coding-standards(prefer-predicate)',
					'@deslop/coding-standards(schema-type-pair)',
					'@deslop/coding-standards(schema-type-pair)',
					'@deslop/coding-standards(schema-type-pair)'
				])
			})
		)

		testApi.effect(
			'names and places module constants, keeps elements and derived types out of variables, and keeps aliases TypeScript narrows',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'values.tsx': Array.join(
						[
							"import {Array, Schema} from 'effect'",
							'',
							'const LIMIT = 5',
							'const PRIMITIVES: Record<string, string> = {button: "Button"}',
							'const once = 3',
							'const maxSize = 10',
							'const STICKY = /x/gu',
							'const COUNTER = {value: 0}',
							'declare const items: string[]',
							'declare function ready(value: unknown): value is string',
							'declare function isText(value: unknown): value is string',
							'declare function consume(...values: unknown[]): number',
							'declare function load(): Promise<string>',
							'const TRAILING = "late"',
							'type Loaded = Awaited<ReturnType<typeof load>>',
							'export type Exported = Awaited<ReturnType<typeof load>>',
							'const icon = <span />',
							'export function Icon() { return <div>{icon}{icon}</div> }',
							'export function Badge() { const body = <b />; return <div>{body}</div> }',
							'export function show(value: Loaded) { return [value, value] }',
							'export const counted = consume(LIMIT, LIMIT, once, maxSize, maxSize, TRAILING, TRAILING, PRIMITIVES.button)',
							'export function narrowed(holder: {image?: string}) { const image = holder.image; if (image === undefined) return 0; return Array.map(items, () => image.length) }',
							'export function Detail(props: {note: {image?: string; title: string}}) { const note = props.note; return note.image !== undefined && Array.map(items, () => note.title) }',
							'export function guarded(holder: {image?: string}) { const image = holder.image; if (!ready(image)) return 0; return Array.map(items, () => image.length) }',
							'export function snapshot(box: {value: string}) { const value = box.value; return () => value }',
							'export function advance(text: string) { return STICKY.exec(text) }',
							'export function next() { return ++COUNTER.value }',
							'export function named(holder: {image?: string}) { const image = holder.image; const valid = isText(image); if (!valid) return []; return [valid, Array.map(items, () => image.length)] }',
							'export function curried(holder: {image?: string}) { const image = holder.image; const valid = Schema.is(Schema.String)(image); if (!valid) return []; return [valid, Array.map(items, () => image.length)] }',
							'export function factory(holder: {schema: typeof Schema.String}) { const schema = holder.schema; return Array.map(items, value => Schema.is(schema)(value)) }',
							'type Listed = ReturnType<typeof load>',
							'export type {Listed}'
						],
						'\n'
					)
				})
				assert.deepStrictEqual(customCodes(result.stdout), [
					'@deslop/coding-standards(module-constant)',
					'@deslop/coding-standards(module-constant)',
					'@deslop/coding-standards(module-constant)',
					'@deslop/coding-standards(no-floating-derived-type)',
					'@deslop/coding-standards(no-property-alias)',
					'@deslop/coding-standards(no-property-alias)',
					'@deslop/coding-standards(no-stored-jsx)',
					'@deslop/coding-standards(no-stored-jsx)'
				])
				const fixed = yield* lintSource(
					{
						'annotated.ts': Array.join(
							[
								'const labels: Record<string, string> = {small: "s"}',
								'const minSize = 1',
								'export const sizes = {small: labels.small, tiny: labels.tiny}',
								'export function shadowed(MIN_SIZE: number) { return [minSize, minSize, MIN_SIZE] }'
							],
							'\n'
						),
						'ordered.ts': Array.join(
							[
								'declare const api: {method: (value: string) => string}',
								'declare function make(value: string): string',
								'export function ordered() {',
								'	const output = make(',
								'		"x"',
								'	)',
								'	return api.method(output)',
								'}',
								'export function spread(source: {value: string}) {',
								'	const copy = {',
								'		...source',
								'	}',
								'	return api.method(copy.value)',
								'}'
							],
							'\n'
						),
						'rename.ts': 'const maxSize = 10\nexport const sizes = {maxSize, other: maxSize}'
					},
					['--fix']
				)
				assert.deepStrictEqual(fixed.sources, [
					Array.join(
						[
							"const LABELS: Record<string, string> = {small: 's'}",
							'const minSize = 1',
							'export const sizes = {small: LABELS.small, tiny: LABELS.tiny}',
							'export function shadowed(MIN_SIZE: number) {',
							'	return [minSize, minSize, MIN_SIZE]',
							'}',
							''
						],
						'\n'
					),
					Array.join(
						[
							'declare const api: {method: (value: string) => string}',
							'declare function make(value: string): string',
							'export function ordered() {',
							"	const output = make('x')",
							'	return api.method(output)',
							'}',
							'export function spread(source: {value: string}) {',
							'	const copy = {...source}',
							'	return api.method(copy.value)',
							'}',
							''
						],
						'\n'
					),
					'const MAX_SIZE = 10\nexport const sizes = {maxSize: MAX_SIZE, other: MAX_SIZE}\n'
				])
			})
		)

		testApi.effect(
			'reports closed sets read from a value instead of a schema',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'closed-sets.ts': Array.join(
						[
							"import {Schema} from 'effect'",
							'',
							'const TABLE = [{kind: "a"}, {kind: "b"}] as const',
							'export type Kind = (typeof TABLE)[number]["kind"]',
							'export type Index = keyof typeof TABLE',
							'export type Letter = typeof Letter.Type',
							'export const Letter = Schema.Literals(["a", "b"])',
							'export type Pair = typeof Letter.literals',
							'export type Field = (typeof Letter.Type)[number]',
							'const OWNER = {table: ["a", "b"]} as const',
							'export type Owned = (typeof OWNER.table)[number]',
							'type Known = Record<string, string>',
							'export type Keyed = Known[(typeof TABLE)[number]["kind"]]',
							'export {OWNER, TABLE}',
							'export type {Known}'
						],
						'\n'
					)
				})
				assert.deepStrictEqual(customCodes(result.stdout), [
					'@deslop/coding-standards(no-type-from-value)',
					'@deslop/coding-standards(no-type-from-value)',
					'@deslop/coding-standards(no-type-from-value)',
					'@deslop/coding-standards(no-type-from-value)'
				])
			})
		)

		testApi.effect(
			'uses import bindings instead of matching shadowed names',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'bindings.ts': Array.join(
						[
							'function compile(Schema: {decode: (value: string) => string}) {',
							'  return Schema.decode("ok")',
							'}',
							'function useRef<T>() { return undefined as T | undefined }',
							'const ref = useRef<string | null>()',
							'function pipe(value: string, suffix: string) { return value + suffix }',
							'const handlers = {size: (value: string) => pipe(value, "!")}',
							'export const nested = pipe(pipe(pipe(pipe("value", "!"), "!"), "!"), "!")',
							'export {compile, handlers, ref}'
						],
						'\n'
					)
				})
				assert.deepStrictEqual(customCodes(result.stdout), ['@deslop/coding-standards(no-trivial-indirection)'])
			})
		)

		testApi.effect(
			'reports redundant primitive state types while retaining intentional widening',
			Effect.fnUntraced(function* () {
				const invalidSource = [
					"import {MutableRef, Ref, SubscriptionRef} from 'effect'",
					'',
					"import * as React from 'react'",
					"import {useState} from 'react'",
					'',
					"export const text = MutableRef.make<string>('')",
					'export const count = Ref.make<number>(0)',
					'export const enabled = SubscriptionRef.make<boolean>(false)',
					"export const [label] = useState<string>('ready')",
					'export const [size] = useState<number>(1)',
					'export const [visible] = React.useState<boolean>(true)',
					"export const mismatched = MutableRef.make<number>('')",
					"export const extraArgument = MutableRef.make<string>('', '')",
					"export const extraType = MutableRef.make<string, number>('')",
					'export const [missingArgument] = useState<string>()',
					'export const widened = MutableRef.make<string | undefined>(undefined)',
					'export const nullable = SubscriptionRef.make<string | null>(null)',
					'export const [optional] = React.useState<string | undefined>(undefined)',
					'export function shadowed(MutableRef: {make: <T>(value: T) => T}, Ref: {make: <T>(value: T) => T}, SubscriptionRef: {make: <T>(value: T) => T}, useState: <T>(value: T) => T, React: {useState: <T>(value: T) => T}) {',
					'  return [MutableRef.make<string>(""), Ref.make<number>(0), SubscriptionRef.make<boolean>(false), useState<string>(""), React.useState<boolean>(true)]',
					'}'
				]
				const invalid = yield* lintSource({'state-invalid.ts': Array.join(invalidSource, '\n')})
				assert.strictEqual(invalid.exitCode, ChildProcessSpawner.ExitCode(1))
				assert.deepStrictEqual(
					pipe(
						invalid.stdout.diagnostics,
						Array.filter(diagnostic => diagnostic.code === '@deslop/coding-standards(no-redundant-state-type)'),
						Array.flatMap(diagnostic => Array.map(diagnostic.labels, label => invalidSource[label.span.line - 1]))
					),
					[
						"export const text = MutableRef.make<string>('')",
						'export const count = Ref.make<number>(0)',
						'export const enabled = SubscriptionRef.make<boolean>(false)',
						"export const [label] = useState<string>('ready')",
						'export const [size] = useState<number>(1)',
						'export const [visible] = React.useState<boolean>(true)'
					]
				)
				const valid = yield* lintSource({
					'state-valid.ts': Array.join(
						[
							"import {MutableRef, Ref} from 'effect'",
							"import * as EffectModules from 'effect'",
							'',
							"import {useState} from 'react'",
							'',
							"export const inferred = MutableRef.make('')",
							"export const restricted = MutableRef.make<'idle'>('idle')",
							"export const union = Ref.make<'idle' | 'ready'>('idle')",
							'export const shape = MutableRef.make<{path?: string}>({})',
							'export const items = Ref.make<string[]>([])',
							"export const namespace = EffectModules.MutableRef.make<string>('')",
							'export const unsafe = Ref.makeUnsafe<number>(0)',
							'export const [literal] = useState<true>(true)',
							"export const [lazy] = useState<string>(() => '')",
							'MutableRef.set(inferred, "changed")'
						],
						'\n'
					)
				})
				assert.deepStrictEqual(customCodes(valid.stdout), [])
				assert.strictEqual(valid.stderr, '')
			})
		)

		testApi.effect(
			'reports implicit concurrency, dropped causes, empty recoveries, render-time atoms, barrels and gradients',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'barrel.ts': "export {Effect} from 'effect'\nexport * from 'effect/Option'",
					'effects.tsx': Array.join(
						[
							"import {Array, Effect, Schema} from 'effect'",
							"import {Atom} from 'effect/reactivity'",
							'',
							'declare const items: number[]',
							'declare const options: {concurrency: number}',
							'declare function load(id: number): Effect.Effect<number>',
							'declare function download(): Promise<string>',
							'class Failed extends Schema.TaggedError<Failed>()("Failed", {cause: Schema.optional(Schema.Defect()), message: Schema.String}) {}',
							'const countAtom = Atom.make(0)',
							'export const sequential = Effect.forEach(items, load)',
							'export const dataLast = Effect.forEach(load)',
							'export const combined = Effect.all([load(1), load(2)])',
							'export const discarded = Effect.all([load(1)], {discard: true})',
							'export const parallel = Effect.forEach(items, load, {concurrency: "unbounded"})',
							'export const ordered = Effect.forEach(load, {concurrency: 1})',
							'export const forwarded = Effect.all([load(1)], options)',
							'export const piped = Effect.forEach((id: number) => load(id), options)',
							'export const struct = Effect.all({one: load(1)}, {concurrency: 2})',
							'export const dropped = Effect.mapError(load(1), failure => Failed.make({message: "Cannot load"}))',
							'export const tried = Effect.tryPromise({catch: failure => Failed.make({message: "Cannot download"}), try: download})',
							'export const kept = Effect.mapError(load(1), cause => Failed.make({cause, message: "Cannot load"}))',
							'export const spread = Effect.mapError(load(1), failure => Failed.make({...{message: "Cannot load"}}))',
							'export const both = Effect.mapBoth(load(1), {onFailure: failure => Failed.make({message: "Cannot load"}), onSuccess: value => value})',
							'export const bothKept = Effect.mapBoth(load(1), {onFailure: cause => Failed.make({cause, message: "Cannot load"}), onSuccess: value => value})',
							'export const emptied = Effect.orElseSucceed(load(1), () => [])',
							'export const emptyArray = Effect.orElseSucceed(load(1), () => Array.empty<number>())',
							'export const described = Effect.catch(load(1), failure => Effect.succeed(`${failure}`))',
							'export const silenced = Effect.catch(load(1), () => Effect.void)',
							'export const blanked = Effect.catch(load(1), () => Effect.succeed(""))',
							'export const optional = Effect.option(load(1))',
							'export const zero = Effect.orElseSucceed(load(1), () => 0)',
							'export function Counter() { const local = Atom.make(0); return <span>{countAtom.label}{local.label}</span> }',
							'export function Check(props: {value: unknown}) { return <span>{String(Atom.isAtom(props.value))}</span> }',
							'export function Frozen() { "use no memo"; return <div /> }',
							'export const faded = "bg-linear-to-b from-muted to-background"',
							// oxlint-disable-next-line @deslop/coding-standards/no-gradient -- Invalid source exercises the custom gradient rule.
							'export const painted = "bg-[radial-gradient(circle,var(--muted),transparent)]"'
						],
						'\n'
					),
					'reexports.ts': "export {Option} from 'effect'"
				})
				const rules = [
					'explicit-effect-concurrency',
					'no-barrel-module',
					'no-compiler-opt-out',
					'no-component-atom-allocation',
					'no-empty-recovery',
					'no-gradient',
					'preserve-error-cause'
				]
				assert.deepStrictEqual(
					Array.filter(customCodes(result.stdout), code =>
						Array.some(rules, rule => code === `@deslop/coding-standards(${rule})`)
					),
					Array.map(
						[
							'explicit-effect-concurrency',
							'explicit-effect-concurrency',
							'explicit-effect-concurrency',
							'explicit-effect-concurrency',
							'no-barrel-module',
							'no-barrel-module',
							'no-barrel-module',
							'no-compiler-opt-out',
							'no-component-atom-allocation',
							'no-empty-recovery',
							'no-empty-recovery',
							'no-empty-recovery',
							'no-empty-recovery',
							'no-gradient',
							'no-gradient',
							'preserve-error-cause',
							'preserve-error-cause',
							'preserve-error-cause',
							'preserve-error-cause'
						],
						rule => `@deslop/coding-standards(${rule})`
					)
				)
			})
		)

		testApi.effect(
			'keeps fallible I/O in the error channel and recovery independent of display wording',
			Effect.fnUntraced(function* () {
				const source = [
					"import {Effect} from 'effect'",
					"import * as SecureStore from 'expo-secure-store'",
					"import * as Notifications from 'expo-notifications'",
					"import {Asset} from 'expo-asset'",
					'',
					'declare const work: Effect.Effect<void, {message: string; reason: string}>',
					'declare const native: {hasLink: () => Promise<boolean>}',
					'export const deleted = Effect.promise(() => SecureStore.deleteItemAsync("session"))',
					'export const badge = Effect.promise(() => Notifications.setBadgeCountAsync(0))',
					'export const permissions = Effect.promise(() => Notifications.requestPermissionsAsync())',
					'export const asset = Effect.promise(() => Asset.fromModule(1).downloadAsync())',
					'export const typed = Effect.tryPromise(() => SecureStore.deleteItemAsync("session"))',
					'export const infallible = Effect.promise(() => native.hasLink())',
					'export function shadowed(SecureStore: {deleteItemAsync: () => Promise<void>}) { return Effect.promise(() => SecureStore.deleteItemAsync()) }',
					'export const retry = Effect.retry(work, {while: failure => failure.message === "offline"})',
					'export const catchMessage = Effect.catchIf(work, failure => failure.message !== "offline", () => Effect.void)',
					'export const retryReason = Effect.retry(work, {while: failure => failure.reason === "Offline"})',
					'export const display = Effect.mapError(work, failure => failure.message === "Error" ? "Unavailable" : failure.message)',
					'export const repeatValue = Effect.repeat(Effect.succeed({message: "ready"}), {while: value => value.message === "ready"})'
				]
				const result = yield* lintSource({'boundaries.ts': Array.join(source, '\n')})
				assert.strictEqual(result.stderr, '')
				assert.deepStrictEqual(
					pipe(
						result.stdout.diagnostics,
						Array.filter(diagnostic =>
							Array.contains(
								[
									'@deslop/coding-standards(no-fallible-promise)',
									'@deslop/coding-standards(no-error-message-control-flow)'
								],
								diagnostic.code
							)
						),
						Array.map(
							diagnostic =>
								String.split(result.sources[0] ?? '', '\n')[(diagnostic.labels[0]?.span.line ?? 0) - 1] ?? ''
						),
						Array.sort(String.Order)
					),
					pipe(
						[7, 8, 9, 10, 14, 15],
						Array.map(index => source[index] ?? ''),
						Array.sort(String.Order)
					)
				)
			})
		)

		testApi.effect(
			'distinguishes named data-last callbacks and absent error causes',
			Effect.fnUntraced(function* () {
				const source = [
					"import {Effect, Redacted, Schema} from 'effect'",
					'',
					'declare const items: number[]',
					'declare const options: {concurrency: number}',
					'function load(id: number) { return Effect.succeed(id) }',
					'class Failed extends Schema.TaggedError<Failed>()("Failed", {cause: Schema.Unknown}) {}',
					'export const dataLast = Effect.forEach(load, options)',
					'export const dataFirst = Effect.forEach(items, load)',
					'export const missing = Effect.mapError(Effect.fail("failure"), failure => Failed.make({cause: undefined}))',
					'export const nullCause = Effect.mapError(Effect.fail("failure"), failure => Failed.make({"cause": null}))',
					'export const voidCause = Effect.mapError(Effect.fail("failure"), failure => Failed.make({cause: void failure}))',
					'export const kept = Effect.mapError(Effect.fail("failure"), failure => Failed.make({cause: failure}))',
					'export const redacted = Effect.mapError(Effect.fail("failure"), failure => Failed.make({cause: Redacted.make(failure)}))',
					'export function shadowed(undefined: string) { return Effect.mapError(Effect.fail("failure"), failure => Failed.make({cause: undefined})) }',
					'const loadUntraced = Effect.fnUntraced(function* (id: number) { return yield* Effect.succeed(id) })',
					'const loadTraced = Effect.fn("load")(function* (id: number) { return yield* Effect.succeed(id) })',
					'export const untraced = Effect.forEach(loadUntraced, options)',
					'export const traced = Effect.forEach(loadTraced, options)',
					'const loadDirect = Effect.fn(function* (id: number) { return yield* Effect.succeed(id) })',
					'export const direct = Effect.forEach(loadDirect, options)'
				]
				const result = yield* lintSource({'precision.ts': Array.join(source, '\n')})
				assert.strictEqual(result.stderr, '')
				assert.deepStrictEqual(
					pipe(
						result.stdout.diagnostics,
						Array.filter(diagnostic =>
							Array.contains(
								[
									'@deslop/coding-standards(explicit-effect-concurrency)',
									'@deslop/coding-standards(preserve-error-cause)'
								],
								diagnostic.code
							)
						),
						Array.map(
							diagnostic =>
								String.split(result.sources[0] ?? '', '\n')[(diagnostic.labels[0]?.span.line ?? 0) - 1] ?? ''
						),
						Array.sort(String.Order)
					),
					pipe(
						[7, 8, 9, 10, 13],
						Array.map(index => source[index] ?? ''),
						Array.sort(String.Order)
					)
				)
			})
		)

		testApi.effect(
			'follows immutable boundary callbacks and schemas without rejecting optionality, validation or encoding',
			Effect.fnUntraced(function* () {
				const source = [
					"import {Array, Effect, Redacted, Schema, pipe} from 'effect'",
					"import {HttpClientRequest, HttpClientResponse, HttpIncomingMessage, HttpServerRequest} from 'effect/http'",
					"import * as Notifications from 'expo-notifications'",
					"import {getExpoPushTokenAsync, setBadgeCountAsync} from 'expo-notifications'",
					"import {deleteItemAsync} from 'expo-secure-store'",
					'',
					'declare const work: Effect.Effect<number[], Error>',
					'declare const source: string',
					'declare const response: HttpClientResponse.HttpClientResponse',
					'declare const native: {hasLink: () => Promise<boolean>}',
					'class BoundaryError extends Schema.TaggedError<BoundaryError>()("BoundaryError", {cause: Schema.Unknown}) {}',
					'function empty() { return [] }',
					'const nothing = () => Effect.void',
					'export const badEmpty = Effect.orElseSucceed(work, Array.empty<number>)',
					'export const badNamedEmpty = Effect.orElseSucceed(work, empty)',
					'export const badConstEmpty = Effect.catch(work, nothing)',
					'export const goodOptional = Effect.option(work)',
					'export const goodZero = Effect.orElseSucceed(work, () => 0)',
					'export const goodLogged = Effect.ignore(work, {log: "Warn", message: "Cache not read"})',
					'export const badLiteralCause = Effect.mapError(work, cause => BoundaryError.make({cause: "failed"}))',
					'export const badMessageCause = Effect.mapError(work, cause => BoundaryError.make({cause: cause.message}))',
					'declare const metadata: {cause: string}',
					'export const badPropertyCause = Effect.mapError(work, cause => BoundaryError.make({cause: metadata.cause}))',
					'declare const message: string',
					'export const badOuterCause = Effect.mapError(work, cause => BoundaryError.make({cause: message}))',
					'export const badShadowCause = Effect.mapError(work, cause => BoundaryError.make({cause: ((cause: string) => cause)("lost")}))',
					'export const badNoParamCatch = Effect.tryPromise({try: () => native.hasLink(), catch: () => BoundaryError.make({})})',
					'export const goodCause = Effect.mapError(work, cause => BoundaryError.make({cause}))',
					'export const goodRedacted = Effect.mapError(work, cause => BoundaryError.make({cause: Redacted.make(cause)}))',
					'export const goodClassify = Effect.mapError(Effect.fromOption(Schema.decodeUnknownOption(Schema.String)(source)), () => BoundaryError.make({}))',
					'const Json = Schema.fromJsonString(Schema.Unknown)',
					'const alias = Json',
					'export const badJson = Schema.decodeUnknownSync(alias)(source)',
					'export const badResponse = HttpClientResponse.schemaBodyJson(Schema.Unknown)',
					'export const badIncoming = HttpIncomingMessage.schemaBodyJson(Schema.Unknown)',
					'export const badRequest = HttpServerRequest.schemaBodyJson(Schema.Unknown)',
					'export const goodResponse = HttpClientResponse.schemaBodyJson(Schema.Struct({payload: Schema.Unknown}))',
					'export const goodEncoding = Schema.encodeSync(Json)({message})',
					'export const goodRequestEncoding = HttpClientRequest.schemaBodyJson(Schema.Unknown)',
					'export const goodStaged = Schema.decodeUnknownSync(Schema.String)(Schema.decodeUnknownSync(Json)(source))',
					'export const goodSyncPiped = pipe(Schema.decodeUnknownSync(Json)(source),Schema.decodeUnknownSync(Schema.String))',
					'export const goodEffectStaged = pipe(HttpClientResponse.schemaBodyJson(Schema.Unknown)(response), Effect.flatMap(Schema.decodeUnknownEffect(Schema.String)))',
					'const token = () => Notifications.getExpoPushTokenAsync()',
					'function remove() { return Notifications.setBadgeCountAsync(0) }',
					'export const badToken = Effect.promise(token)',
					'export const badNamedPromise = Effect.promise(remove)',
					'export const badInlineToken = Effect.promise(() => Notifications.getExpoPushTokenAsync())',
					'export const badNamedToken = Effect.promise(() => getExpoPushTokenAsync())',
					'export const badNamedBadge = Effect.promise(() => setBadgeCountAsync(0))',
					'export const badNamedDelete = Effect.promise(() => deleteItemAsync("session"))',
					'export const goodNamedTyped = Effect.tryPromise(() => getExpoPushTokenAsync())',
					'export function goodShadowedPromise(getExpoPushTokenAsync: () => Promise<string>) { return Effect.promise(() => getExpoPushTokenAsync()) }',
					'export const goodTyped = Effect.tryPromise(token)',
					'export const goodNative = Effect.promise(() => native.hasLink())',
					'export function goodParameter(fallback: () => number[]) { return Effect.orElseSucceed(work, fallback) }',
					'export function goodShadow(HttpClientResponse: {schemaBodyJson: (schema: unknown) => unknown}) { return HttpClientResponse.schemaBodyJson(Schema.Unknown) }',
					'let mutable = token',
					'export const goodUnknownBinding = Effect.promise(mutable)',
					'function reassigned() { return Notifications.setBadgeCountAsync(0) }',
					'reassigned = () => Promise.resolve(true)',
					'export const goodReassigned = Effect.promise(reassigned)',
					'const cycleA = cycleB',
					'const cycleB = cycleA',
					'export const goodUnknownCycle = Effect.orElseSucceed(work, cycleA)'
				]
				const result = yield* lintSource({'boundary-aliases.ts': Array.join(source, '\n')})
				assert.strictEqual(result.stderr, '')
				assert.deepStrictEqual(
					pipe(
						result.stdout.diagnostics,
						Array.filter(diagnostic =>
							Array.some(
								['no-empty-recovery', 'preserve-error-cause', 'no-unvalidated-json-decode', 'no-fallible-promise'],
								rule => diagnostic.code === `@deslop/coding-standards(${rule})`
							)
						),
						Array.map(
							diagnostic =>
								String.split(result.sources[0] ?? '', '\n')[(diagnostic.labels[0]?.span.line ?? 0) - 1] ?? ''
						),
						Array.sort(String.Order)
					),
					pipe(source, Array.filter(String.startsWith('export const bad')), Array.sort(String.Order))
				)
			})
		)

		testApi.effect(
			'keeps SwiftUI modifiers on the theme’s spacing, type and colours',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'screen.tsx': Array.join(
						[
							"import {VStack} from '@expo/ui/swift-ui'",
							"import {font, foregroundStyle, frame, lineSpacing, listRowInsets, padding, strokeBorder, tint} from '@expo/ui/swift-ui/modifiers'",
							'',
							'declare const space: Record<number, number>',
							'declare const colors: {foreground: string}',
							'export const padded = [padding({all: 16})] // reported',
							'export const sized = [font({size: 15})] // reported',
							"export const painted = [foregroundStyle('#4385be')] // reported",
							"export const tinted = [tint('#fff')] // reported",
							'export const inset = [listRowInsets({leading: 20})] // reported',
							'export const leading = [lineSpacing(4)] // reported',
							"export const ringed = [strokeBorder({content: '#fff', shape: 'circle'})] // reported",
							'export const spaced = [listRowInsets({leading: space[4]}), lineSpacing(space[1])]',
							"export const themed = [padding({all: space[4]}), frame({height: 64}), font({textStyle: 'body'}), foregroundStyle(colors.foreground)]",
							'export function Spaced() { return <VStack spacing={12} /> } // reported',
							'export function Tight() { return <VStack spacing={0} /> }'
						],
						'\n'
					),
					// Without @expo/ui, a padding call is someone else's.
					'utils.ts': Array.join(['declare function padding(input: {all: number}): void', 'padding({all: 16})'], '\n')
				})
				const lines = reportedLines(result, 'swiftui-theme-values')
				assert.deepStrictEqual(lines.reported, lines.marked)
			})
		)

		testApi.effect(
			'rejects an empty collector a loop only fills, while keeping loops whose items depend on each other or on effects',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'collectors.ts': Array.join(
						[
							"import {Array, Effect, MutableHashMap, MutableList} from 'effect'",
							'',
							'declare const notes: {id: string; pinned: boolean; tags: string[]}[]',
							'export function tagsOf() {',
							'	const tags: string[] = []',
							'	for (const note of notes) { // reported',
							'		for (const tag of note.tags) tags.push(tag)',
							'	}',
							'	return tags',
							'}',
							'export function pinnedIds() {',
							'	const ids = MutableList.make<string>()',
							'	for (const note of notes) if (note.pinned) MutableList.append(ids, note.id) // reported',
							'	return ids',
							'}',
							'export function byId() {',
							'	const index: Record<string, string[]> = {}',
							'	Array.forEach(notes, note => { index[note.id] = note.tags }) // reported',
							'	return index',
							'}',
							'export function sizes() {',
							'	const counts = MutableHashMap.empty<string, number>()',
							'	for (const note of notes) MutableHashMap.set(counts, note.id, note.tags.length) // reported',
							'	return counts',
							'}',
							'export function numbered() {',
							'	const lines: string[] = []',
							'	for (const note of notes) lines.push(`${lines.length}: ${note.id}`)',
							'	return lines',
							'}',
							'export const installed = Effect.gen(function* () {',
							'	const done: string[] = []',
							'	for (const note of notes) done.push(yield* Effect.succeed(note.id))',
							'	return done',
							'})',
							'export function twoGuards() {',
							'	const ids: string[] = []',
							'	for (const note of notes) {',
							'		if (note.pinned) {',
							'			if (note.tags.length > 0) ids.push(note.id)',
							'		}',
							'	}',
							'	return ids',
							'}',
							'export function branched() {',
							'	const ids: string[] = []',
							'	for (const note of notes) {',
							'		if (note.pinned) ids.push(note.id)',
							"		else ids.push('')",
							'	}',
							'	return ids',
							'}',
							'export function logged() {',
							'	const ids: string[] = []',
							'	for (const note of notes) {',
							'		ids.push(note.id)',
							'		Effect.runSync(Effect.log(note.id))',
							'	}',
							'	return ids',
							'}',
							'export function seeded() {',
							"	const ids = ['first']",
							'	for (const note of notes) ids.push(note.id)',
							'	return ids',
							'}'
						],
						'\n'
					)
				})
				const lines = reportedLines(result, 'no-loop-collector')
				assert.deepStrictEqual(lines.reported, lines.marked)
			})
		)

		testApi.effect(
			'keeps derived-type policy transparent through generic wrappers without banning exported or inline types',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'derived.ts': Array.join(
						[
							"import {Effect, Option} from 'effect'",
							'declare function serve(): Effect.Effect<{web: string}>',
							'type Direct = ReturnType<typeof serve> // reported',
							"type Web = Effect.Success<ReturnType<typeof serve>>['web'] // reported",
							'type Wrapped = Option.Option<Readonly<ReturnType<typeof serve>>> // reported',
							'type Sibling = Record<string, ReturnType<typeof serve>> // reported',
							"export type Public = Effect.Success<ReturnType<typeof serve>>['web']",
							'type Listed = Option.Option<ReturnType<typeof serve>>',
							'export type {Listed}',
							'export function inline(value: Option.Option<ReturnType<typeof serve>>) { return value }',
							'type Domain = Option.Option<{web: string}>',
							'export declare function consume(direct: Direct, web: Web, wrapped: Wrapped, sibling: Sibling, domain: Domain): void'
						],
						'\n'
					)
				})
				const lines = reportedLines(result, 'no-floating-derived-type')
				assert.deepStrictEqual(lines.reported, lines.marked)
			})
		)

		testApi.effect(
			'owns repeated constant-return helpers without changing callback, export or allocation exclusions',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'constants.ts': Array.join(
						[
							'declare function use(...values: unknown[]): void',
							"function repeated() { return 'none' } // reported",
							'use(repeated(), repeated())',
							'function literal() { return `none` } // reported',
							'use(literal(), literal())',
							"export function publicValue() { return 'none' }",
							"function callback() { return 'none' }",
							'use(callback, callback)',
							"async function asynchronous() { return 'none' }",
							'use(asynchronous(), asynchronous())',
							"function* generated() { return 'none' }",
							'use(generated(), generated())',
							"function generic<A>() { return 'none' }",
							'use(generic<string>(), generic<number>())',
							'function allocated() { return {} }',
							'use(allocated(), allocated())',
							'function expression() { return /x/u }',
							'use(expression(), expression())'
						],
						'\n'
					)
				})
				const lines = reportedLines(result, 'no-trivial-indirection')
				assert.deepStrictEqual(lines.reported, lines.marked)
			})
		)

		testApi.effect(
			'rejects an is, has, can or should name whose value or return is plainly not a boolean',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'names.ts': Array.join(
						[
							'declare const session: {expiresAt: number}',
							'declare const now: number',
							'declare const items: string[]',
							'export function isExpired() { return session.expiresAt - now } // reported',
							'export function isLate() { return session.expiresAt < now }',
							'export function hasRows(rows: string[]) { if (rows.length === 0) return 0; return rows.length } // reported',
							"export const isReady = 'yes' // reported",
							'export const canEdit = {edit: true} // reported',
							'export const shouldRetry = () => `${now}` // reported',
							'export const hasItems = items.length // reported',
							'export const isOpen = false',
							'export const isUnset = null',
							'export const hasLabel = (label: string) => label.length > 0',
							'export function isInner() { return items.every(() => { return 1 }) }',
							'export function* isGenerated() { yield 1; return 1 }',
							'export const counter = 1 + 2',
							'export function hasText(text: string) { return text.length } // reported',
							'export function hasTuple(tuple: readonly [string]) { return tuple.length } // reported',
							'export function canCount(count: number) { return count } // reported',
							'export function isCallback(callback: () => boolean) { return callback() }',
							'export function isCallable(callback: {(): boolean}) { const isReady = callback; return isReady() }',
							'export function hasFlag(value: {length: boolean}) { return value.length }',
							'export function isNarrowed(value: boolean | number) { if (value === 0) return false; return value }'
						],
						'\n'
					)
				})
				const lines = reportedLines(result, 'no-misleading-boolean-name')
				assert.deepStrictEqual(lines.reported, lines.marked)
			})
		)

		testApi.effect(
			'rejects a guard repeated after an exit on the same test, unless something between could change it',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'guards.ts': Array.join(
						[
							'declare const order: {total: number}',
							'declare function refresh(): void',
							'declare function check(): boolean',
							'export function discount() {',
							'	if (order.total <= 0) return 0',
							'	const rate = order.total > 100 ? 0.1 : 0.05',
							'	if (order.total <= 0) return 0 // reported',
							'	return order.total * rate',
							'}',
							'export function afterCall() {',
							'	if (order.total <= 0) return 0',
							'	refresh()',
							'	if (order.total <= 0) return 0',
							'	return order.total',
							'}',
							'export function differentTest() {',
							'	if (order.total <= 0) return 0',
							'	if (order.total < 0) return 1',
							'	return order.total',
							'}',
							'export function assigned() {',
							'	if (order.total <= 0) order.total = 1',
							'	if (order.total <= 0) return 0',
							'	return order.total',
							'}',
							'export function withElse() {',
							'	if (order.total <= 0) {',
							'		return 0',
							'	} else {',
							'		order.total = 1',
							'	}',
							'	if (order.total <= 0) return 1',
							'	return 2',
							'}',
							'export function inCallback() {',
							'	if (order.total <= 0) return []',
							'	return [1].map(() => { if (order.total <= 0) return 0; return 1 })',
							'}',
							'export function called() {',
							'	if (check()) return 0',
							'	if (check()) return 1',
							'	return 2',
							'}',
							'export function skipped(items: number[]) {',
							'	for (const item of items) {',
							'		if (item < 0) continue',
							'		if (item < 0) continue // reported',
							'	}',
							'}'
						],
						'\n'
					)
				})
				const lines = reportedLines(result, 'no-repeated-guard')
				assert.deepStrictEqual(lines.reported, lines.marked)
			})
		)

		testApi.effect(
			'rejects hand-written capitalising and padding, and capitalises with String.capitalize',
			Effect.fnUntraced(function* () {
				const reported = yield* lintSource({
					'helpers.ts': Array.join(
						[
							"import {String} from 'effect'",
							'',
							'declare const word: string',
							'declare const name: string',
							'declare const width: number',
							'export const templated = `${String.toUpperCase(String.slice(0, 1)(word))}${String.slice(1)(word)}` // reported',
							"export const joined = String.toUpperCase(word[0] ?? '') + String.slice(1)(word) // reported",
							'export const native = word.charAt(0).toUpperCase() + word.slice(1) // reported',
							'export const mixed = String.toUpperCase(String.slice(0, 1)(word)) + String.slice(1)(name)',
							'export const local = word.charAt(0).toLocaleUpperCase() + word.slice(1)',
							'export const shouted = String.toUpperCase(word) + String.slice(1)(word)',
							'export const titled = `Dear ${String.toUpperCase(String.slice(0, 1)(word))}${String.slice(1)(word)}`',
							"export const padded = String.repeat(width - word.length)(' ') + word // reported",
							"export const trailing = `${word}${String.repeat(width - String.length(word))('.')}` // reported",
							"export const indented = String.repeat(width)('  ') + word",
							"export const unrelated = String.repeat(width - name.length)(' ') + word"
						],
						'\n'
					)
				})
				const lines = reportedLines(reported, 'no-hand-written-helper')
				assert.deepStrictEqual(lines.reported, lines.marked)
				const fixed = yield* lintSource(
					{
						'imported.ts': Array.join(
							[
								"import {Array, String} from 'effect'",
								'',
								'declare const words: string[]',
								'export const titles = Array.map(words, word => `${String.toUpperCase(String.slice(0, 1)(word))}${String.slice(1)(word)}`)'
							],
							'\n'
						),
						'missing.ts': Array.join(
							[
								"import {Array} from 'effect'",
								'',
								'declare const words: string[]',
								"export const titles = Array.map(words, word => (word[0] ?? '').toUpperCase() + word.substring(1))"
							],
							'\n'
						)
					},
					['--fix']
				)
				assert.deepStrictEqual(fixed.sources, [
					Array.join(
						[
							"import {Array, String} from 'effect'",
							'',
							'declare const words: string[]',
							'export const titles = Array.map(words, word => String.capitalize(word))',
							''
						],
						'\n'
					),
					Array.join(
						[
							"import {Array, String} from 'effect'",
							'',
							'declare const words: string[]',
							'export const titles = Array.map(words, word => String.capitalize(word))',
							''
						],
						'\n'
					)
				])
			})
		)

		testApi.effect(
			'rejects sorting or filtering a whole array to read one item or its emptiness, and fixes what findFirst and some say directly',
			Effect.fnUntraced(function* () {
				const reported = yield* lintSource({
					'picks.ts': Array.join(
						[
							"import {Array, Order, pipe} from 'effect'",
							'',
							'declare const notes: {pinned: boolean; rank: number}[]',
							'declare const byRank: Order.Order<{pinned: boolean; rank: number}>',
							'export const smallest = Array.head(Array.sort(notes, byRank)) // reported',
							'export const pipedSmallest = pipe(notes, Array.sort(byRank), Array.head) // reported',
							'export const largest = Array.last(Array.sort(notes, byRank))',
							'export const ordered = Array.sort(notes, byRank)',
							'export const firstPinned = Array.head(Array.filter(notes, note => note.pinned)) // reported',
							'export const pipedPinned = pipe(notes, Array.filter(note => note.pinned), Array.head) // reported',
							'export const anyPinned = Array.isArrayNonEmpty(Array.filter(notes, note => note.pinned)) // reported',
							'export const nonePinned = pipe(notes, Array.filter(note => note.pinned), Array.isArrayEmpty) // reported',
							'export const indexed = Array.filter(notes, note => note.pinned)[0] // reported',
							'export const sortedFirst = Array.sort(notes, byRank)[0] // reported',
							'export const hasPinned = Array.some(notes, note => note.pinned)',
							'export const pinned = Array.filter(notes, note => note.pinned)',
							'export const ranks = Array.head(Array.map(notes, note => note.rank))',
							'export const separate = pipe(notes, Array.filter(note => note.pinned), Array.map(note => note.rank), Array.head)'
						],
						'\n'
					)
				})
				const lines = reportedLines(reported, 'no-intermediate-collection')
				assert.deepStrictEqual(lines.reported, lines.marked)
				const fixed = yield* lintSource(
					{
						'picks.ts': Array.join(
							[
								"import {Array, pipe} from 'effect'",
								'',
								'declare const notes: {pinned: boolean; rank: number}[]',
								'export const firstPinned = Array.head(Array.filter(notes, note => note.pinned))',
								'export const pipedPinned = pipe(notes, Array.filter(note => note.pinned), Array.head, Array.isSome)',
								'export const anyPinned = Array.isArrayNonEmpty(Array.filter(notes, note => note.pinned))',
								'export const nonePinned = Array.isReadonlyArrayEmpty(Array.filter(notes, note => note.pinned))',
								'export const pipedNone = pipe(notes, Array.filter(note => note.pinned), Array.isArrayEmpty)'
							],
							'\n'
						)
					},
					['--fix']
				)
				assert.deepStrictEqual(fixed.sources, [
					Array.join(
						[
							"import {Array, pipe} from 'effect'",
							'',
							'declare const notes: {pinned: boolean; rank: number}[]',
							'export const firstPinned = Array.findFirst(notes, note => note.pinned)',
							'export const pipedPinned = pipe(',
							'\tnotes,',
							'\tArray.findFirst(note => note.pinned),',
							'\tArray.isSome',
							')',
							'export const anyPinned = Array.some(notes, note => note.pinned)',
							'export const nonePinned = !Array.some(notes, note => note.pinned)',
							'export const pipedNone = pipe(',
							'\tnotes,',
							'\tArray.filter(note => note.pinned),',
							'\tArray.isArrayEmpty',
							')',
							''
						],
						'\n'
					)
				])
			})
		)

		testApi.effect(
			'rejects Option wrap-unwrap indirection but keeps meaningful delimiter and codec conversions',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'conversions.ts': Array.join(
						[
							"import {Array, Option, Schema, String, pipe} from 'effect'",
							'',
							'declare const maybe: string | undefined',
							'declare const tags: string[]',
							'declare const value: {n: number}',
							'declare const Item: Schema.Codec<{n: number}, {n: string}>',
							'declare const Other: Schema.Codec<{n: number}, {n: string}>',
							"export const label = Option.getOrElse(Option.fromUndefinedOr(maybe), () => 'none') // reported",
							"export const piped = pipe(maybe, Option.fromNullishOr, Option.getOrElse(() => 'none')) // reported",
							'export const wrapped = Option.getOrNull(Option.some(maybe)) // reported',
							"export const curried = Option.getOrElse(() => 'none')(Option.fromNullishOr(maybe)) // reported",
							'export const mapped = pipe(Option.fromNullishOr(maybe), Option.map(text => text.length), Option.getOrElse(() => 0))',
							"export const fallback = maybe ?? 'none'",
							'export const copied = Schema.decodeSync(Item)(Schema.encodeSync(Item)(value))',
							'export const converted = Schema.decodeSync(Other)(Schema.encodeSync(Item)(value))',
							"export const resplit = String.split(Array.join(tags, ','), ',')",
							"export const pipedSplit = pipe(tags, Array.join(','), String.split(','))",
							"export const respaced = String.split(Array.join(tags, ','), ' ')"
						],
						'\n'
					)
				})
				const lines = reportedLines(result, 'no-trivial-indirection')
				assert.deepStrictEqual(lines.reported, lines.marked)
			})
		)

		testApi.effect(
			'rejects an assertion of an expression against itself, while keeping calls that may answer differently',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'sessions.test.ts': Array.join(
						[
							"import {assert, it} from '@effect/vitest'",
							'',
							'declare const sessions: {active: boolean; id: string}[]',
							'declare function cleanup(items: {active: boolean; id: string}[]): {active: boolean; id: string}[]',
							"it('keeps active sessions after cleanup', () => {",
							'	const kept = cleanup(sessions)',
							'	assert.deepStrictEqual(kept, kept) // reported',
							'	assert.strictEqual(kept.length, kept.length) // reported',
							'	assert.strictEqual(1, 1) // reported',
							'	assert.deepStrictEqual(cleanup(sessions), cleanup(sessions))',
							'	assert.deepStrictEqual(kept, sessions)',
							"	assert.deepStrictEqual(kept[0]?.id, 'a')",
							'})'
						],
						'\n'
					)
				})
				const lines = reportedLines(result, 'no-self-comparing-assertion')
				assert.deepStrictEqual(lines.reported, lines.marked)
			})
		)

		testApi.effect(
			'reports focused, skipped, conditional and failing tests',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'skips.test.ts': Array.join(
						[
							"import {describe, it} from '@effect/vitest'",
							'',
							"import {Effect, Layer} from 'effect'",
							'',
							"import {it as plainIt} from 'vite-plus/test'",
							'',
							'declare const ci: boolean',
							"it.effect.only('runs alone', () => Effect.void) // reported",
							"it.scoped.skip('never runs', () => Effect.void) // reported",
							"it.effect('runs', () => Effect.void)",
							"it.layer(Layer.empty)(test => { test.effect.only('runs alone in its layer', () => Effect.void) }) // reported",
							"it.layer(Layer.empty)(check => { check.skip('never runs in its layer', () => Effect.void) }) // reported",
							"it.layer(Layer.empty)(test => { test.skip('never runs in its layer either', () => Effect.void) }) // reported",
							"it.skipIf(ci)('skips on CI', () => {}) // reported",
							"it.effect.runIf(ci)('runs only on CI', () => Effect.void) // reported",
							"it.fails('passes by failing', () => {}) // reported",
							"it('skips through options', {skip: true}, () => {}) // reported",
							"plainIt.skip('a runner import belongs to the native rule', () => {})",
							"describe('runs together', {concurrent: true}, () => { it('runs', () => {}) })"
						],
						'\n'
					)
				})
				const lines = reportedLines(result, 'no-skipped-test')
				assert.deepStrictEqual(lines.reported, lines.marked)
			})
		)

		testApi.effect(
			'keeps per-test timeouts, retries, hang guards and flaky retries out of tests',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'limits.test.ts': Array.join(
						[
							"import {afterAll, beforeEach, describe, flakyTest, it} from '@effect/vitest'",
							'',
							"import {Effect, Layer} from 'effect'",
							'',
							'declare const work: Effect.Effect<void>',
							'const LONG = 60_000',
							'const OPTIONS = {timeout: 5_000}',
							"it.effect('waits long', () => Effect.void, 60_000) // reported",
							"it.effect('waits through a constant', () => Effect.void, LONG) // reported",
							"it.effect('builds its body', Effect.fnUntraced(function* () { yield* work }), 60_000) // reported",
							"it('times out through shared options', OPTIONS, () => {}) // reported",
							'const scenario = () => work',
							"it.effect('names its body', scenario, 60_000) // reported",
							"it.prop('samples', {}, () => true, {fastCheck: {numRuns: 10}})",
							'afterAll(() => {}, 10 * 1000) // reported',
							"it.effect('retries', () => Effect.void, {retry: 3}) // reported",
							"it('times out in options', {timeout: 1_000}, () => {}) // reported",
							"describe('repeats', {repeats: 5}, () => {}) // reported",
							'beforeEach(() => {}, 10_000) // reported',
							"it.layer(Layer.empty, {timeout: 30_000})(test => { test.effect('runs', () => Effect.void) }) // reported",
							"it.effect('guards a hang', () => Effect.timeout(work, '5 seconds')) // reported",
							"it.effect('falls back', () => Effect.timeoutOption(work, '1 second')) // reported",
							"it.effect('is flaky', () => flakyTest(work)) // reported",
							"it.effect('is flaky through it', () => it.flakyTest(work)) // reported",
							"describe('runs together', {concurrent: true}, () => { it.effect('runs', () => work) })",
							'afterAll(() => {})',
							"it.effect.each([1, 2])('runs %d', () => work)"
						],
						'\n'
					)
				})
				const lines = reportedLines(result, 'no-test-timeout')
				assert.deepStrictEqual(lines.reported, lines.marked)
			})
		)

		testApi.effect(
			'reports real-clock waits in tests, and TestClock sleeps that nothing in the file drives',
			Effect.fnUntraced(function* () {
				const driven = yield* lintSource({
					'sleeps.test.ts': Array.join(
						[
							"import {it} from '@effect/vitest'",
							"import {setTimeout as wait} from 'node:timers/promises' // reported",
							'',
							"import {Effect, Layer, Schedule} from 'effect'",
							'',
							"import {TestClock} from 'effect/testing'",
							'',
							'declare const work: Effect.Effect<void>',
							"it.effect('moves time', () => Effect.gen(function* () { yield* Effect.forkChild(Effect.sleep('1 minute')); yield* TestClock.adjust('1 minute') }))",
							"it.effect('sleeps for real', () => TestClock.withLive(Effect.sleep('100 millis'))) // reported",
							"it.effect('pipes into the live clock', () => Effect.sleep('100 millis').pipe(TestClock.withLive)) // reported",
							"it.live('sleeps live', () => Effect.sleep('100 millis')) // reported",
							"it.layer(Layer.empty, {excludeTestServices: true})(test => { test.effect('sleeps without test services', () => Effect.delay(work, '1 second')) }) // reported",
							"it('waits a turn', () => new Promise(resolve => setImmediate(resolve))) // reported",
							"it('waits on a timer the compiler reports', () => new Promise(resolve => setTimeout(resolve, 10)))",
							"it('waits through the promise timer', () => wait(10))",
							"it.effect('repeats on the test clock', () => Effect.repeat(work, Schedule.spaced('1 second')))"
						],
						'\n'
					)
				})
				const drivenLines = reportedLines(driven, 'no-sleeping-test')
				assert.deepStrictEqual(drivenLines.reported, drivenLines.marked)
				const undriven = yield* lintSource({
					'undriven.test.ts': Array.join(
						[
							"import {it} from '@effect/vitest'",
							'',
							"import {Effect} from 'effect'",
							'',
							"it.effect('never moves time', () => Effect.sleep('1 second')) // reported",
							"it.effect('runs', () => Effect.void)"
						],
						'\n'
					)
				})
				const undrivenLines = reportedLines(undriven, 'no-sleeping-test')
				assert.deepStrictEqual(undrivenLines.reported, undrivenLines.marked)
			})
		)

		testApi.effect(
			'reports tests that poll until a condition holds, not fixed repetitions',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'polls.test.ts': Array.join(
						[
							"import {it} from '@effect/vitest'",
							'',
							"import {Effect, Queue, Schedule, pipe} from 'effect'",
							'',
							"import {TestClock} from 'effect/testing'",
							'',
							'declare const ready: Effect.Effect<boolean>',
							'declare function flag(): boolean',
							'declare const events: Queue.Queue<boolean>',
							"it.effect('spins until ready', () => Effect.gen(function* () { while (!(yield* ready)) yield* Effect.sleep('20 millis') })) // reported",
							"it.effect('yields until ready', () => Effect.gen(function* () { while (true) { if (yield* ready) return; yield* Effect.yieldNow } })) // reported",
							"it.effect('repeats until ready', () => Effect.repeat(ready, {schedule: Schedule.spaced('10 millis'), until: done => done})) // reported",
							"it.effect('pipes a repeat', () => pipe(Effect.sleep('1 millis'), Effect.andThen(ready), Effect.repeat({until: done => done}))) // reported",
							"it.effect('retries eventually', () => Effect.eventually(ready)) // reported",
							"it.effect('spins on a repeat', () => Effect.repeat(ready, {until: done => done})) // reported",
							"it.effect('spins on a retry', () => Effect.retry(ready, {while: () => true})) // reported",
							'const UNTIL_READY = {until: (done: boolean) => done}',
							"it.effect('spins through shared options', () => Effect.repeat(ready, UNTIL_READY)) // reported",
							"it.effect('takes events until one holds', () => Effect.repeat(Queue.take(events), {until: done => done}))",
							"it('awaits ticks', async () => { while (!flag()) await Promise.resolve() }) // reported",
							"it.effect('moves time a fixed number of times', () => Effect.repeat(TestClock.adjust('1 second'), {times: 30}))",
							"it.effect('steps until it holds', () => Effect.repeat(ready, {times: 9, until: done => done}))",
							"it.effect('yields a fixed number of times', () => Effect.gen(function* () { for (let step = 0; step < 3; step += 1) yield* Effect.yieldNow }))"
						],
						'\n'
					)
				})
				const lines = reportedLines(result, 'no-polling-test')
				assert.deepStrictEqual(lines.reported, lines.marked)
			})
		)

		testApi.effect(
			'no-wall-clock reports real time read in tests, not the TestClock or fixed instants',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'clock.test.ts': Array.join(
						[
							"import {it} from '@effect/vitest'",
							'',
							"import {Clock, DateTime} from 'effect'",
							'',
							"import {TestClock} from 'effect/testing'",
							'',
							"it('reads the time the compiler reports', () => Date.now())",
							"it('builds today', () => Date()) // reported",
							"it('measures', () => performance.now()) // reported",
							"it('reads hrtime', () => process.hrtime.bigint()) // reported",
							"it.effect('measures the live clock', () => TestClock.withLive(Clock.currentTimeMillis)) // reported",
							"it.effect('reads the live date', () => TestClock.withLive(DateTime.now)) // reported",
							"it.effect('pipes a read into the live clock', () => Clock.currentTimeMillis.pipe(TestClock.withLive)) // reported",
							"it.live('reads the clock live', () => Clock.currentTimeMillis) // reported",
							"it('reads the date anywhere', () => DateTime.nowUnsafe()) // reported",
							"it.effect('reads the test clock', () => Clock.currentTimeMillis)",
							"it('builds a fixed date', () => new Date(0))",
							"it.effect('fixes the instant', () => TestClock.setTime(1_781_870_000_000))"
						],
						'\n'
					)
				})
				const lines = reportedLines(result, 'no-wall-clock')
				assert.deepStrictEqual(lines.reported, lines.marked)
			})
		)

		testApi.effect(
			'no-wall-clock reports reads in Effect and Stream callbacks, not synchronous application code',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'clock.ts': Array.join(
						[
							"import {Clock, DateTime, Effect, Stream} from 'effect'",
							'export const generator = Effect.gen(function* () { return DateTime.nowUnsafe() }) // reported',
							"export const traced = Effect.fn('Clock.traced')(function* () { return Date.now() })",
							'export const untraced = Effect.fnUntraced(function* () { return new Date() })',
							'export const unnamed = Effect.fn(function* () { return DateTime.nowUnsafe() }) // reported',
							'export const synchronous = Effect.sync(() => Date.now())',
							'export const mapped = Effect.map(Clock.currentTimeMillis, () => new Date())',
							'export const curried = Effect.map(() => DateTime.nowUnsafe()) // reported',
							"export const stream = Stream.map(Stream.tick('1 minute'), () => DateTime.toEpochMillis(DateTime.nowUnsafe())) // reported",
							'export const streamFunction = Stream.map(Stream.make(1), function () { return Date.now() })',
							'export const options = Effect.try({try: () => DateTime.nowUnsafe(), catch: String}) // reported',
							'export const computed = Effect["sync"](() => Date.now())',
							'export const clock = Effect.gen(function* () { return yield* Clock.currentTimeMillis })',
							"export const injected = Stream.mapEffect(Stream.tick('1 minute'), () => Clock.currentTimeMillis)",
							'export const fixed = Effect.sync(() => new Date(0))',
							'export const parsed = Effect.sync(() => new Date("2026-01-01"))',
							'export const render = () => DateTime.nowUnsafe()',
							'export function Component() { return Date.now() }',
							'export const onClick = () => new Date()',
							'export const handler = Effect.gen(function* () { return () => DateTime.nowUnsafe() })',
							'export const helper = Effect.gen(function* () { function plain() { return Date.now() }; return plain })',
							'export const ordinaryMap = [1].map(() => DateTime.nowUnsafe())',
							'export function shadow(Date: {now: () => number}) { return Effect.sync(() => Date.now()) }',
							'export function custom(DateTime: {nowUnsafe: () => number}) { return Effect.sync(() => DateTime.nowUnsafe()) }'
						],
						'\n'
					)
				})
				const lines = reportedLines(result, 'no-wall-clock')
				assert.deepStrictEqual(lines.reported, lines.marked)
				assert.isTrue(
					pipe(
						result.stdout.diagnostics,
						Array.filter(diagnostic => diagnostic.code === '@deslop/coding-standards(no-wall-clock)'),
						Array.every(diagnostic => String.includes('Clock.currentTimeMillis')(diagnostic.message))
					)
				)
			})
		)

		testApi.effect(
			'reports Effect tests and per-element callbacks that register tests in a loop',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'loops.test.ts': Array.join(
						[
							"import {describe, it} from '@effect/vitest'",
							'',
							"import {Array, Effect, Layer} from 'effect'",
							'',
							'const cases = [1, 2]',
							'for (const value of cases) it.effect(`runs ${value}`, () => Effect.void) // reported',
							'for (const value of cases) it(`plain ${value}`, () => {})',
							'for (const value of cases) it.concurrent(`concurrent ${value}`, () => {})',
							'Array.makeBy(2, index => it(`made ${index}`, () => {})) // reported',
							'Array.forEach(cases, value => { it(`each ${value}`, () => {}) }) // reported',
							'cases.map(value => describe(`group ${value}`, () => {})) // reported',
							'it.layer(Layer.empty)(test => { for (const value of cases) test.effect(`layer ${value}`, () => Effect.void) }) // reported',
							"it.effect.each(cases)('runs %d', () => Effect.void)",
							"it.effect('loops inside a test', () => Effect.gen(function* () { for (const value of cases) yield* Effect.log(value) }))"
						],
						'\n'
					)
				})
				const lines = reportedLines(result, 'no-test-in-loop')
				assert.deepStrictEqual(lines.reported, lines.marked)
				assert.isTrue(
					Array.some(
						result.stdout.diagnostics,
						diagnostic => diagnostic.code === 'vitest(prefer-each)' && diagnostic.labels[0]?.span.line === 7
					)
				)
			})
		)

		testApi.effect(
			'reports DOM test environments set by a pragma or an option',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'dom.test.ts': Array.join(
						[
							// Vitest reads a pragma wherever it appears in this file's text, so the test assembles each one.
							`// ${Array.join(['@vitest', 'environment'], '-')} jsdom // reported`,
							"import {it} from '@effect/vitest'",
							'',
							`/** ${Array.join(['@jest', 'environment'], '-')} happy-dom */ // reported`,
							`export const pragma = '${Array.join(['@vitest', 'environment'], '-')} node' // reported`,
							"export const config = {test: {environment: 'jsdom'}} // reported",
							"export const happy = {test: {environment: 'happy-dom'}} // reported",
							"export const node = {test: {environment: 'node'}}",
							"it('runs', () => {})"
						],
						'\n'
					)
				})
				const lines = reportedLines(result, 'no-dom-test-environment')
				assert.deepStrictEqual(lines.reported, lines.marked)
			})
		)

		testApi.effect(
			'keeps every schema definition in its service schema file',
			// judge-ignore no-repeated-search -- This lint fixture has five fixed input paths; suffix matching resolves Oxlint's absolute filenames.
			Effect.fnUntraced(function* () {
				const inputs = {
					'src/elsewhere/values.ts': Array.join(
						["import {Schema} from 'effect'", '', 'export const Shared = Schema.Struct({name: Schema.String})'],
						'\n'
					),
					'src/services/x/lib/store.ts': Array.join(
						[
							"import {Schema} from 'effect'",
							'',
							'const Stored = Schema.Array(Schema.String) // reported',
							'',
							'export const stored = Stored'
						],
						'\n'
					),
					'src/services/x/schema.ts': Array.join(
						[
							"import {Schema} from 'effect'",
							'',
							'export const Imported = Schema.Struct({name: Schema.String})',
							'export const ImportedList = Schema.Array(Imported)'
						],
						'\n'
					),
					'src/services/x/service.test.ts': Array.join(
						["import {Schema} from 'effect'", '', 'export const Fixture = Schema.Struct({name: Schema.String})'],
						'\n'
					),
					'src/services/x/service.ts': Array.join(
						[
							"import {Schema, pipe} from 'effect'",
							'',
							"import {Imported} from '#services/x/schema.ts'",
							'',
							'export const Local = Schema.Struct({name: Schema.String}) // reported',
							'export const Chained = Schema.String.check(Schema.isMinLength(1)) // reported',
							'export const Piped = pipe(Schema.String, Schema.check(Schema.isMinLength(1))) // reported',
							'export const Decoded = Schema.decodeUnknownSync(Imported)',
							'export const Used = Imported',
							'export class LocalError extends Schema.TaggedError<LocalError>()("LocalError", {message: Schema.String}) {} // reported',
							'export class Boxed extends Schema.TaggedClass<Boxed>()("Boxed", {name: Schema.String}) {} // reported',
							'export const Factory = Schema.Class<Factory>()("Factory", {name: Schema.String}) // reported'
						],
						'\n'
					)
				}
				const result = yield* lintSource(inputs)
				assert.deepStrictEqual(
					pipe(
						result.stdout.diagnostics,
						Array.filter(diagnostic => diagnostic.code === '@deslop/coding-standards(service-schema-file)'),
						Array.map(diagnostic =>
							pipe(
								Array.findFirst(Record.keys(inputs), name => String.endsWith(name)(diagnostic.filename ?? '')),
								Option.map(name => `${name}:${diagnostic.labels[0]?.span.line ?? 0}`),
								Option.getOrElse(() => diagnostic.filename ?? '')
							)
						),
						Array.sort(String.Order)
					),
					pipe(
						Record.keys(inputs),
						Array.flatMap((name, index) =>
							pipe(
								String.split(result.sources[index] ?? '', '\n'),
								Array.map((line, lineIndex) => ({line, number: lineIndex + 1})),
								Array.filter(entry => String.includes('// reported')(entry.line)),
								Array.map(entry => `${name}:${entry.number}`)
							)
						),
						Array.sort(String.Order)
					)
				)
			})
		)

		testApi.effect(
			'keeps package APIs, global classes and Effect services out of native method calls',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'receivers.ts': Array.join(
						[
							"import {Array, Context, Effect} from 'effect'",
							"import {z} from 'zod'",
							'',
							'declare const path: {posix: {join: (...parts: string[]) => string}; join: (...parts: string[]) => string}',
							'class Groups extends Context.Service<Groups, {replace: (id: string) => Effect.Effect<void>}>()("Groups") {}',
							'export const joined = path.posix.join("a", "b")',
							'export const bytes = Buffer.concat([])',
							'export const trimmed = z.string().trim()',
							'export const replaced = Effect.gen(function* () { const groups = yield* Groups; return yield* groups.replace("a") })',
							'export const listed = Array.map(["a"], value => value).join(",")',
							'export const first = path.join("a").at(0)',
							'export const keys = Object.keys({a: 1})',
							'declare const pending: Effect.Effect<string[]>',
							'export const mapped = Effect.gen(function* () { const values = yield* pending; return values.map(value => value) })'
						],
						'\n'
					)
				})
				assert.deepStrictEqual(
					pipe(
						result.stdout.diagnostics,
						Array.filter(diagnostic => diagnostic.code === '@deslop/coding-standards(no-native-method-call)'),
						Array.map(diagnostic => diagnostic.labels[0]?.span.line)
					),
					// String, mapped array and record methods belong to the Effect compiler's preferEffectString, preferEffectArray and preferEffectRecord.
					[]
				)
			})
		)

		testApi.effect(
			'partitions proven string receivers from residual native array methods',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource({
					'strings.ts': Array.join(
						[
							'declare const text: string',
							'declare const items: string[]',
							'declare const mixed: string | string[]',
							'export const stringSlice = text.slice(1)',
							'export const stringAt = text.at(0)',
							'export const literal = "abc".slice(1)',
							'export const template = `abc`.at(0)',
							'const word = "abc"',
							'export const alias = word.slice(1)',
							'export const arraySlice = items.slice(1) // reported',
							'export const arrayAt = items.at(0) // reported',
							'export const arrayLiteral = ["abc"].slice(1) // reported',
							'export const union = mixed.slice(1) // reported'
						],
						'\n'
					)
				})
				const lines = reportedLines(result, 'no-native-method-call')
				assert.deepStrictEqual(lines.reported, lines.marked)
			})
		)

		testApi.effect(
			'passes generators to Effect.fnUntraced where a callback returns Effect.gen and its parameters keep their types',
			Effect.fnUntraced(function* () {
				const result = yield* lintSource(
					{
						'callbacks.ts': Array.join(
							[
								"import {Array, Effect} from 'effect'",
								'',
								'declare function run<A>(make: (id: string) => Effect.Effect<A>): Effect.Effect<A>',
								'export const thunk = Effect.suspend(() => Effect.gen(function* () { return 1 }))',
								'export const typed = run((id: string) => Effect.gen(function* () { return id }))',
								'export const block = run(function (id: string) { return Effect.gen(function* () { return id }) })',
								'export const contextual = run(id => Effect.gen(function* () { return id }))',
								'export const named = (id: string) => Effect.gen(function* () { return id })',
								'export const property = {load: (id: string) => Effect.gen(function* () { return id })}',
								'export const piped = run((id: string) => Effect.map(Effect.gen(function* () { return id }), Array.of))',
								'export const counted = run((id: string) => Effect.gen(function* () { return `${id}${arguments.length}` }))'
							],
							'\n'
						)
					},
					['--fix']
				)
				assert.deepStrictEqual(result.sources, [
					Array.join(
						[
							"import {Array, Effect} from 'effect'",
							'',
							'declare function run<A>(make: (id: string) => Effect.Effect<A>): Effect.Effect<A>',
							'export const thunk = Effect.suspend(',
							'\tEffect.fnUntraced(function* () {',
							'\t\treturn 1',
							'\t})',
							')',
							'export const typed = run(',
							'\tEffect.fnUntraced(function* (id: string) {',
							'\t\treturn id',
							'\t})',
							')',
							'export const block = run(',
							'\tEffect.fnUntraced(function* (id: string) {',
							'\t\treturn id',
							'\t})',
							')',
							'export const contextual = run(id =>',
							'\tEffect.gen(function* () {',
							'\t\treturn id',
							'\t})',
							')',
							'export const named = (id: string) =>',
							'\tEffect.gen(function* () {',
							'\t\treturn id',
							'\t})',
							'export const property = {',
							'\tload: (id: string) =>',
							'\t\tEffect.gen(function* () {',
							'\t\t\treturn id',
							'\t\t})',
							'}',
							'export const piped = run((id: string) =>',
							'\tEffect.map(',
							'\t\tEffect.gen(function* () {',
							'\t\t\treturn id',
							'\t\t}),',
							'\t\tArray.of',
							'\t)',
							')',
							'export const counted = run((id: string) =>',
							'\tEffect.gen(function* () {',
							'\t\treturn `${id}${arguments.length}`',
							'\t})',
							')',
							''
						],
						'\n'
					)
				])
			})
		)
	})
})
