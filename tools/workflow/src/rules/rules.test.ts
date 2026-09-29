import {NodeServices} from '@effect/platform-node'
import {assert, describe, it} from '@effect/vitest'

import {Array, Effect, FileSystem, Path, Record, Schema, Stream, String, pipe} from 'effect'

import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import plugin from '@deslop/workflow'

type OxlintOutput = typeof OxlintOutput.Type
const OxlintOutput = Schema.Struct({diagnostics: Schema.Array(Schema.Struct({code: Schema.String}))})

const lintSource = Effect.fnUntraced(function* (input: {name: string; source: string}) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const directory = yield* fs.makeTempDirectoryScoped({directory: import.meta.dirname, prefix: 'fixture-'})
	const file = path.join(directory, input.name)
	yield* fs.writeFileString(file, String.replace(/^((?:import[^\n]*\n)+)(?!\n)/u, '$1\n')(input.source))

	const handle = yield* ChildProcess.make('vp', ['lint', file, '--format=json'], {
		cwd: path.resolve(import.meta.dirname, '../../../..'),
		stderr: 'pipe',
		stdout: 'pipe'
	})
	const result = yield* Effect.all(
		{
			exitCode: handle.exitCode,
			stderr: Stream.mkString(Stream.decodeText(handle.stderr)),
			stdout: Stream.mkString(Stream.decodeText(handle.stdout))
		},
		{concurrency: 'unbounded'}
	)
	return {
		exitCode: result.exitCode,
		stderr: result.stderr,
		stdout: yield* Schema.decodeEffect(Schema.fromJsonString(OxlintOutput))(result.stdout)
	}
})

function customCodes(output: OxlintOutput) {
	const codes = pipe(
		Record.keys(plugin.rules),
		Array.map(rule => `@deslop/workflow(${rule})`)
	)
	return pipe(
		output.diagnostics,
		Array.map(diagnostic => diagnostic.code),
		Array.filter(code => Array.contains(codes, code)),
		Array.sort(String.Order)
	)
}

describe('deslop Oxlint plugin', {concurrent: false}, () => {
	it.layer(NodeServices.layer)(testApi => {
		testApi.effect(
			'reports every project-specific invalid state',
			() =>
				pipe(
					Effect.gen(function* () {
						const result = yield* lintSource({
							name: 'invalid.tsx',
							source: pipe(
								[
									"import {Array, Context, Effect, Layer, Option as Maybe, Schema, SchemaGetter, SchemaTransformation, identity, pipe} from 'effect'",
									"import * as React from 'react'",
									"import {useRef, useState} from 'react'",
									'',
									'declare const input: unknown',
									'declare const source: string',
									'declare const values: string[]',
									'const mappedValues = values.map(value => value.length)',
									'const deepPipe = pipe(values, Array.appendAll(pipe(values, Array.appendAll(pipe(values, Array.appendAll(pipe(values, Array.take(1))))))))',
									'const decode =Schema.decodeUnknownSync(Schema.String)',
									'const operations = {decode: Schema.decodeUnknownSync(Schema.String)}',
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
									'type Explicit = {readonly values: readonly string[]}',
									'type Mapped<T> = {readonly [K in keyof T]: T[K]}',
									'type Frozen = Readonly<{value: string}>',
									'type Index = {readonly [key: string]: string}',
									'class Input { readonly field = "value"; constructor(readonly value: string) {} }',
									'class Clock extends Context.Service<Clock, {now: Effect.Effect<number>; tick(): Effect.Effect<void>}>()("Clock") {}',
									'const makeClock = Effect.gen(function* () { return {now: Effect.succeed(1), tick: () => Effect.void} })',
									'declare const ClockLive: {layer: Layer.Layer<Clock>}',
									'const clockService = ClockLive.layer',
									'const clockLayers = Layer.mergeAll(Layer.effect(Clock, makeClock), clockService)',
									'const ref = useRef<HTMLElement | null>(null)',
									'const namespaceRef = React.useRef<HTMLElement | null>(null)',
									'const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(source)',
									'const directDecoded = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(source)',
									'function forward(value: string) { return consume(value) }',
									'function ready() { return source.length > 0 }',
									'const noValues = values.length === 0',
									'function run() { consume(source) }',
									'function consume(value: string) { return value.length }',
									'function sourceLength(value: {text: string}) { return consume(value.text) }',
									'const measured = sourceLength({text: source})',
									'const callbacks = {consume: (value: string) => consume(value)}',
									'const alias = source',
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
									'const empties: string[] = []',
									'class Missing extends Schema.TaggedError<Missing>()("Missing", {}) {}',
									'const failing = Effect.gen(function* () { yield* Effect.void; return yield* Effect.fail(new Missing()) })',
									'const failingFn = Effect.fn("failing")(function* (id: string) { yield* Effect.logInfo(id); return yield* Effect.fail(Missing.make({})) })',
									'// oxlint-disable-next-line eqeqeq',
									'const loose = source == "ready"',
									'// oxlint-disable-next-line sort-keys -- the fixture keeps its order',
									'const unsortedKeys = {b: 1, a: 2}',
									'// @effect-diagnostics-next-line floatingEffect:off',
									'export {AssertString, Clock, clockLayers, Codecs, NonEmpty, PipedNonEmpty, PipedTrimmed, absent, Fallback, Input, IsString, Maybe, MissingDecode, MissingEncode, MissingFluent, MissingTransform, MissingType, Tree, alias, assigned, asyncConstant, callbacks, decode, decoded, decoders, deepPipe, directDecoded, empties, failing, failingFn, fake, fakeNamespace, fallbacks, forward, greet, handlers, input, isRecord, isText, makeBox, labelled, logName, loose, kind, mappedValues, measured, namesA, namesB, namespaceRef, noValues, present, slotLength, notFound, operations, ready, recipients, ref, run, stateNamespace, unsortedKeys, unwrapped, wrapped}',
									'export type {Explicit, Frozen, Index, Mapped}'
								],
								Array.join('\n')
							)
						})
						assert.strictEqual(result.exitCode, ChildProcessSpawner.ExitCode(1))
						assert.deepStrictEqual(
							customCodes(result.stdout),
							pipe(
								[
									'@deslop/workflow(no-array-wrap-ternary)',
									'@deslop/workflow(no-array-wrap-ternary)',
									'@deslop/workflow(no-constant-function)',
									'@deslop/workflow(no-deep-pipe)',
									'@deslop/workflow(no-effect-property-arrow)',
									'@deslop/workflow(no-effect-property-arrow)',
									'@deslop/workflow(no-double-nullish-check)',
									'@deslop/workflow(no-double-nullish-check)',
									'@deslop/workflow(no-fail-in-generator)',
									'@deslop/workflow(no-fake-ref-state)',
									'@deslop/workflow(no-fake-ref-state)',
									'@deslop/workflow(no-hand-written-guard)',
									'@deslop/workflow(no-hand-written-guard)',
									'@deslop/workflow(no-let)',
									'@deslop/workflow(no-native-emptiness-check)',
									'@deslop/workflow(no-native-emptiness-check)',
									'@deslop/workflow(no-native-method-call)',
									'@deslop/workflow(no-option-value-access)',
									'@deslop/workflow(no-option-value-access)',
									'@deslop/workflow(no-readonly-type-syntax)',
									'@deslop/workflow(no-readonly-type-syntax)',
									'@deslop/workflow(no-readonly-type-syntax)',
									'@deslop/workflow(no-readonly-type-syntax)',
									'@deslop/workflow(no-readonly-type-syntax)',
									'@deslop/workflow(no-readonly-type-syntax)',
									'@deslop/workflow(no-readonly-type-syntax)',
									'@deslop/workflow(no-redundant-return-type)',
									'@deslop/workflow(no-redundant-return-type)',
									'@deslop/workflow(no-redundant-return-type)',
									'@deslop/workflow(no-redundant-use-ref-null-type)',
									'@deslop/workflow(no-redundant-use-ref-null-type)',
									'@deslop/workflow(no-redundant-variable-annotation)',
									'@deslop/workflow(no-reinvented-schema)',
									'@deslop/workflow(no-reinvented-schema)',
									'@deslop/workflow(no-reinvented-schema)',
									'@deslop/workflow(no-renamed-import)',
									'@deslop/workflow(no-stored-schema-operation)',
									'@deslop/workflow(no-stored-schema-operation)',
									'@deslop/workflow(no-stored-schema-operation)',
									'@deslop/workflow(no-stored-schema-operation)',
									'@deslop/workflow(no-stored-schema-operation)',
									'@deslop/workflow(no-stored-schema-operation)',
									'@deslop/workflow(no-stored-schema-operation)',
									'@deslop/workflow(no-switch-statement)',
									'@deslop/workflow(no-trivial-indirection)',
									'@deslop/workflow(no-trivial-indirection)',
									'@deslop/workflow(no-trivial-indirection)',
									'@deslop/workflow(no-trivial-indirection)',
									'@deslop/workflow(no-trivial-indirection)',
									'@deslop/workflow(no-trivial-indirection)',
									'@deslop/workflow(no-trivial-indirection)',
									'@deslop/workflow(no-trivial-indirection)',
									'@deslop/workflow(no-trivial-indirection)',
									'@deslop/workflow(no-trivial-indirection)',
									'@deslop/workflow(no-trivial-indirection)',
									'@deslop/workflow(no-trivial-indirection)',
									'@deslop/workflow(no-typeof)',
									'@deslop/workflow(no-typeof)',
									'@deslop/workflow(no-undestructured-use-state)',
									'@deslop/workflow(no-undestructured-use-state)',
									'@deslop/workflow(no-unexplained-disable)',
									'@deslop/workflow(no-unexplained-disable)',
									'@deslop/workflow(no-unexplained-disable)',
									'@deslop/workflow(no-unvalidated-json-decode)',
									'@deslop/workflow(no-unvalidated-json-decode)',
									'@deslop/workflow(schema-type-pair)',
									'@deslop/workflow(schema-type-pair)',
									'@deslop/workflow(schema-type-pair)',
									'@deslop/workflow(schema-type-pair)',
									'@deslop/workflow(schema-type-pair)',
									'@deslop/workflow(schema-type-pair)',
									'@deslop/workflow(schema-type-pair)'
								],
								Array.sort(String.Order)
							)
						)
						assert.strictEqual(result.stderr, '')
					}),
					Effect.scoped
				),
			20_000
		)

		testApi.effect(
			'allows valid schemas and semantic owners',
			() =>
				pipe(
					Effect.gen(function* () {
						const result = yield* lintSource({
							name: 'valid.tsx',
							source: pipe(
								[
									"import {it as test} from '@effect/vitest'",
									"import {Array, Context, Effect, Layer, Result, Schema, SchemaGetter, SchemaTransformation, identity, pipe} from 'effect'",
									"import * as EffectArray from 'effect/Array'",
									'',
									'declare const input: unknown',
									'declare const names: string[]',
									'const namespaced = EffectArray.map([input], identity)',
									'const singleName = names.length === 1',
									'declare const layer: Layer.Layer<never>',
									'declare const outcome: Result.Result<number, string>',
									'const mappedOutcome = Result.map(outcome, value => value + 1)',
									'const layers = pipe(layer, Layer.provide(pipe(layer, Layer.provide(pipe(layer, Layer.provide(layer))))))',
									'declare function combine(left: string, right: string): string',
									'declare const snapshot: {width: number}',
									'type LedgerShape = {readonly add: (value: number) => Effect.Effect<number>}',
									'// oxlint-disable-next-line effecttsgo/deterministic-keys -- a fixture in a temporary directory has no stable key',
									'class Ledger extends Context.Service<Ledger, LedgerShape>()("Ledger") {}',
									'type User = typeof User.Type',
									'const User = Schema.Struct({name: Schema.String})',
									'type Annotated = typeof Annotated.Type',
									'const Annotated = Schema.String.annotate({description: "value"})',
									'export type Public = typeof Public.Type',
									'const Public = Schema.Struct({name: Schema.String})',
									'type CodeStep = typeof CodeStep.Type',
									'const CodeStep = Schema.Struct({code: Schema.String, kind: Schema.Literal("code")})',
									'type CallStep = {readonly do: readonly Step[]; readonly kind: "call"}',
									'const CallStep = Schema.Struct({do: Schema.Array(Schema.suspend((): Schema.Codec<Step> => Step)), kind: Schema.Literal("call")})',
									'type Step = CallStep | CodeStep',
									'const Step = Schema.Union([CallStep, CodeStep])',
									'type LinearIssue = typeof LinearIssue.Type',
									'const LinearIssue = Schema.Struct({id: Schema.String})',
									'type Exported = typeof Exported.Type',
									'export const Exported = Schema.Struct({name: Schema.String})',
									'type Normalized = typeof Normalized.Type',
									'const Normalized = pipe(Schema.Struct({value: Schema.String}), Schema.decodeTo(Schema.Struct({value: Schema.String}), SchemaTransformation.transform({decode: identity, encode: identity})))',
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
									'const lengths = Array.isArray(input) ? input.length : 0',
									'const ensured = Array.ensure(input)',
									'const constants = Array.map([input], () => input)',
									'function identify(value: {id: string}) { return value.id }',
									'function circle() { return Math.PI }',
									'const circles = Array.map([input], circle)',
									'function readSnapshot() { return snapshot.width }',
									'const snapshots = Array.map([input], readSnapshot)',
									'const DefaultInput = Schema.JsonObject.make({schema: {type: "object"}})',
									'function isCall(node: {type: string}): node is {type: "CallExpression"} { return node.type === "CallExpression" }',
									'const limit = 2',
									'const limits = [limit, limit]',
									'const version = "1"',
									'const versionPattern = /^v/u',
									'const versionPatterns = [versionPattern]',
									'const thunks = {size: () => pipe(names, Array.map(identity))}',
									'const measure = Effect.fn("measure")(function* (value: string) { return yield* Effect.succeed(value.length) }, Effect.map(length => length + 1))',
									'const payload: unknown = names',
									'const counts: Record<string, number> = {}',
									'const flags: Partial<Record<"a" | "b", boolean>> = {}',
									'const labels: {[Key in "a" | "b"]?: Key} = {}',
									'type Profile = {nickname?: string}',
									'const nickname: Profile["nickname"] = undefined',
									'const noUser: User | null = null',
									'const annotatedName: string = names[0] ?? ""',
									'function label(flag: boolean): string { return flag ? "on" : "off" }',
									'declare class Missing { _tag: "Missing" }',
									'const missing = Effect.fail(new Missing())',
									'const nestedFailure = Effect.fn("nestedFailure")(function* (id: string) { return yield* pipe(Effect.succeed(id), Effect.flatMap(() => Effect.fail(new Missing()))) })',
									'// oxlint-disable-next-line eqeqeq -- the fixture keeps a reasoned disable',
									'const loose = snapshot.width == 1',
									'declare const db: {insert: (table: string) => {values: (row: {id: number}) => void}}',
									'db.insert("user").values({id: 1})',
									'const hasWindow = typeof window !== "undefined"',
									'function unavailable() { return Effect.die("unused") }',
									'const stubs = {load: unavailable, save: unavailable}',
									'export {Annotated, CallStep, hasWindow, stubs, CodeStep, Decoded, DefaultInput, Encoded, Formatter, Ledger, LinearIssue, Normalized, Step, circle, circles, constants, counts, decoded, decodedMany, encoded, ensured, flags, identify, isCall, isUser, labels, layers, lengths, limits, loose, mappedOutcome, measure, missing, namespaced, nestedFailure, annotatedName, label, nickname, noUser, payload, readSnapshot, singleName, snapshots, swap, test, thunks, transform, tuple, version, versionPatterns, withDefault}'
								],
								Array.join('\n')
							)
						})
						assert.deepStrictEqual(customCodes(result.stdout), [])
						assert.strictEqual(result.stderr, '')
						assert.strictEqual(result.exitCode, ChildProcessSpawner.ExitCode(0))
					}),
					Effect.scoped
				),
			20_000
		)

		testApi.effect(
			'reports runtime typeof and error wording assertions',
			() =>
				pipe(
					Effect.gen(function* () {
						const result = yield* lintSource({
							name: 'assertions.ts',
							source: pipe(
								[
									"import {Predicate} from 'effect'",
									'',
									'declare const properties: unknown',
									'declare const value: unknown',
									'declare const failure: {message: string}',
									'declare const assert: {strictEqual: (actual: unknown, expected: unknown) => void}',
									'declare function expect(value: unknown): {not: {toContain: (expected: string) => void}; toBe: (expected: unknown) => void; toThrow: (expected?: string) => void}',
									"const isText = typeof value === 'string'",
									"if (typeof properties === 'object') Predicate.isNotNull(properties)",
									"expect(() => Predicate.isNotNull(value)).toThrow('negative')",
									"expect(failure.message).toBe('negative')",
									"expect(failure.message).not.toContain('negative')",
									"assert.strictEqual(failure.message, 'negative')",
									'expect(() => Predicate.isNotNull(value)).toThrow()',
									'export {isText}'
								],
								Array.join('\n')
							)
						})
						assert.deepStrictEqual(
							customCodes(result.stdout),
							pipe(
								[
									'@deslop/workflow(no-error-message-assertion)',
									'@deslop/workflow(no-error-message-assertion)',
									'@deslop/workflow(no-error-message-assertion)',
									'@deslop/workflow(no-error-message-assertion)',
									'@deslop/workflow(no-typeof)',
									'@deslop/workflow(no-typeof)'
								],
								Array.sort(String.Order)
							)
						)
					}),
					Effect.scoped
				),
			20_000
		)

		testApi.effect(
			'leaves rewrites that would change behavior alone',
			() =>
				pipe(
					Effect.gen(function* () {
						const result = yield* lintSource({
							name: 'behavior.test.ts',
							source: pipe(
								[
									"import {assert, it} from '@effect/vitest'",
									"import {Array, Effect, MutableRef, pipe} from 'effect'",
									'',
									'declare const ticket: {message: string}',
									'function cell() { return MutableRef.make(0) }',
									'const cells = [cell(), cell()]',
									'const operations = {normalize: (items: string[]) => pipe(items, Array.reverse)}',
									'const recovered = Effect.gen(function* () { return yield* Effect.catch(Effect.fail("missing"), () => Effect.succeed(1)) })',
									'function Field({ref, ...props}: {ref?: unknown; label: string}) { return [ref, props.label] }',
									'it("keeps the trimmed message", () => { assert.strictEqual(ticket.message, "hello") })',
									'export {Field, cells, operations, recovered}'
								],
								Array.join('\n')
							)
						})
						assert.deepStrictEqual(customCodes(result.stdout), [])
					}),
					Effect.scoped
				),
			20_000
		)

		testApi.effect(
			'follows cycles, alias chains, and destructured parameters',
			() =>
				pipe(
					Effect.gen(function* () {
						const result = yield* lintSource({
							name: 'cycles.ts',
							source: pipe(
								[
									"import {Array, Context, Effect, Schema} from 'effect'",
									'',
									'type Tree = {readonly children: readonly Tree[]}',
									'const Tree = Schema.Struct({Wrapper: Schema.String, children: Schema.Array(Schema.suspend((): Schema.Codec<Tree> => Tree))})',
									'type Wrapper = {readonly tree: Tree}',
									'const sizes = Array.map([[1, 2]], ([width]) => width)',
									'for (const {length} of ["a"]) consume(length)',
									'const labelOf = ({ref, label}: {ref: string; label: string}) => [ref, label]',
									'declare function consume(value: number): void',
									'type BaseShape = {count: Effect.Effect<number>}',
									'type ServiceShape = BaseShape',
									'// oxlint-disable-next-line effecttsgo/deterministic-keys -- a fixture in a temporary directory has no stable key',
									'class Counter extends Context.Service<Counter, ServiceShape>()("Counter") {}',
									'export {Counter, Tree, labelOf, sizes}',
									'export type {Wrapper}'
								],
								Array.join('\n')
							)
						})
						assert.deepStrictEqual(customCodes(result.stdout), [
							'@deslop/workflow(no-destructured-parameter)',
							'@deslop/workflow(no-destructured-parameter)',
							'@deslop/workflow(no-destructured-parameter)',
							'@deslop/workflow(no-readonly-type-syntax)',
							'@deslop/workflow(no-readonly-type-syntax)'
						])
					}),
					Effect.scoped
				),
			20_000
		)

		testApi.effect(
			'uses import bindings instead of matching shadowed names',
			() =>
				pipe(
					Effect.gen(function* () {
						const result = yield* lintSource({
							name: 'bindings.ts',
							source: pipe(
								[
									'function compile(Schema: {decode: (value: string) => string}) {',
									'  return Schema.decode("ok")',
									'}',
									'function useRef<T>() { return undefined as T | undefined }',
									'const ref = useRef<string | null>()',
									'function pipe(value: string, suffix: string) { return value + suffix }',
									'const handlers = {size: (value: string) => pipe(value, "!")}',
									'export {compile, handlers, ref}'
								],
								Array.join('\n')
							)
						})
						assert.deepStrictEqual(customCodes(result.stdout), [])
					}),
					Effect.scoped
				),
			20_000
		)
	})
})
