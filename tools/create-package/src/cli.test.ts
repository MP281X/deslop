import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Effect, FileSystem, Option, Path, Record, Schema, Stream, String, Struct, pipe} from 'effect'

import {ChildProcess} from 'effect/process'

import {testWorkspace} from './test/workspace.ts'

type Package = typeof Package.Type
const Package = Schema.fromJsonString(
	Schema.Struct({
		exports: Schema.Record(Schema.String, Schema.String),
		imports: Schema.Record(Schema.String, Schema.String),
		name: Schema.String,
		scripts: Schema.Record(Schema.String, Schema.String),
		sideEffects: Schema.Boolean,
		type: Schema.String
	})
)

it.layer(NodeServices.layer)(test => {
	test.effect(
		'generates a side-based package with real-package structure, lint and types',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = path.resolve(import.meta.dirname, '../../..')
			const workspace = yield* testWorkspace(root)
			const target = path.join(
				workspace,
				'packages',
				`template-package-${String.toLowerCase(path.basename(workspace))}`
			)
			assert.strictEqual(
				yield* Effect.flatMap(
					ChildProcess.make(
						'node',
						[path.join(workspace, 'tools/create-package/bin/index.ts'), '--name', path.basename(target)],
						{cwd: path.join(workspace, 'tools'), stderr: 'inherit', stdout: 'inherit'}
					),
					child => child.exitCode
				),
				0
			)
			const actual = yield* Schema.decodeEffect(Package)(yield* fs.readFileString(path.join(target, 'package.json')))
			const reference = yield* Schema.decodeEffect(Package)(
				yield* fs.readFileString(path.join(root, 'packages/runtime/package.json'))
			)
			assert.strictEqual(actual.name, `@deslop/${path.basename(target)}`)
			assert.deepStrictEqual(Struct.omit(actual, ['exports', 'name']), Struct.omit(reference, ['exports', 'name']))
			for (const entry of Record.toEntries(actual.exports)) assert.strictEqual(reference.exports[entry[0]], entry[1])
			assert.strictEqual(
				yield* fs.readFileString(path.join(target, 'tsconfig.json')),
				yield* fs.readFileString(path.join(root, 'packages/runtime/tsconfig.json'))
			)
			assert.isTrue(yield* fs.exists(path.join(target, 'README.md')))
			assert.deepStrictEqual(yield* fs.readDirectory(path.join(target, 'src'), {recursive: true}), [
				'shared',
				'shared/schema.ts'
			])
			yield* fs.symlink(path.join(root, 'packages/runtime/node_modules'), path.join(target, 'node_modules'))
			for (const args of [
				['exec', 'tsrs', '--noEmit', '--fast', '-p', path.join(target, 'tsconfig.json')],
				[
					'exec',
					'effect-tsgo',
					'--tsrs-lint',
					'vp',
					'lint',
					'--type-aware',
					'--type-check',
					path.relative(workspace, target)
				]
			]) {
				assert.strictEqual(
					yield* Effect.flatMap(
						ChildProcess.make('vp', args, {
							cwd: workspace,
							env: {TSRS_FAST: '1'},
							extendEnv: true,
							stderr: 'inherit',
							stdout: 'inherit'
						}),
						child => child.exitCode
					),
					0
				)
			}
			const guard = yield* ChildProcess.make(
				'vp',
				[
					'exec',
					'fallow',
					'guard',
					path.relative(workspace, path.join(target, 'src/shared/schema.ts')),
					'packages/runtime/src/shared/schema.ts',
					'--format',
					'json'
				],
				{cwd: workspace}
			)
			const zones = yield* Schema.decodeEffect(
				Schema.fromJsonString(
					Schema.Struct({
						files: Schema.Array(Schema.Struct({zone: Schema.OptionFromNullOr(Schema.Struct({name: Schema.String}))}))
					})
				)
			)(yield* pipe(guard.stdout, Stream.decodeText, Stream.mkString))
			assert.strictEqual(yield* guard.exitCode, 0)
			assert.isTrue(
				Option.isSome(Option.getOrThrow(Array.get(zones.files, 0)).zone),
				'Generated shared contracts must have the same Fallow zone as runtime shared contracts.'
			)
			assert.deepStrictEqual(
				Option.getOrThrow(Array.get(zones.files, 0)).zone,
				Option.getOrThrow(Array.get(zones.files, 1)).zone
			)
		})
	)
})
