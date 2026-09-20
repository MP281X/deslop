import {NodeServices} from '@effect/platform-node'
import {describe, expect, it} from '@effect/vitest'

import {Array, Effect, FileSystem, Path, Record, Schema, Stream, String, pipe} from 'effect'

import {ChildProcess, ChildProcessSpawner} from 'effect/unstable/process'

import plugin from '@deslop/workflow'

type OxlintOutput = typeof OxlintOutput.Type
const OxlintOutput = Schema.Struct({
	diagnostics: Schema.Array(Schema.Struct({code: Schema.String, message: Schema.String}))
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
	return pipe(
		customDiagnostics(output),
		Array.map(diagnostic => diagnostic.code),
		Array.sort(String.Order)
	)
}

function customDiagnostics(output: OxlintOutput) {
	const codes = pipe(
		Record.keys(plugin.rules),
		Array.map(rule => `@deslop/workflow(${rule})`)
	)
	return Array.filter(output.diagnostics, diagnostic => Array.contains(codes, diagnostic.code))
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
									"import {Schema, SchemaGetter, SchemaTransformation, identity, pipe} from 'effect'",
									"import * as React from 'react'",
									"import {useRef, useState} from 'react'",
									'',
									'declare const input: unknown',
									'declare const source: string',
									'const decode = Schema.decodeUnknownSync(Schema.String)',
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
									'const [fake] = useState(() => ({current: null}))',
									'const state = useState(0)',
									'const [fakeNamespace] = React.useState(() => ({current: null}))',
									'const stateNamespace = React.useState(0)',
									'export {AssertString, Codecs, Input, IsString, MissingDecode, MissingEncode, MissingFluent, MissingTransform, MissingType, alias, assigned, callbacks, decode, decoded, decoders, directDecoded, fake, fakeNamespace, forward, input, namespaceRef, operations, ready, ref, run, stateNamespace}',
									'export type {Explicit, Index, Mapped}'
								],
								Array.join('\n')
							)
						})
						expect(result.exitCode).toBe(ChildProcessSpawner.ExitCode(1))
						expect(customCodes(result.stdout)).toEqual(
							pipe(
								[
									'@deslop/workflow(no-fake-ref-state)',
									'@deslop/workflow(no-fake-ref-state)',
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
									'@deslop/workflow(no-undestructured-use-state)',
									'@deslop/workflow(no-undestructured-use-state)',
									'@deslop/workflow(no-unvalidated-json-decode)',
									'@deslop/workflow(no-unvalidated-json-decode)',
									'@deslop/workflow(schema-type-pair)',
									'@deslop/workflow(schema-type-pair)',
									'@deslop/workflow(schema-type-pair)',
									'@deslop/workflow(schema-type-pair)',
									'@deslop/workflow(schema-type-pair)'
								],
								Array.sort(String.Order)
							)
						)
						expect(
							pipe(
								customDiagnostics(result.stdout),
								Array.filter(diagnostic => diagnostic.code === '@deslop/workflow(no-stored-schema-operation)'),
								Array.map(diagnostic => diagnostic.message)
							)
						).toEqual(
							Array.makeBy(
								7,
								() => 'Inline this Schema operation at its consumption site; never store compiled operations.'
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
									"import {Array, Schema, SchemaGetter, SchemaTransformation, identity, pipe} from 'effect'",
									'',
									'declare const input: unknown',
									'declare function combine(left: string, right: string): string',
									'type User = typeof User.Type',
									'const User = Schema.Struct({name: Schema.String})',
									'type Annotated = typeof Annotated.Type',
									'const Annotated = Schema.String.annotate({description: "value"})',
									'export type Public = typeof Public.Type',
									'const Public = Schema.Struct({name: Schema.String})',
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
									'export {Annotated, Arbitrary, Decoded, Encoded, Formatter, LinearIssue, Normalized, decoded, decodedMany, encoded, isUser, swap, transform, tuple, withDefault}'
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
			'reports runtime typeof and module mocking',
			() =>
				pipe(
					Effect.gen(function* () {
						const result = yield* lintSource({
							name: 'mocking.ts',
							source: pipe(
								[
									"import {Predicate} from 'effect'",
									'',
									'declare const properties: unknown',
									'declare const value: unknown',
									'declare const vi: {mock: (path: string, factory: () => object) => void; spyOn: (target: object, key: string) => void}',
									"const isText = typeof value === 'string'",
									"if (typeof properties === 'object') Predicate.isNotNull(properties)",
									"vi.mock('../src/NotionClient.ts', () => ({}))",
									"vi.spyOn(console, 'log')",
									'export {isText}'
								],
								Array.join('\n')
							)
						})
						expect(customCodes(result.stdout)).toEqual(
							pipe(
								[
									'@deslop/workflow(no-module-mocking)',
									'@deslop/workflow(no-module-mocking)',
									'@deslop/workflow(no-typeof)',
									'@deslop/workflow(no-typeof)'
								],
								Array.sort(String.Order)
							)
						)
						expect(
							pipe(
								customDiagnostics(result.stdout),
								Array.filter(diagnostic => diagnostic.code === '@deslop/workflow(no-typeof)'),
								Array.map(diagnostic => diagnostic.message)
							)
						).toEqual(Array.makeBy(2, () => 'Use a Predicate module function.'))
						expect(
							pipe(
								customDiagnostics(result.stdout),
								Array.filter(diagnostic => diagnostic.code === '@deslop/workflow(no-module-mocking)'),
								Array.map(diagnostic => diagnostic.message)
							)
						).toEqual(Array.makeBy(2, () => 'A Layer is the seam; never mock a module.'))
					}),
					Effect.scoped
				),
			20_000
		)

		testApi.effect(
			'allows a Layer as the test seam',
			() =>
				pipe(
					Effect.gen(function* () {
						const result = yield* lintSource({
							name: 'seam.ts',
							source: pipe(
								[
									"import {NodeServices} from '@effect/platform-node'",
									"import {it} from '@effect/vitest'",
									"import {Effect, Layer, Predicate} from 'effect'",
									'',
									'declare const value: unknown',
									'const isText = Predicate.isString(value)',
									'it.layer(Layer.provideMerge(Layer.empty, NodeServices.layer))(test => {',
									"  test.effect('sums expenses negative per tag', () => Effect.void)",
									'})',
									'export {isText}'
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
