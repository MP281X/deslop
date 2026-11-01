import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Boolean,
	ConfigProvider,
	Context,
	Effect,
	FileSystem,
	Layer,
	PlatformError,
	Ref,
	Schema,
	Sink,
	Stream,
	pipe
} from 'effect'

import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import {Exposures} from '#services/exposures/service.ts'
import type {Serve} from '#services/inventory/schema.ts'
import {Exposure} from '#services/inventory/schema.ts'

const row = Exposure.make({
	hostname: 'dev.tailnet-8c4c.ts.net',
	kind: 'tailnet',
	name: 'preview',
	port: 5173,
	publicAccess: false
})

it.layer(NodeServices.layer)('Owned exposures', test => {
	test.effect(
		'publishes a private port, refuses external changes and removes only its exact mapping',
		Effect.fnUntraced(function* () {
			const home = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const fs = yield* FileSystem.FileSystem
			const current = yield* Ref.make<Serve>({})
			const stopped = yield* Ref.make(0)
			const spawner = ChildProcessSpawner.make(command =>
				Effect.gen(function* () {
					if (!ChildProcess.isStandardCommand(command)) return yield* Effect.die('Unexpected pipeline')
					if (Array.contains(command.args, '--bg')) {
						yield* Ref.set(current, {
							TCP: {'5173': {}},
							Web: {'dev.tailnet-8c4c.ts.net:5173': {Handlers: {'/': {Proxy: 'http://127.0.0.1:5173'}}}}
						})
					}
					if (Array.contains(command.args, 'off')) {
						yield* Ref.update(stopped, n => n + 1)
						yield* Ref.set(current, {})
					}
					const text = yield* pipe(
						Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(
							yield* Boolean.match(Array.contains(command.args, 'serve'), {
								onFalse: () =>
									Effect.succeed({
										Self: {
											DNSName: 'dev.tailnet-8c4c.ts.net.',
											HostName: 'dev',
											OS: 'linux',
											Online: true,
											TailscaleIPs: []
										}
									}),
								onTrue: () => Ref.get(current)
							})
						),
						Effect.mapError(cause => PlatformError.badArgument({cause, method: 'encode', module: 'fixture'}))
					)
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
						stdout: Stream.make(new TextEncoder().encode(text)),
						unref: Effect.succeed(Effect.void)
					})
				})
			)
			const exposures = Context.get(
				yield* Layer.build(
					pipe(
						Exposures.layer,
						Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
						Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({DEPLOY_DATA: `${home}/deploy`, HOME: home})))
					)
				),
				Exposures
			)
			assert.isTrue((yield* Effect.result(exposures.expose({...row, kind: 'public'})))._tag === 'Failure')
			assert.strictEqual(yield* exposures.expose(row), 'https://dev.tailnet-8c4c.ts.net:5173')
			const owned = yield* Ref.get(current)
			assert.isTrue((yield* Effect.result(exposures.expose({...row, name: 'duplicate'})))._tag === 'Failure')
			yield* Ref.set(current, {
				TCP: {'5173': {}},
				Web: {'dev.tailnet-8c4c.ts.net:5173': {Handlers: {'/': {Proxy: 'http://127.0.0.1:9999'}}}}
			})
			assert.isTrue((yield* Effect.result(exposures.hide(row.name)))._tag === 'Failure')
			assert.strictEqual(yield* Ref.get(stopped), 0)
			yield* Ref.set(current, {...owned, AllowFunnel: {'dev.tailnet-8c4c.ts.net:5173': true}})
			assert.isTrue((yield* Effect.result(exposures.hide(row.name)))._tag === 'Failure')
			assert.strictEqual(yield* Ref.get(stopped), 0)
			yield* Ref.set(current, owned)
			yield* exposures.hide(row.name)
			assert.strictEqual(yield* Ref.get(stopped), 1)
			assert.deepStrictEqual(yield* exposures.items, [])
			yield* exposures.expose({...row, hostname: 'preview.example.com', kind: 'public', publicAccess: true})
			const configuration = yield* fs.readFileString(`${home}/deploy/Caddyfile`)
			assert.include(configuration, 'admin 127.0.0.1:20219')
			assert.include(configuration, 'preview.example.com {\n\treverse_proxy 127.0.0.1:5173')
			assert.notInclude(configuration, row.hostname)
			yield* exposures.expose({
				...row,
				hostname: 'second.example.com',
				kind: 'public',
				name: 'public:second.example.com',
				publicAccess: true
			})
			assert.include(
				yield* fs.readFileString(`${home}/deploy/Caddyfile`),
				'second.example.com {\n\treverse_proxy 127.0.0.1:5173'
			)
			assert.include(
				yield* fs.readFileString(`${home}/deploy/Caddyfile`),
				'preview.example.com {\n\treverse_proxy 127.0.0.1:5173'
			)
			yield* exposures.hide('public:second.example.com')
			yield* exposures.hide(row.name)
		})
	)
})
