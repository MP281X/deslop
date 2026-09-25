import {NodeServices} from '@effect/platform-node'
import {describe, expect, it} from '@effect/vitest'

import {Array, Effect, FileSystem, Path, Record, Schema, Stream, String, pipe} from 'effect'

import {ChildProcess, ChildProcessSpawner} from 'effect/unstable/process'

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
									"import {Array, Schema, SchemaGetter, SchemaTransformation, identity, pipe} from 'effect'",
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
									'const MissingFluent = Schema.String.annotate({description: "value"})',
									'const MissingTransform = Schema.decodeTo(Schema.Number, SchemaTransformation.transform({decode: Number, encode: String}))(Schema.String)',
									'const MissingDecode = Schema.decode({decode: SchemaGetter.transform(identity), encode: SchemaGetter.transform(identity)})(Schema.String)',
									'const MissingEncode = Schema.encode({decode: SchemaGetter.transform(identity), encode: SchemaGetter.transform(identity)})(Schema.String)',
									'type Tree = typeof Tree.Type',
									'const Tree: Schema.Codec<Tree> = Schema.Struct({children: Schema.Array(Schema.suspend((): Schema.Codec<Tree> => Tree))})',
									'type Explicit = {readonly values: readonly string[]}',
									'type Mapped<T> = {readonly [K in keyof T]: T[K]}',
									'type Index = {readonly [key: string]: string}',
									'class Input { readonly field = "value"; constructor(readonly value: string) {} }',
									'const ref = useRef<HTMLElement | null>(null)',
									'const namespaceRef = React.useRef<HTMLElement | null>(null)',
									'const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(source)',
									'const directDecoded = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(source)',
									'function forward(value: string) { return consume(value) }',
									'function ready() { return source.length > 0 }',
									'function run() { consume(source) }',
									'function consume(value: string) { return value.length }',
									'const callbacks = {consume: (value: string) => consume(value)}',
									'const alias = source',
									'function Fallback() { return <div className="missing" /> }',
									'const fallbacks = Array.map([input], Fallback)',
									'const notFound = () => Array.empty<string>()',
									'const asyncConstant = async () => "ready"',
									'const recipients = Array.isArray(input) ? input : [input]',
									'const wrapped = !Array.isArray(input) ? [input] : input',
									'const [fake] = useState(() => ({current: null}))',
									'const state = useState(0)',
									'const [fakeNamespace] = React.useState(() => ({current: null}))',
									'const stateNamespace = React.useState(0)',
									'// oxlint-disable-next-line eqeqeq',
									'const loose = source == "ready"',
									'// @effect-diagnostics-next-line floatingEffect:off',
									'export {AssertString, Codecs, Fallback, Input, IsString, MissingDecode, MissingEncode, MissingFluent, MissingTransform, MissingType, Tree, alias, assigned, asyncConstant, callbacks, decode, decoded, decoders, deepPipe, directDecoded, fake, fakeNamespace, fallbacks, forward, input, loose, mappedValues, namespaceRef, notFound, operations, ready, recipients, ref, run, stateNamespace, wrapped}',
									'export type {Explicit, Index, Mapped}'
								],
								Array.join('\n')
							)
						})
						expect(result.exitCode).toBe(ChildProcessSpawner.ExitCode(1))
						expect(customCodes(result.stdout)).toEqual(
							pipe(
								[
									'@deslop/workflow(no-array-wrap-ternary)',
									'@deslop/workflow(no-array-wrap-ternary)',
									'@deslop/workflow(no-constant-function)',
									'@deslop/workflow(no-deep-pipe)',
									'@deslop/workflow(no-fake-ref-state)',
									'@deslop/workflow(no-fake-ref-state)',
									'@deslop/workflow(no-native-method-call)',
									'@deslop/workflow(no-readonly-type-syntax)',
									'@deslop/workflow(no-readonly-type-syntax)',
									'@deslop/workflow(no-readonly-type-syntax)',
									'@deslop/workflow(no-readonly-type-syntax)',
									'@deslop/workflow(no-readonly-type-syntax)',
									'@deslop/workflow(no-readonly-type-syntax)',
									'@deslop/workflow(no-redundant-use-ref-null-type)',
									'@deslop/workflow(no-redundant-use-ref-null-type)',
									'@deslop/workflow(no-stored-schema-operation)',
									'@deslop/workflow(no-stored-schema-operation)',
									'@deslop/workflow(no-stored-schema-operation)',
									'@deslop/workflow(no-stored-schema-operation)',
									'@deslop/workflow(no-stored-schema-operation)',
									'@deslop/workflow(no-stored-schema-operation)',
									'@deslop/workflow(no-stored-schema-operation)',
									'@deslop/workflow(no-trivial-indirection)',
									'@deslop/workflow(no-trivial-indirection)',
									'@deslop/workflow(no-trivial-indirection)',
									'@deslop/workflow(no-trivial-indirection)',
									'@deslop/workflow(no-trivial-indirection)',
									'@deslop/workflow(no-trivial-indirection)',
									'@deslop/workflow(no-trivial-indirection)',
									'@deslop/workflow(no-undestructured-use-state)',
									'@deslop/workflow(no-undestructured-use-state)',
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
						expect(result.stderr).toBe('')
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
									"import {Array, Layer, Result, Schema, SchemaGetter, SchemaTransformation, identity, pipe} from 'effect'",
									'',
									'declare const input: unknown',
									'declare const layer: Layer.Layer<never>',
									'declare const outcome: Result.Result<number, string>',
									'const mappedOutcome = Result.map(outcome, value => value + 1)',
									'const layers = pipe(layer, Layer.provide(pipe(layer, Layer.provide(pipe(layer, Layer.provide(layer))))))',
									'declare function combine(left: string, right: string): string',
									'declare const snapshot: {width: number}',
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
									'const Arbitrary = Schema.toArbitrary(User)',
									'function transform(value: string) { return value.length }',
									'function swap(left: string, right: string) { return combine(right, left) }',
									'function withDefault(value = "ready") { return transform(value) }',
									'const tuple = ["ready", 1] as const',
									'const lengths = Array.isArray(input) ? input.length : 0',
									'const ensured = Array.ensure(input)',
									'const constants = Array.map([input], () => input)',
									'function identify(value: {id: string}) { return value.id }',
									'let counter = 0',
									'counter = counter + 1',
									'function readCounter() { return counter }',
									'const counters = Array.map([input], readCounter)',
									'function circle() { return Math.PI }',
									'const circles = Array.map([input], circle)',
									'function readSnapshot() { return snapshot.width }',
									'const snapshots = Array.map([input], readSnapshot)',
									'const DefaultInput = Schema.JsonObject.make({schema: {type: "object"}})',
									'// oxlint-disable-next-line eqeqeq -- the fixture keeps a reasoned disable',
									'const loose = snapshot.width == 1',
									'export {Annotated, Arbitrary, CallStep, CodeStep, Decoded, DefaultInput, Encoded, Formatter, LinearIssue, Normalized, Step, circle, circles, constants, counters, decoded, decodedMany, encoded, ensured, identify, isUser, layers, lengths, loose, mappedOutcome, readCounter, readSnapshot, snapshots, swap, transform, tuple, withDefault}'
								],
								Array.join('\n')
							)
						})
						expect(customCodes(result.stdout)).toEqual([])
						expect(result.stderr).toBe('')
						expect(result.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
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
									'declare function expect(value: unknown): {toThrow: (expected?: string) => void}',
									"const isText = typeof value === 'string'",
									"if (typeof properties === 'object') Predicate.isNotNull(properties)",
									"expect(() => Predicate.isNotNull(value)).toThrow('negative')",
									'export {isText}'
								],
								Array.join('\n')
							)
						})
						expect(customCodes(result.stdout)).toEqual(
							pipe(
								[
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
									'export {compile, ref}'
								],
								Array.join('\n')
							)
						})
						expect(customCodes(result.stdout)).toEqual([])
					}),
					Effect.scoped
				),
			20_000
		)
	})
})
