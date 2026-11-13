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

import {ToolPath} from '@deslop/runtime/server/process'
import {layerDataStore} from '@deslop/runtime/server/store'

import {ExposeInput} from '#services/exposures/schema.ts'
import {Exposures} from '#services/exposures/service.ts'
import type {Serve} from '#services/inventory/schema.ts'

const row = ExposeInput.make({
	hostname: 'dev.tailnet-8c4c.ts.net',
	kind: 'tailnet',
	name: 'preview',
	port: 5173,
	publicAccess: false
})

// A stand-in for `tailscale`: the serve mappings it holds, and how many it turned off.
const tailscale = Effect.gen(function* () {
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
			const text = yield* Effect.mapError(
				Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(
					yield* pipe(
						command.args,
						subject1604 => Array.contains(subject1604, 'serve'),
						pipelineSubject1580 =>
							Boolean.match(pipelineSubject1580, {
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
					)
				),
				cause => PlatformError.badArgument({cause, method: 'encode', module: 'fixture'})
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
	return {current, spawner, stopped}
})

// Exposures started over a home's data directory, as a restart opens the database it left.
function started(home: string, spawner: ChildProcessSpawner.ChildProcessSpawner['Service']) {
	return Effect.map(
		Layer.build(
			pipe(
				Exposures.layer(`${home}/deploy`),
				Layer.provide(Layer.succeed(ToolPath, name => Effect.succeed(`/fixture/tools/${name}`))),
				Layer.provide(layerDataStore(`${home}/deploy`)),
				Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
				Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({HOME: home})))
			)
		),
		Context.get(Exposures)
	)
}

it.layer(NodeServices.layer)('Owned exposures', test => {
	test.effect(
		'publishes a private port, refuses external changes and removes only its exact mapping',
		Effect.fnUntraced(function* () {
			const home = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const fs = yield* FileSystem.FileSystem
			const mappings = yield* tailscale
			const exposures = yield* started(home, mappings.spawner)
			assert.isTrue((yield* Effect.result(exposures.expose({...row, kind: 'public'})))._tag === 'Failure')
			assert.strictEqual(yield* exposures.expose(row), 'https://dev.tailnet-8c4c.ts.net:5173')
			const owned = yield* Ref.get(mappings.current)
			assert.isTrue((yield* Effect.result(exposures.expose({...row, name: 'duplicate'})))._tag === 'Failure')
			yield* Ref.set(mappings.current, {
				TCP: {'5173': {}},
				Web: {'dev.tailnet-8c4c.ts.net:5173': {Handlers: {'/': {Proxy: 'http://127.0.0.1:9999'}}}}
			})
			assert.isTrue((yield* Effect.result(exposures.hide(row.name)))._tag === 'Failure')
			assert.strictEqual(yield* Ref.get(mappings.stopped), 0)
			yield* Ref.set(mappings.current, {...owned, AllowFunnel: {'dev.tailnet-8c4c.ts.net:5173': true}})
			assert.isTrue((yield* Effect.result(exposures.hide(row.name)))._tag === 'Failure')
			assert.strictEqual(yield* Ref.get(mappings.stopped), 0)
			yield* Ref.set(mappings.current, owned)
			yield* exposures.hide(row.name)
			assert.strictEqual(yield* Ref.get(mappings.stopped), 1)
			assert.deepStrictEqual(yield* exposures.items, [])
			yield* exposures.expose({...row, hostname: 'preview.example.com', kind: 'public', publicAccess: true})
			const configuration = yield* fs.readFileString(`${home}/deploy/Caddyfile`)
			assert.include(configuration, 'admin 127.0.0.1:20219')
			assert.include(configuration, 'preview.example.com {\n\tencode\n\treverse_proxy 127.0.0.1:5173')
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
				'second.example.com {\n\tencode\n\treverse_proxy 127.0.0.1:5173'
			)
			assert.include(
				yield* fs.readFileString(`${home}/deploy/Caddyfile`),
				'preview.example.com {\n\tencode\n\treverse_proxy 127.0.0.1:5173'
			)
			yield* exposures.hide('public:second.example.com')
			yield* exposures.hide(row.name)
		})
	)
	test.effect(
		'keeps ownership across a restart, so the mapping stays removable',
		Effect.fnUntraced(function* () {
			const home = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const mappings = yield* tailscale
			yield* (yield* started(home, mappings.spawner)).expose(row)
			const restarted = yield* started(home, mappings.spawner)
			assert.deepStrictEqual(
				Array.map(yield* restarted.items, item => [item.name, item.url]),
				[['preview', 'https://dev.tailnet-8c4c.ts.net:5173']]
			)
			yield* restarted.hide(row.name)
			assert.strictEqual(yield* Ref.get(mappings.stopped), 1)
			assert.deepStrictEqual(yield* (yield* started(home, mappings.spawner)).items, [])
		})
	)
})
