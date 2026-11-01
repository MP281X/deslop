import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, ConfigProvider, Effect, FileSystem, Ref, Sink, Stream, pipe} from 'effect'

import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import {packageRoot, packageVersion} from '#cli/package.ts'
import {service, systemdArgument} from '#cli/service.ts'
import {managedEntry} from '#cli/update.ts'

it.layer(NodeServices.layer)('Service lifecycle', test => {
	test.effect(
		'resolves an npm bin symlink before locating metadata, native tools and managed code',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const home = yield* fs.makeTempDirectoryScoped()
			const source = `${home}/node_modules/@deslop/fixture`
			const entry = `${home}/node_modules/.bin/fixture`
			yield* fs.makeDirectory(`${source}/dist`, {recursive: true})
			yield* fs.makeDirectory(`${source}/bin`)
			yield* fs.makeDirectory(`${home}/node_modules/.bin`)
			yield* fs.writeFileString(`${source}/dist/server.js`, 'fixture-code')
			yield* fs.writeFileString(`${source}/bin/tool`, 'fixture-native')
			yield* fs.writeFileString(`${source}/package.json`, '{"version":"0.1.1"}')
			yield* fs.symlink(`${source}/dist/server.js`, entry)
			assert.strictEqual(yield* packageRoot(entry), source)
			assert.strictEqual(yield* packageVersion(entry), '0.1.1')
			const installed = yield* pipe(
				managedEntry('fixture', entry),
				Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({HOME: home}))
			)
			assert.strictEqual(yield* fs.readFileString(installed), 'fixture-code')
			assert.strictEqual(yield* fs.readFileString(`${home}/.deslop/fixture/current/bin/tool`), 'fixture-native')
		})
	)
	test.effect(
		'installs, restarts changed settings and uninstalls only its unit while retaining app data',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const home = yield* fs.makeTempDirectoryScoped()
			const commands = yield* Ref.make<string[][]>([])
			const spawner = ChildProcessSpawner.make(command =>
				Effect.gen(function* () {
					if (!ChildProcess.isStandardCommand(command)) return yield* Effect.die('Unexpected pipeline')
					yield* Ref.update(commands, rows => [...rows, [command.command, ...Array.map(command.args, arg => `${arg}`)]])
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
			function change(action: 'install' | 'status' | 'uninstall') {
				return pipe(
					service('fixture', action, '/node', '/path with spaces/server.js', [
						'--traces',
						'https://example.com/%u$HOME'
					]),
					Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
					Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({HOME: home})),
					Effect.scoped
				)
			}
			yield* change('install')
			const unit = yield* fs.readFileString(`${home}/.config/systemd/user/deslop-fixture.service`)
			assert.include(unit, '"/path with spaces/server.js" "--traces" "https://example.com/%%u$$HOME"')
			assert.include(unit, 'Environment=NODE_ENV=production')
			assert.include(unit, 'UMask=0077')
			assert.isTrue(
				Array.some(
					yield* Ref.get(commands),
					args => Array.join(args, ' ') === 'systemctl --user restart deslop-fixture.service'
				)
			)
			assert.include(yield* change('status'), 'ActiveState=active')
			yield* fs.makeDirectory(`${home}/.deslop/fixture`, {recursive: true})
			yield* fs.writeFileString(`${home}/.deslop/fixture/data`, 'keep')
			yield* change('uninstall')
			assert.isFalse(yield* fs.exists(`${home}/.config/systemd/user/deslop-fixture.service`))
			assert.strictEqual(yield* fs.readFileString(`${home}/.deslop/fixture/data`), 'keep')
		})
	)
})

it('quotes systemd specifiers, dollar expansion and injected lines as literal argument data', () => {
	assert.strictEqual(systemdArgument('a b%u$HOME"c\\d\n[Service]'), '"a b%%u$$HOME\\"c\\\\d\\n[Service]"')
})
