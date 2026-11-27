import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {Effect, FileSystem} from 'effect'

import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import {IPHONE_EXPORT_DIRECTORY, writeIPhoneExport} from '@deslop/runtime/config/iphone-export'

const expo = Effect.fnUntraced(function* (args: ReadonlyArray<string>) {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	const code = yield* spawner.exitCode(ChildProcess.make('expo', args, {stderr: 'inherit', stdout: 'inherit'}))
	if (code !== 0) return yield* Effect.fail(new Error(`Expo ${args[0]} exited with ${code}`))
})

const prepare = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem
	const manifest = yield* fs.readFileString('package.json')
	// Expo adds its build dependencies to the package the server ships. Keep them as devDependencies.
	yield* expo(['prebuild', '--platform', 'ios', '--no-install']).pipe(
		Effect.ensuring(fs.writeFileString('package.json', manifest).pipe(Effect.orDie))
	)
})

const build = Effect.gen(function* () {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	yield* expo(['export', '--platform', 'ios', '--output-dir', IPHONE_EXPORT_DIRECTORY])
	const runtime = yield* spawner.string(
		ChildProcess.make('expo-updates', ['runtimeversion:resolve', '--platform', 'ios'])
	)
	const config = yield* spawner.string(ChildProcess.make('expo', ['config', '--type', 'public', '--json']))
	yield* writeIPhoneExport(runtime, config)
})

NodeRuntime.runMain(
	(process.argv[2] === 'prepare' ? prepare : build).pipe(Effect.provide(NodeServices.layer))
)
