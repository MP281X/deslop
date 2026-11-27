import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Boolean, Effect, FileSystem, Function, Schema, pipe} from 'effect'

import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import {IPHONE_EXPORT_DIRECTORY, writeIPhoneExport} from '@deslop/runtime/config/iphone-export'

class ExpoError extends Schema.TaggedError<ExpoError>()('ExpoError', {message: Schema.String}) {}

const expo = Effect.fnUntraced(function* (args: readonly string[]) {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	const code = yield* spawner.exitCode(ChildProcess.make('expo', args, {stderr: 'inherit', stdout: 'inherit'}))
	if (code !== 0) return yield* Effect.fail(new ExpoError({message: `Expo ${args[0]} exited with ${code}`}))
})

const prepare = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem
	const manifest = yield* fs.readFileString('package.json')
	// Expo adds its build dependencies to the package the server ships. Keep them as devDependencies.
	yield* Effect.onExit(expo(['prebuild', '--platform', 'ios', '--no-install']), () =>
		fs.writeFileString('package.json', manifest)
	)
})

const build = Effect.gen(function* () {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	yield* expo(['export', '--platform', 'ios', '--output-dir', IPHONE_EXPORT_DIRECTORY])
	const runtime = yield* spawner.string(
		ChildProcess.make('expo-updates', ['runtimeversion:resolve', '--platform', 'ios'])
	)
	yield* writeIPhoneExport(
		runtime,
		yield* spawner.string(ChildProcess.make('expo', ['config', '--type', 'public', '--json']))
	)
})

NodeRuntime.runMain(
	pipe(
		process.argv[2] === 'prepare',
		Boolean.match({onFalse: Function.constant(build), onTrue: Function.constant(prepare)}),
		Effect.provide(NodeServices.layer)
	)
)
