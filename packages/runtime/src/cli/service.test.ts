import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	ConfigProvider,
	Effect,
	Fiber,
	FileSystem,
	Option,
	Predicate,
	Queue,
	Ref,
	Sink,
	Stream,
	pipe
} from 'effect'

import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import {execute, install, installUpdates, status, uninstall} from '#cli/service.ts'

it.effect('releases an interrupted command before its caller scope closes', () =>
	Effect.scoped(
		Effect.gen(function* () {
			const released = yield* Ref.make(false)
			const started = yield* Queue.unbounded<void>()
			const spawner = ChildProcessSpawner.make(() =>
				Effect.acquireRelease(
					Effect.as(
						Queue.offer(started, undefined),
						ChildProcessSpawner.makeHandle({
							all: Stream.empty,
							exitCode: Effect.never,
							getInputFd: () => Sink.drain,
							getOutputFd: () => Stream.empty,
							isRunning: Effect.succeed(true),
							kill: () => Effect.void,
							pid: ChildProcessSpawner.ProcessId(1),
							stderr: Stream.empty,
							stdin: Sink.drain,
							stdout: Stream.empty,
							unref: Effect.succeed(Effect.void)
						})
					),
					() => Ref.set(released, true)
				)
			)
			const pending = yield* pipe(
				execute('stall', []),
				Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
				Effect.forkChild
			)
			yield* Queue.take(started)
			yield* Fiber.interrupt(pending)
			assert.isTrue(yield* Ref.get(released))
		})
	)
)

it.layer(NodeServices.layer)('Service lifecycle', test => {
	test.effect(
		'installs a restarting unit and its update timer, then uninstalls both while retaining app data',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const home = yield* fs.makeTempDirectoryScoped()
			const commands = yield* Ref.make<string[]>([])
			const spawner = ChildProcessSpawner.make(command =>
				Effect.gen(function* () {
					if (!ChildProcess.isStandardCommand(command)) return yield* Effect.die('Unexpected pipeline')
					yield* Ref.update(commands, rows => [
						...rows,
						Array.join(
							[
								command.command,
								...Array.map(command.args, arg =>
									Option.getOrElse(Option.liftPredicate(arg, Predicate.isString), () => '<redacted>')
								)
							],
							' '
						)
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
						stdout: Stream.make(new TextEncoder().encode('ActiveState=active\n')),
						unref: Effect.succeed(Effect.void)
					})
				})
			)
			function run<A, E, R>(effect: Effect.Effect<A, E, R>) {
				return pipe(
					effect,
					Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
					Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({HOME: home}))
				)
			}
			const entry = `${home}/.deslop/fixture/current/dist/server.js`
			yield* run(install('fixture', ['/node', entry, '--traces', 'https://example.com/%u$HOME"\n[Service]']))
			yield* run(installUpdates('fixture', ['/node', entry, 'service', 'update']))
			const units = `${home}/.config/systemd/user`
			const unit = yield* fs.readFileString(`${units}/deslop-fixture.service`)
			assert.include(unit, `ExecStart="/node" "${entry}" "--traces" "https://example.com/%%u$$HOME\\"\\n[Service]"`)
			assert.include(unit, `EnvironmentFile=-${home}/.deslop/fixture.env\n`)
			assert.include(yield* fs.readFileString(`${units}/deslop-fixture-update.service`), '"service" "update"')
			assert.include(yield* fs.readFileString(`${units}/deslop-fixture-update.timer`), 'OnUnitInactiveSec=15min')
			assert.includeMembers(yield* Ref.get(commands), [
				'systemctl --user restart deslop-fixture.service',
				'systemctl --user enable --now deslop-fixture-update.timer'
			])
			assert.include(yield* run(status('fixture')), 'ActiveState=active')
			yield* fs.makeDirectory(`${home}/.deslop/fixture`, {recursive: true})
			yield* fs.writeFileString(`${home}/.deslop/fixture/data`, 'keep')
			yield* run(uninstall('fixture'))
			assert.deepStrictEqual(yield* fs.readDirectory(units), [])
			assert.strictEqual(yield* fs.readFileString(`${home}/.deslop/fixture/data`), 'keep')
		})
	)
})
