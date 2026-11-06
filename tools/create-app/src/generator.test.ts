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
			const root = path.resolve(import.meta.dirname, '../../..')
			const temporary = yield* fs.makeTempDirectoryScoped()
			yield* fs.symlink(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'))
			for (const app of [
				{donor: 'portfolio', kind: 'web'},
				{donor: 'stash', kind: 'mobile'}
			]) {
				for (const name of ['template-app', 'my-template-app', 'template-app-x']) {
					const target = path.join(temporary, app.kind, name)
					const child = yield* ChildProcess.make(
						process.execPath,
						[
							path.resolve(import.meta.dirname, '../bin/index.ts'),
							'--kind',
							app.kind,
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
					yield* fs.remove(path.join(target, 'node_modules'), {force: true, recursive: true})
					yield* fs.symlink(path.join(root, 'apps', app.donor, 'node_modules'), path.join(target, 'node_modules'))
					const checked = yield* ChildProcess.make(
						path.join(root, 'node_modules/.bin/tsrs'),
						['--noEmit', '--fast', '-p', path.join(target, 'tsconfig.json')],
						{cwd: root, stderr: 'inherit', stdout: 'inherit'}
					)
					assert.strictEqual(yield* checked.exitCode, 0)
				}
			}
		})
	)
})
