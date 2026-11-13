// oxlint-disable-next-line effecttsgo/node-builtin-import -- Effect Path has no glob matcher; compare the workspace's actual Fallow zone patterns.
import {matchesGlob} from 'node:path'

import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Boolean, Effect, FileSystem, Option, Path, Record, Schema, String, Struct, pipe} from 'effect'

import {Jsonc} from 'effect/encoding'
import {ChildProcess} from 'effect/process'

import {testWorkspace} from '@deslop/create-package/testing'

type Manifest = typeof Manifest.Type
const Manifest = Schema.fromJsonString(
	Schema.Struct({
		bin: Schema.Record(Schema.String, Schema.String),
		dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
		devDependencies: Schema.Record(Schema.String, Schema.String),
		engines: Schema.Struct({node: Schema.String}),
		files: Schema.Array(Schema.String),
		imports: Schema.Record(Schema.String, Schema.String),
		main: Schema.optionalKey(Schema.String),
		name: Schema.String,
		publishConfig: Schema.Struct({access: Schema.String}),
		repository: Schema.Struct({directory: Schema.String, type: Schema.String, url: Schema.String}),
		scripts: Schema.Record(Schema.String, Schema.String),
		sideEffects: Schema.Boolean,
		type: Schema.String
	})
)

const compareStructure = Effect.fnUntraced(function* (root: string, target: string, donor: string, kind: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const name = path.basename(target)
	const slug = path.basename(donor)
	const actual = yield* Schema.decodeEffect(Manifest)(yield* fs.readFileString(path.join(target, 'package.json')))
	const reference = yield* Schema.decodeEffect(Manifest)(
		String.replaceAll(slug, name)(yield* fs.readFileString(path.join(donor, 'package.json')))
	)
	assert.deepStrictEqual(
		Struct.omit(actual, ['dependencies', 'devDependencies', 'imports']),
		Struct.omit(reference, ['dependencies', 'devDependencies', 'imports'])
	)
	for (const entry of Record.toEntries(actual.imports)) assert.strictEqual(reference.imports[entry[0]], entry[1])
	for (const entry of Record.toEntries({...actual.dependencies, ...actual.devDependencies})) {
		assert.strictEqual({...reference.dependencies, ...reference.devDependencies}[entry[0]], entry[1], entry[0])
	}
	for (const file of Array.appendAll(
		['tsconfig.json', 'vite.config.ts', 'src/main.client.tsx'],
		Boolean.match(kind === 'web', {
			onFalse: () => ['metro.config.ts', 'fingerprint.config.js', 'src/routes/app.icon/icon.json'],
			onTrue: () => ['index.html', 'src/routes/__root.tsx']
		})
	)) {
		const source = Boolean.match(kind === 'web' && file === 'src/main.client.tsx', {
			onFalse: () => path.join(donor, file),
			onTrue: () => path.join(root, 'apps/portfolio', file)
		})
		assert.strictEqual(
			yield* fs.readFileString(path.join(target, file)),
			pipe(
				yield* fs.readFileString(source),
				String.replaceAll(String.capitalize(slug), name),
				String.replaceAll(slug, name)
			),
			file
		)
	}
	// Byte for byte and without the slug rename, which would rewrite "development": a build profile no real app has fails here.
	if (kind === 'mobile') {
		assert.strictEqual(
			yield* fs.readFileString(path.join(target, 'eas.json')),
			yield* fs.readFileString(path.join(donor, 'eas.json'))
		)
	}
	assert.isTrue(yield* fs.exists(path.join(target, 'README.md')))
	assert.isTrue(yield* fs.exists(path.join(target, 'AGENTS.md')))
})

const checkServiceBoundaries = Effect.fnUntraced(function* (root: string, target: string, donor: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const policy = yield* Schema.decodeUnknownEffect(
		Schema.Struct({
			boundaries: Schema.Struct({
				zones: Schema.Array(Schema.Struct({name: Schema.String, patterns: Schema.Array(Schema.String)}))
			})
		})
	)(yield* Effect.fromResult(Jsonc.parse(yield* fs.readFileString(path.join(root, '.fallowrc.json')))))
	// The real service tree supplies its schemas, helpers, numbered SQLite migrations and spans, never a second handwritten implementation.
	for (const file of yield* fs.readDirectory(path.join(donor, 'src/services'), {recursive: true})) {
		if (String.endsWith('.ts')(file) && !String.endsWith('.test.ts')(file)) {
			yield* fs.makeDirectory(path.dirname(path.join(target, 'src/services', file)), {recursive: true})
			yield* fs.writeFileString(
				path.join(target, 'src/services', file),
				String.replaceAll(
					`@deslop/${path.basename(donor)}`,
					`@deslop/${path.basename(target)}`
				)(yield* fs.readFileString(path.join(donor, 'src/services', file)))
			)
		}
	}
	for (const file of yield* fs.readDirectory(path.join(target, 'src'), {recursive: true})) {
		if ((yield* fs.stat(path.join(target, 'src', file))).type !== 'Directory' && !String.endsWith('.gen.ts')(file)) {
			function zoneOf(slug: string) {
				return pipe(
					policy.boundaries.zones,
					Array.findFirst(zone =>
						Array.some(zone.patterns, pattern => matchesGlob(`apps/${slug}/src/${file}`, pattern))
					),
					Option.map(zone => zone.name)
				)
			}
			assert.isTrue(Option.isSome(zoneOf(path.basename(target))), file)
			assert.deepStrictEqual(zoneOf(path.basename(target)), zoneOf(path.basename(donor)), file)
		}
	}
})

it.layer(NodeServices.layer)(test => {
	test.effect(
		'generates web and mobile apps with real-app structure, boundaries, lint and types',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = path.resolve(import.meta.dirname, '../../..')
			const workspace = yield* testWorkspace(root)
			for (const app of [
				{donor: 'scope', kind: 'web'},
				{donor: 'opm', kind: 'mobile'}
			]) {
				const name = `template-app-${app.kind}-${String.toLowerCase(path.basename(workspace))}`
				const target = path.join(workspace, 'apps', name)
				assert.strictEqual(
					yield* Effect.flatMap(
						ChildProcess.make(
							'node',
							[path.join(workspace, 'tools/create-app/bin/index.ts'), '--name', name, '--kind', app.kind],
							{cwd: path.join(workspace, 'tools'), stderr: 'inherit', stdout: 'inherit'}
						),
						child => child.exitCode
					),
					0
				)
				const donor = path.join(root, 'apps', app.donor)
				yield* compareStructure(root, target, donor, app.kind)
				// A real install supplies exactly these package dependencies; the full public-command journey installs them too.
				if (yield* fs.exists(path.join(target, 'node_modules'))) {
					yield* fs.remove(path.join(target, 'node_modules'), {recursive: true})
				}
				yield* fs.symlink(path.join(donor, 'node_modules'), path.join(target, 'node_modules'))
				// Check the starter before adding real-service fixtures: borrowed modules must not hide a missing manifest dependency.
				assert.strictEqual(
					yield* Effect.flatMap(
						ChildProcess.make(
							'vp',
							[
								'exec',
								'fallow',
								'dead-code',
								'--workspace',
								`@deslop/${name}`,
								'--format',
								'compact',
								'--fail-on-issues',
								'--quiet'
							],
							{cwd: workspace, stderr: 'inherit', stdout: 'inherit'}
						),
						child => child.exitCode
					),
					0
				)
				yield* checkServiceBoundaries(root, target, donor)
				for (const check of [
					['vp', ['exec', 'tsrs', '--noEmit', '--fast', '-p', path.join(target, 'tsconfig.json')]],
					[
						'vp',
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
					]
				] as const) {
					assert.strictEqual(
						yield* Effect.flatMap(
							ChildProcess.make(check[0], check[1], {
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
			}
		})
	)
})
