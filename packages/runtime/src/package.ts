import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Boolean, Effect, FileSystem, Path, Schema, pipe} from 'effect'

import {Argument, Command} from 'effect/cli'

import {AppError, PackageMetadata} from '#cli/schema.ts'
import {execute} from '#cli/service.ts'

const build = Command.make(
	'app-package',
	{app: Argument.String('app')},
	Effect.fnUntraced(function* (input) {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const manifest = yield* Schema.decodeEffect(Schema.fromJsonString(PackageMetadata))(
			yield* fs.readFileString('package.json')
		)
		if (manifest.name !== `@deslop/${input.app}`) {
			return yield* AppError.make({message: 'Run app packaging from its own directory'})
		}
		if (input.app === 'stash' || input.app === 'deploy') {
			const native = path.resolve(import.meta.dirname, '../../../tools/native/linux-x64')
			yield* fs.remove('bin', {force: true, recursive: true})
			yield* fs.makeDirectory('bin')
			for (const tool of Boolean.match(input.app === 'stash', {
				onFalse: () => ['caddy'],
				onTrue: () => ['ffmpeg', 'ffprobe', 'yt-dlp']
			})) {
				yield* execute('tar', ['-xJf', path.join(native, `${tool}.tar.xz`), '-C', 'bin'])
			}
			if (input.app === 'stash') yield* fs.copyFile(path.join(native, 'ffmpeg-LICENSE.txt'), 'bin/LICENSE.txt')
			yield* fs.copyFile(
				path.join(
					native,
					`${Boolean.match(input.app === 'stash', {onFalse: () => 'caddy', onTrue: () => 'stash'})}-SOURCES.txt`
				),
				'bin/SOURCES.txt'
			)
		}
		yield* fs.remove('release', {force: true, recursive: true})
		yield* fs.makeDirectory('release')
		yield* fs.copy('dist', 'release/dist')
		if (yield* fs.exists('bin')) yield* fs.copy('bin', 'release/bin')
		if (yield* fs.exists('README.md')) yield* fs.copyFile('README.md', 'release/README.md')
		// Artifact metadata, not the workspace/Expo manifest: the server has already bundled every JS dependency.
		yield* fs.writeFileString(
			path.join('release', 'package.json'),
			yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))({
				...manifest,
				cpu: ['x64'],
				files: ['bin', 'dist'],
				main: './dist/server.js',
				os: ['linux'],
				publishConfig: {access: 'public'},
				type: 'module'
			})
		)
	})
)

NodeRuntime.runMain(
	pipe(
		Command.run(build, {version: '0.1.0'}),
		Effect.scoped,
		// @effect-diagnostics-next-line strictEffectProvide:off -- Artifact preparation is a release CLI entry point; native tools come only from the checkout.
		Effect.provide(NodeServices.layer)
	)
)
