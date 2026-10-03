import {NodeServices} from '@effect/platform-node'
import {assert, describe, it} from '@effect/vitest'

import {Array, Effect, FileSystem, Path, Record, Schema, Stream, String, pipe} from 'effect'

import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import plugin from '@deslop/coding-standards'

type OxlintOutput = typeof OxlintOutput.Type
const OxlintOutput = Schema.Struct({
	diagnostics: Schema.Array(
		Schema.Struct({
			code: Schema.String,
			labels: Schema.Array(Schema.Struct({span: Schema.Struct({line: Schema.Finite})}))
		})
	)
})

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
		Array.map(rule => `@deslop/coding-standards(${rule})`)
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
								'@deslop/coding-standards(no-array-wrap-ternary)',
								'@deslop/coding-standards(no-array-wrap-ternary)',
								'@deslop/coding-standards(no-constant-function)',
								'@deslop/coding-standards(no-deep-pipe)',
								'@deslop/coding-standards(no-effect-property-arrow)',
								'@deslop/coding-standards(no-effect-property-arrow)',
								'@deslop/coding-standards(no-double-nullish-check)',
								'@deslop/coding-standards(no-double-nullish-check)',
								'@deslop/coding-standards(no-fail-in-generator)',
								'@deslop/coding-standards(no-fake-ref-state)',
								'@deslop/coding-standards(no-fake-ref-state)',
								'@deslop/coding-standards(no-hand-written-guard)',
								'@deslop/coding-standards(no-hand-written-guard)',
								'@deslop/coding-standards(no-let)',
								'@deslop/coding-standards(no-native-emptiness-check)',
								'@deslop/coding-standards(no-native-emptiness-check)',
								'@deslop/coding-standards(no-native-method-call)',
								'@deslop/coding-standards(no-option-value-access)',
								'@deslop/coding-standards(no-option-value-access)',
								'@deslop/coding-standards(no-readonly-type-syntax)',
								'@deslop/coding-standards(no-readonly-type-syntax)',
								'@deslop/coding-standards(no-readonly-type-syntax)',
								'@deslop/coding-standards(no-readonly-type-syntax)',
								'@deslop/coding-standards(no-readonly-type-syntax)',
								'@deslop/coding-standards(no-readonly-type-syntax)',
								'@deslop/coding-standards(no-readonly-type-syntax)',
								'@deslop/coding-standards(no-redundant-return-type)',
								'@deslop/coding-standards(no-redundant-return-type)',
								'@deslop/coding-standards(no-redundant-return-type)',
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
								'@deslop/coding-standards(no-switch-statement)',
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
								'@deslop/coding-standards(no-typeof)',
								'@deslop/coding-standards(no-typeof)',
								'@deslop/coding-standards(no-undestructured-use-state)',
								'@deslop/coding-standards(no-undestructured-use-state)',
								'@deslop/coding-standards(no-unexplained-disable)',
								'@deslop/coding-standards(no-unexplained-disable)',
								'@deslop/coding-standards(no-unexplained-disable)',
								'@deslop/coding-standards(no-unvalidated-json-decode)',
								'@deslop/coding-standards(no-unvalidated-json-decode)',
								'@deslop/coding-standards(schema-type-pair)',
								'@deslop/coding-standards(schema-type-pair)',
								'@deslop/coding-standards(schema-type-pair)',
								'@deslop/coding-standards(schema-type-pair)',
								'@deslop/coding-standards(schema-type-pair)',
								'@deslop/coding-standards(schema-type-pair)',
								'@deslop/coding-standards(schema-type-pair)'
							],
							Array.sort(String.Order)
						)
					)
					assert.strictEqual(result.stderr, '')
				}),
			20_000
		)

		testApi.effect(
			'allows valid schemas and semantic owners',
			() =>
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
			20_000
		)

		testApi.effect(
			'reports runtime typeof and error wording assertions',
			() =>
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
								'@deslop/coding-standards(no-error-message-assertion)',
								'@deslop/coding-standards(no-error-message-assertion)',
								'@deslop/coding-standards(no-error-message-assertion)',
								'@deslop/coding-standards(no-error-message-assertion)',
								'@deslop/coding-standards(no-typeof)',
								'@deslop/coding-standards(no-typeof)'
							],
							Array.sort(String.Order)
						)
					)
				}),
			20_000
		)

		testApi.effect(
			'leaves rewrites that would change behavior alone',
			() =>
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
			20_000
		)

		testApi.effect(
			'follows cycles, alias chains, and destructured parameters',
			() =>
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
						'@deslop/coding-standards(no-destructured-parameter)',
						'@deslop/coding-standards(no-destructured-parameter)',
						'@deslop/coding-standards(no-destructured-parameter)',
						'@deslop/coding-standards(no-readonly-type-syntax)',
						'@deslop/coding-standards(no-readonly-type-syntax)'
					])
				}),
			20_000
		)

		testApi.effect(
			'uses import bindings instead of matching shadowed names',
			() =>
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
			20_000
		)

		testApi.effect(
			'reports redundant primitive state types while retaining intentional widening',
			() =>
				Effect.gen(function* () {
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
					const invalid = yield* lintSource({name: 'state-invalid.ts', source: Array.join(invalidSource, '\n')})
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
						name: 'state-valid.ts',
						source: pipe(
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
							Array.join('\n')
						)
					})
					assert.deepStrictEqual(customCodes(valid.stdout), [])
					assert.strictEqual(valid.exitCode, ChildProcessSpawner.ExitCode(0))
					assert.strictEqual(valid.stderr, '')
				}),
			20_000
		)
	})
})
