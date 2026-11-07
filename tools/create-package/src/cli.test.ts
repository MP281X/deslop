import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Effect, FileSystem, Path, Schema} from 'effect'

import {ChildProcess} from 'effect/process'

it.layer(NodeServices.layer)(test => {
	test.effect(
		'creates a package at the repository-relative destination from the workspace command directory',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = path.resolve(import.meta.dirname, '../../..')
			const target = path.join(yield* fs.makeTempDirectoryScoped(), 'package-proof')
			const child = yield* ChildProcess.make(
				'node',
				[
					path.join(root, 'tools/create-package/bin/index.ts'),
					'--name',
					'package-proof',
					'--directory',
					path.relative(root, target)
				],
				{cwd: path.join(root, 'tools'), stderr: 'inherit', stdout: 'inherit'}
			)
			assert.strictEqual(yield* child.exitCode, 0)
			assert.deepStrictEqual(
				yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({name: Schema.String})))(
					yield* fs.readFileString(path.join(target, 'package.json'))
				),
				{name: '@deslop/package-proof'}
			)
		})
	)
})
