import {userInfo} from 'node:os'
import {platform} from 'node:process'

import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, ConfigProvider, Effect, FileSystem, Option, Predicate, Ref, Sink, Stream, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import {update} from '#server/update.ts'

it.layer(NodeServices.layer)('Service update', test => {
	test.effect(
		'installs the latest release beside the running one, restarts once, keeps only the previous release, then leaves it running',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const home = yield* fs.makeTempDirectoryScoped()
			const root = `${home}/.deslop/fixture`
			function release(version: string) {
				return `${root}/releases/${version}/node_modules/@deslop/fixture`
			}
			const publish = Effect.fnUntraced(function* (version: string) {
				yield* fs.makeDirectory(release(version), {recursive: true})
				yield* fs.writeFileString(`${release(version)}/package.json`, `{"version":"${version}"}`)
			})
			yield* Effect.forEach(['0.1.9', '0.1.10'], publish, {concurrency: 1})
			yield* fs.symlink(release('0.1.10'), `${root}/current`)
			const commands = yield* Ref.make<string[]>([])
			const spawner = ChildProcessSpawner.make(command =>
				Effect.gen(function* () {
					if (!ChildProcess.isStandardCommand(command)) return yield* Effect.die('Unexpected pipeline')
					if (Array.contains(command.args, 'install')) yield* publish('0.1.11')
					const linked = yield* fs.readLink(`${root}/current`)
					yield* Ref.update(commands, rows => [
						...rows,
						`${Array.join(
							Array.map(command.args, arg =>
								Option.getOrElse(Option.liftPredicate(arg, Predicate.isString), () => '<redacted>')
							),
							' '
						)} → ${linked}`
					])
					return ChildProcessSpawner.makeHandle({
						all: Stream.empty,
						exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
						getInputFd: () => Sink.drain,
						getOutputFd: () => Stream.empty,
						isRunning: Effect.succeed(false),
						kill: () => Effect.void,
						pid: ChildProcessSpawner.ProcessId(1),
						stderr: Stream.empty,
						stdin: Sink.drain,
						stdout: Stream.empty,
						unref: Effect.succeed(Effect.void)
					})
				})
			)
			function attempt() {
				return pipe(
					update('fixture'),
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
			yield* attempt()
			assert.include(yield* attempt(), 'is current')
			const [installed, restarted, ...rest] = yield* Ref.get(commands)
			assert.include(installed, '--ignore-scripts')
			assert.include(installed, `@deslop/fixture@0.1.11 → ${release('0.1.10')}`)
			if (platform === 'darwin') {
				assert.strictEqual(restarted, `kickstart -k gui/${userInfo().uid}/deslop-fixture → ${release('0.1.11')}`)
			} else {
				assert.strictEqual(restarted, `--user restart deslop-fixture.service → ${release('0.1.11')}`)
			}
			assert.isEmpty(rest)
			assert.sameMembers(yield* fs.readDirectory(`${root}/releases`), ['0.1.10', '0.1.11'])
		})
	)
})
