import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Boolean, ConfigProvider, Effect, FileSystem, Ref, Sink, Stream, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import {update} from '#cli/update.ts'

it.layer(NodeServices.layer)('Managed update', test => {
	test.effect(
		'stages the exact package and restores the previous code after failed activation without retrying a bad release',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const home = yield* fs.makeTempDirectoryScoped()
			const root = `${home}/.deslop/fixture`
			const previous = `${root}/releases/0.1.10/node_modules/@deslop/fixture`
			const target = `${root}/releases/0.1.11/node_modules/@deslop/fixture`
			yield* fs.makeDirectory(`${previous}/dist`, {recursive: true})
			yield* fs.writeFileString(`${previous}/dist/server.js`, 'fixture-code')
			yield* fs.writeFileString(`${previous}/package.json`, '{"version":"0.1.10"}')
			yield* fs.symlink(previous, `${root}/current`)
			const restarts = yield* Ref.make<string[]>([])
			const spawner = ChildProcessSpawner.make(command =>
				Effect.gen(function* () {
					if (!ChildProcess.isStandardCommand(command)) return yield* Effect.die('Unexpected pipeline')
					if (Array.contains(command.args, 'install')) {
						assert.isTrue(Array.contains(command.args, '--ignore-scripts'))
						assert.isTrue(Array.contains(command.args, '@deslop/fixture@0.1.11'))
						yield* fs.makeDirectory(`${target}/dist`, {recursive: true})
						yield* fs.writeFileString(`${target}/dist/server.js`, 'fixture-code')
						yield* fs.writeFileString(`${target}/package.json`, '{"version":"0.1.11"}')
					}
					const linked = yield* fs.readLink(`${root}/current`)
					if (Array.contains(command.args, 'restart')) yield* Ref.update(restarts, rows => [...rows, linked])
					return ChildProcessSpawner.makeHandle({
						all: Stream.empty,
						exitCode: Effect.succeed(
							ChildProcessSpawner.ExitCode(
								Boolean.match(Array.contains(command.args, 'restart') && linked === target, {
									onFalse: () => 0,
									onTrue: () => 1
								})
							)
						),
						getInputFd: () => Sink.drain,
						getOutputFd: () => Stream.empty,
						isRunning: Effect.succeed(false),
						kill: () => Effect.void,
						pid: ChildProcessSpawner.ProcessId(1),
						stderr: Stream.make(new TextEncoder().encode('fixture activation failed')),
						stdin: Sink.drain,
						stdout: Stream.empty,
						unref: Effect.succeed(Effect.void)
					})
				})
			)
			function attempt() {
				return pipe(
					update('fixture', {auth: '', host: '127.0.0.1', port: 5200, traces: '', url: 'http://127.0.0.1:5200'}),
					Effect.scoped,
					Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({HOME: home})),
					Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
					Effect.provideService(
						HttpClient.HttpClient,
						HttpClient.make(request =>
							Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({version: '0.1.11'})))
						)
					)
				)
			}
			assert.isTrue((yield* Effect.result(attempt()))._tag === 'Failure')
			assert.strictEqual(yield* fs.readLink(`${root}/current`), previous)
			assert.strictEqual(yield* fs.readLink(`${root}/previous`), previous)
			assert.strictEqual(Array.length(yield* Ref.get(restarts)), 2)
			assert.deepStrictEqual(yield* Ref.get(restarts), [target, previous])
			assert.include(yield* attempt(), 'previously failed')
			assert.strictEqual(Array.length(yield* Ref.get(restarts)), 2)
		})
	)
})
