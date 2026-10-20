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

const lintSource = Effect.fnUntraced(function* (input: Record<string, string>, flags: string[] = []) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const fixtures = path.resolve(import.meta.dirname, '../../.fixtures')
	yield* fs.makeDirectory(fixtures, {recursive: true})
	const directory = yield* fs.makeTempDirectoryScoped({directory: fixtures, prefix: 'fixture-'})
	yield* Effect.forEach(
		Record.toEntries(input),
		entry =>
			fs.writeFileString(
				path.join(directory, entry[0]),
				String.replace(/^((?:import[^\n]*\n)+)(?!\n)/u, '$1\n')(entry[1])
			),
		{concurrency: 'unbounded'}
	)
	const files = Array.map(Record.keys(input), name => path.join(directory, name))
	const root = path.resolve(import.meta.dirname, '../../../..')
	const handle = yield* ChildProcess.make('vp', ['lint', ...files, '--format=json', ...flags], {
		cwd: root,
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
	// The repository's fix command formats after the lint fixes, so a fixed source is compared as the formatter leaves it.
	if (Array.contains(flags, '--fix')) {
		yield* Effect.flatMap(ChildProcess.make('vp', ['fmt', ...files], {cwd: root}), formatter => formatter.exitCode)
	}
	return {
		exitCode: result.exitCode,
		sources: yield* Effect.forEach(files, file => fs.readFileString(file), {concurrency: 'unbounded'}),
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

describe('deslop Oxlint plugin', {concurrent: true}, () => {
	it.layer(NodeServices.layer)(testApi => {
		testApi.effect(
			'reports every project-specific invalid state',
			() =>
				Effect.gen(function* () {
					const result = yield* lintSource({
						'invalid.tsx': pipe(
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
								'export type Public = typeof Public.Type',
								'const Public = Schema.Struct({name: Schema.String})',
								'type Private = typeof Private.Type',
								'export const Private = Schema.Struct({name: Schema.String})',
								'type InlineType = typeof InlineType.Type',
								'const InlineType = Schema.Struct({name: Schema.String})',
								'export {type InlineType}',
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
								'// oxlint-disable-next-line eqeqeq',
								'const loose = source == "ready"',
								'// oxlint-disable-next-line sort-keys -- the fixture keeps its order',
								'const unsortedKeys = {b: 1, a: 2}',
								'// @effect-diagnostics-next-line floatingEffect:off',
								'export {AssertString, Clock, clockLayers, Codecs, NonEmpty, PipedNonEmpty, PipedTrimmed, absent, Fallback, Input, IsString, Maybe, MissingDecode, MissingEncode, MissingFluent, MissingTransform, MissingType, Tree, alias, assigned, asyncConstant, callbacks, decode, decoded, decoders, deepPipe, directDecoded, empties, failing, failingFn, fake, fakeNamespace, fallbacks, forward, greet, handlers, input, isRecord, isText, makeBox, labelled, logName, loose, kind, mappedValues, measured, keyed, lazy, described, namesA, namesB, namespaceRef, noValues, present, slotLength, slotPair, notFound, operations, ready, recipients, ref, run, stateNamespace, succeed, unsortedKeys, unwrapped, withHead, wrapped}',
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
								'@deslop/coding-standards(module-constant)',
								'@deslop/coding-standards(no-constant-function)',
								'@deslop/coding-standards(no-deep-pipe)',
								'@deslop/coding-standards(no-effect-property-arrow)',
								'@deslop/coding-standards(no-effect-property-arrow)',
								'@deslop/coding-standards(no-double-nullish-check)',
								'@deslop/coding-standards(no-double-nullish-check)',
								'@deslop/coding-standards(no-fake-ref-state)',
								'@deslop/coding-standards(no-fake-ref-state)',
								'@deslop/coding-standards(no-hand-written-guard)',
								'@deslop/coding-standards(no-hand-written-guard)',
								'@deslop/coding-standards(no-let)',
								'@deslop/coding-standards(no-multiline-comment)',
								'@deslop/coding-standards(no-multiline-comment)',
								'@deslop/coding-standards(no-native-emptiness-check)',
								'@deslop/coding-standards(no-native-emptiness-check)',
								'@deslop/coding-standards(no-option-value-access)',
								'@deslop/coding-standards(no-option-value-access)',
								'@deslop/coding-standards(no-readonly-type-syntax)',
								'@deslop/coding-standards(no-readonly-type-syntax)',
								'@deslop/coding-standards(no-readonly-type-syntax)',
								'@deslop/coding-standards(no-readonly-type-syntax)',
								'@deslop/coding-standards(no-readonly-type-syntax)',
								'@deslop/coding-standards(no-readonly-type-syntax)',
								'@deslop/coding-standards(no-readonly-type-syntax)',
								'@deslop/coding-standards(no-return-type)',
								'@deslop/coding-standards(no-return-type)',
								'@deslop/coding-standards(no-return-type)',
								'@deslop/coding-standards(no-return-type)',
								'@deslop/coding-standards(no-return-type)',
								'@deslop/coding-standards(no-return-type)',
								'@deslop/coding-standards(no-in-operator)',
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
								'@deslop/coding-standards(no-trivial-indirection)',
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
						'valid.tsx': pipe(
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
								'const layers = pipe(layer, Layer.provide(pipe(layer, Layer.provide(pipe(layer, Layer.provide(layer))))))',
								'declare function combine(left: string, right: string): string',
								'declare const snapshot: {width: number}',
								'declare namespace Ledger { export type Base = {readonly add: (value: number) => Effect.Effect<number>}; export type Shape = Base & {readonly count: Effect.Effect<number>} }',
								'// oxlint-disable-next-line effecttsgo/deterministic-keys -- a fixture in a temporary directory has no stable key',
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
								'declare function currentPhase(): "idle" | "ready"',
								'export const status: string = currentPhase()',
								'export function transition(value: typeof status) { return value.length }',
								'export const transitioned = transition("done")',
								'export function useCounter() { const [state, setState] = useState(() => ({current: 0, previous: 0})); return {increment: () => { setState(value => ({current: value.current + 1, previous: value.current})) }, state} }',
								'function depth(value: number): number { if (value <= 0) return 0; return depth(value - 1) + 1 }',
								'function even(value: number): boolean { if (value === 0) return true; return odd(value - 1) }',
								'function odd(value: number): boolean { if (value === 0) return false; return even(value - 1) }',
								'const countdown = Effect.fnUntraced(function* (value: number): Effect.fn.Return<number> { if (value <= 0) return 0; return yield* countdown(value - 1) })',
								'function first(value: number): number { if (value <= 0) return 0; return second(value - 1) }',
								'function second(value: number): number { return third(value) + 1 }',
								'function third(value: number): number { return first(value) * 2 }',
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
								'// oxlint-disable-next-line typescript/no-restricted-types -- the fixture forwards to a Promise API',
								'declare function fetchName(id: string): Promise<string>',
								'async function loadName(id: string) { return fetchName(id) }',
								'function* echo(value: string) { return transform(value) }',
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
								'function HomeLayout() { return <div /> }',
								'const route = {component: HomeLayout}',
								'export {Annotated, CallStep, hasWindow, route, stubs, CodeStep, Decoded, DefaultInput, Encoded, Formatter, Ledger, LinearIssue, Listed, Normalized, Step, circle, circles, constants, countdown, counter, counts, curried, annotate, annotateString, decoded, decodedMany, echo, encoded, ensured, flags, depth, first, identify, isCall, isUser, labels, layers, limits, loadName, loose, mappedOutcome, measure, missing, namespaced, nestedFailure, annotatedName, nickname, noUser, payload, odd, parseWith, ping, readSnapshot, singleName, snapshots, swap, test, thunks, Walker, transform, tuple, version, versionPatterns, withDefault}'
							],
							Array.join('\n')
						)
					})
					assert.deepStrictEqual(customCodes(result.stdout), [])
					assert.strictEqual(result.stderr, '')
				}),
			20_000
		)

		testApi.effect(
			'reports runtime typeof and error wording assertions',
			() =>
				Effect.gen(function* () {
					const result = yield* lintSource({
						'assertions.ts': pipe(
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
						'behavior.test.tsx': pipe(
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
								'const operations = {normalize: (items: string[]) => pipe(items, Array.reverse)}',
								'const recovered = Effect.gen(function* () { return yield* Effect.catch(Effect.fail("missing"), () => Effect.succeed(1)) })',
								'function Field({ref, ...props}: {ref?: Ref<HTMLInputElement>; label: string}) { return <input ref={ref} aria-label={props.label} /> }',
								'export const primitiveFailure = Effect.gen(function* () { return yield* Effect.fail("missing") })',
								'it("keeps the trimmed message", () => { assert.strictEqual(ticket.message, "hello") })',
								'export {Field, cells, operations, recovered}'
							],
							Array.join('\n')
						),
						'owner.ts':
							"import {MutableRef} from 'effect'\nexport const owner = {get cell() { return MutableRef.make(0) }, parse(value: string) { return this.prefix + value }, prefix: 'id'}"
					})
					assert.deepStrictEqual(customCodes(result.stdout), [])
				}),
			20_000
		)

		testApi.effect(
			'reports single-use values, property aliases and native regex checks only where the rewrite keeps behavior',
			() =>
				Effect.gen(function* () {
					const result = yield* lintSource({
						'inline.ts': pipe(
							[
								"import {Array, Effect, Predicate, Ref} from 'effect'",
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
								'export const choice = consume(1) > 0 ? "some" : "none"'
							],
							Array.join('\n')
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
						'@deslop/coding-standards(no-trivial-indirection)'
					])
				}),
			20_000
		)

		testApi.effect(
			'reports native controls, discarded failures and React Query outside their owners',
			() =>
				Effect.gen(function* () {
					const result = yield* lintSource({
						'controls.test.ts': pipe(
							[
								"import {Effect} from 'effect'",
								'',
								'declare const load: Effect.Effect<number, string>',
								'export const setup = Effect.orDie(load)'
							],
							Array.join('\n')
						),
						'controls.tsx': pipe(
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
							Array.join('\n')
						)
					})
					assert.deepStrictEqual(customCodes(result.stdout), [
						'@deslop/coding-standards(no-discarded-failure)',
						'@deslop/coding-standards(no-discarded-failure)',
						'@deslop/coding-standards(no-discarded-failure)',
						'@deslop/coding-standards(no-discarded-failure)',
						'@deslop/coding-standards(no-discarded-failure)',
						'@deslop/coding-standards(no-native-control)',
						'@deslop/coding-standards(no-native-control)'
					])
				}),
			20_000
		)

		testApi.effect(
			'keeps labeled tuples and component refs without opening object bypasses',
			() =>
				Effect.gen(function* () {
					const result = yield* lintSource({
						'parameters.tsx': pipe(
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
							Array.join('\n')
						)
					})
					assert.deepStrictEqual(
						pipe(
							result.stdout.diagnostics,
							Array.filter(diagnostic => diagnostic.code === '@deslop/coding-standards(no-destructured-parameter)'),
							Array.map(diagnostic => diagnostic.labels[0]?.span.line)
						),
						[7, 8, 9, 12]
					)
				}),
			20_000
		)

		testApi.effect(
			'follows cycles, alias chains, and destructured parameters',
			() =>
				Effect.gen(function* () {
					const result = yield* lintSource({
						'cycles.ts': pipe(
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
								'type ServiceShape = BaseShape & {increment: Effect.Effect<void>}',
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
						'@deslop/coding-standards(no-readonly-type-syntax)',
						'@deslop/coding-standards(no-readonly-type-syntax)'
					])
				}),
			20_000
		)

		testApi.effect(
			'fixes readonly syntax, single-use values and property aliases without changing behavior',
			() =>
				Effect.gen(function* () {
					const result = yield* lintSource(
						{
							'fixable.ts': pipe(
								[
									"import {Context} from 'effect'",
									"import type {Effect} from 'effect'",
									'declare const text: string',
									'declare function consume(...values: unknown[]): number',
									'export type Explicit = {readonly values: readonly string[]}',
									'export type Mapped<T> = {readonly [K in keyof T]: T[K]}',
									'export type Frozen = Readonly<{value: string}>',
									'// oxlint-disable-next-line effecttsgo/deterministic-keys -- a fixture in a temporary directory has no stable key',
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
									'export type Union = Readonly<string | number>[]',
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
								Array.join('\n')
							)
						},
						['--fix']
					)
					assert.deepStrictEqual(result.sources, [
						pipe(
							[
								"import {Context} from 'effect'",
								"import type {Effect} from 'effect'",
								'',
								'declare const text: string',
								'declare function consume(...values: unknown[]): number',
								'export type Explicit = {values: string[]}',
								'export type Mapped<T> = {[K in keyof T]: T[K]}',
								'export type Frozen = {value: string}',
								'// oxlint-disable-next-line effecttsgo/deterministic-keys -- a fixture in a temporary directory has no stable key',
								"export class Clock extends Context.Service<Clock, {readonly now: Effect.Effect<number>}>()('Clock') {}",
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
								'export type Union = (string | number)[]',
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
								'	return method()',
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
							Array.join('\n')
						)
					])
				}),
			20_000
		)

		testApi.effect(
			'names and places module constants, keeps elements and derived types out of variables, and keeps aliases TypeScript narrows',
			() =>
				Effect.gen(function* () {
					const result = yield* lintSource({
						'values.tsx': pipe(
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
							Array.join('\n')
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
							'annotated.ts': pipe(
								[
									'const labels: Record<string, string> = {small: "s"}',
									'const minSize = 1',
									'export const sizes = {small: labels.small, tiny: labels.tiny}',
									'export function shadowed(MIN_SIZE: number) { return [minSize, minSize, MIN_SIZE] }'
								],
								Array.join('\n')
							),
							'ordered.ts': pipe(
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
								Array.join('\n')
							),
							'rename.ts': 'const maxSize = 10\nexport const sizes = {maxSize, other: maxSize}'
						},
						['--fix']
					)
					assert.deepStrictEqual(fixed.sources, [
						pipe(
							[
								"const LABELS: Record<string, string> = {small: 's'}",
								'const minSize = 1',
								'export const sizes = {small: LABELS.small, tiny: LABELS.tiny}',
								'export function shadowed(MIN_SIZE: number) {',
								'	return [minSize, minSize, MIN_SIZE]',
								'}',
								''
							],
							Array.join('\n')
						),
						pipe(
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
							Array.join('\n')
						),
						'const MAX_SIZE = 10\nexport const sizes = {maxSize: MAX_SIZE, other: MAX_SIZE}\n'
					])
				}),
			20_000
		)

		testApi.effect(
			'reports closed sets read from a value instead of a schema',
			() =>
				Effect.gen(function* () {
					const result = yield* lintSource({
						'closed-sets.ts': pipe(
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
							Array.join('\n')
						)
					})
					assert.deepStrictEqual(customCodes(result.stdout), [
						'@deslop/coding-standards(no-type-from-value)',
						'@deslop/coding-standards(no-type-from-value)',
						'@deslop/coding-standards(no-type-from-value)',
						'@deslop/coding-standards(no-type-from-value)'
					])
				}),
			20_000
		)

		testApi.effect(
			'uses import bindings instead of matching shadowed names',
			() =>
				Effect.gen(function* () {
					const result = yield* lintSource({
						'bindings.ts': pipe(
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
						'state-valid.ts': pipe(
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
					assert.strictEqual(valid.stderr, '')
				}),
			20_000
		)

		testApi.effect(
			'reports implicit concurrency, dropped causes, empty recoveries, render-time atoms, barrels, gradients and slow motion',
			() =>
				Effect.gen(function* () {
					const result = yield* lintSource({
						'barrel.ts': "export {Effect} from 'effect'\nexport * from 'effect/Option'",
						'effects.tsx': pipe(
							[
								"import {Array, Effect, Schema} from 'effect'",
								"import {Atom} from 'effect/reactivity'",
								'',
								'declare const items: number[]',
								'declare const options: {concurrency: number}',
								'declare function load(id: number): Effect.Effect<number>',
								'declare function download(): Promise<string>',
								'class Failed extends Schema.TaggedError<Failed>()("Failed", {cause: Schema.Unknown, message: Schema.String}) {}',
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
								'export const slow = "transition-opacity duration-500"',
								'export const zoomed = "animate-in zoom-in"',
								'export const shrunk = "starting:scale-50"',
								'export const important = "duration-500!"',
								'export const themed = "dark:starting:scale-50"',
								'export const faded = "bg-linear-to-b from-muted to-background"',
								// oxlint-disable-next-line @deslop/coding-standards/no-gradient -- the fixture holds the class the rule rejects
								'export const painted = "bg-[radial-gradient(circle,var(--muted),transparent)]"',
								'export const calm = "transition-opacity duration-200 animate-in zoom-in-95 starting:scale-95 bg-card"'
							],
							Array.join('\n')
						),
						'reexports.ts': "export {Option} from 'effect'"
					})
					const rules = [
						'explicit-effect-concurrency',
						'motion-limits',
						'no-barrel-module',
						'no-compiler-opt-out',
						'no-component-atom-allocation',
						'no-empty-recovery',
						'no-gradient',
						'preserve-error-cause'
					]
					assert.deepStrictEqual(
						pipe(
							customCodes(result.stdout),
							Array.filter(code => Array.some(rules, rule => code === `@deslop/coding-standards(${rule})`))
						),
						Array.map(
							[
								'explicit-effect-concurrency',
								'explicit-effect-concurrency',
								'explicit-effect-concurrency',
								'explicit-effect-concurrency',
								'motion-limits',
								'motion-limits',
								'motion-limits',
								'motion-limits',
								'motion-limits',
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
								'preserve-error-cause'
							],
							rule => `@deslop/coding-standards(${rule})`
						)
					)
				}),
			20_000
		)

		testApi.effect(
			'keeps package APIs, global classes and Effect services out of native method calls',
			() =>
				Effect.gen(function* () {
					const result = yield* lintSource({
						'receivers.ts': pipe(
							[
								"import {Array, Context, Effect} from 'effect'",
								"import {z} from 'zod'",
								'',
								'declare const path: {posix: {join: (...parts: string[]) => string}; join: (...parts: string[]) => string}',
								'// oxlint-disable-next-line effecttsgo/deterministic-keys -- a fixture in a temporary directory has no stable key',
								'class Groups extends Context.Service<Groups, {replace: (id: string) => Effect.Effect<void>}>()("Groups") {}',
								'export const joined = path.posix.join("a", "b")',
								'export const bytes = Buffer.concat([])',
								'export const trimmed = z.string().trim()',
								'export const replaced = Effect.gen(function* () { const groups = yield* Groups; return yield* groups.replace("a") })',
								'export const listed = Array.map(["a"], value => value).join(",")',
								'export const split = path.join("a").split("/")',
								'export const keys = Object.keys({a: 1})',
								'declare const pending: Effect.Effect<string[]>',
								'export const mapped = Effect.gen(function* () { const values = yield* pending; return values.map(value => value) })'
							],
							Array.join('\n')
						)
					})
					assert.deepStrictEqual(
						pipe(
							result.stdout.diagnostics,
							Array.filter(diagnostic => diagnostic.code === '@deslop/coding-standards(no-native-method-call)'),
							Array.map(diagnostic => diagnostic.labels[0]?.span.line)
						),
						// Array and record methods belong to effecttsgo's prefer-effect-array and prefer-effect-record.
						[13]
					)
				}),
			20_000
		)
	})
})
