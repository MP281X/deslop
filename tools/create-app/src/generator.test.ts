import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Effect, FileSystem, Path, Schema} from 'effect'

import {ChildProcess} from 'effect/process'

it.layer(NodeServices.layer)(test => {
	test.effect(
		'substitutes generated app names once, including names containing the template name',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const temporary = yield* fs.makeTempDirectoryScoped()
			for (const kind of ['web', 'mobile']) {
				for (const name of ['template-app', 'my-template-app', 'template-app-x']) {
					const target = path.join(temporary, kind, name)
					const child = yield* ChildProcess.make(
						process.execPath,
						[
							path.resolve(import.meta.dirname, '../bin/index.ts'),
							'--kind',
							kind,
							'--name',
							name,
							'--directory',
							target
						],
						{cwd: path.resolve(import.meta.dirname, '../../..'), stderr: 'inherit', stdout: 'inherit'}
					)
					assert.strictEqual(yield* child.exitCode, 0)
					assert.deepStrictEqual(
						yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({name: Schema.String})))(
							yield* fs.readFileString(path.join(target, 'package.json'))
						),
						{name: `@deslop/${name}`}
					)
				}
			}
		})
	)
})
