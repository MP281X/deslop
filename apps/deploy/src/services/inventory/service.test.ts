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
	Match,
	MutableList,
	Option,
	Schema,
	Sink,
	Stream,
	String,
	pipe
} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import type {Headers} from 'effect/http'
import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import {DeployError, Snapshot, UnitId} from '#services/inventory/schema.ts'
import {Inventory} from '#services/inventory/service.ts'

it.layer(NodeServices.layer)('Inventory', test => {
	test.effect(
		'retains listeners and service results when Docker is unavailable, without claiming reachability',
		Effect.fnUntraced(function* () {
			const spawner = ChildProcessSpawner.make(command =>
				Effect.gen(function* () {
					if (!ChildProcess.isStandardCommand(command)) return yield* Effect.die('Unexpected pipeline')
					return ChildProcessSpawner.makeHandle({
						all: Stream.empty,
						exitCode: Effect.succeed(
							ChildProcessSpawner.ExitCode(
								Boolean.match(command.command === 'docker', {onFalse: () => 0, onTrue: () => 1})
							)
						),
						getInputFd: () => Sink.drain,
						getOutputFd: () => Stream.empty,
						isRunning: Effect.succeed(false),
						kill: () => Effect.void,
						pid: ChildProcessSpawner.ProcessId(1),
						stderr: Stream.make(new TextEncoder().encode('permission denied')),
						stdin: Sink.drain,
						stdout: Stream.make(
							new TextEncoder().encode(
								pipe(
									Match.value(command.command),
									Match.when(
										'ss',
										() =>
											'tcp LISTEN 0 4096 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=42,fd=3))\nudp UNCONN 0 0 [::]:5353 [::]:*'
									),
									Match.when('systemctl', () => '[]'),
									Match.when('tailscale', () =>
										Boolean.match(command.args[0] === 'serve', {
											onFalse: () =>
												'{"Self":{"DNSName":"dev.tailnet.ts.net.","HostName":"dev","OS":"linux","Online":true,"TailscaleIPs":["100.1.2.3"]}}',
											onTrue: () =>
												'{"AllowFunnel":{"dev.tailnet.ts.net:5173":true},"Web":{"dev.tailnet.ts.net:5173":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:5173"},"/files":{}}}}}'
										})
									),
									Match.orElse(() => '{}')
								)
							)
						),
						unref: Effect.succeed(Effect.void)
					})
				})
			)
			const probes = MutableList.make<Headers.Headers>()
			const inventory = Context.get(
				yield* Layer.build(
					pipe(
						Inventory.layer,
						Layer.provide(
							Layer.succeed(
								HttpClient.HttpClient,
								HttpClient.make(request => {
									MutableList.append(probes, request.headers)
									return Effect.succeed(
										HttpClientResponse.fromWeb(
											request,
											new Response(undefined, {headers: {'content-type': 'text/html'}})
										)
									)
								})
							)
						),
						Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
						Layer.provide(
							FileSystem.layerNoop({
								readFileString: name =>
									Effect.succeed(
										Boolean.match(name === '/proc/sys/kernel/hostname', {
											onFalse: () =>
												'0::/user.slice/user-1000.slice/user@1000.service/app.slice/preview-fixture.service',
											onTrue: () => 'dev\n'
										})
									),
								readLink: () => Effect.succeed('/worktree/apps/fixture')
							})
						),
						Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({HOSTNAME: 'dev'})))
					)
				),
				Inventory
			)
			const snapshot = yield* Schema.encodeEffect(Snapshot)(yield* inventory.snapshot)
			const probed = MutableList.toArray(probes)
			assert.isNotEmpty(probed)
			assert.isTrue(
				Array.every(probed, headers =>
					Option.isSome(String.match(/^00-[\da-f]{32}-[\da-f]{16}-00$/u)(headers['traceparent'] ?? ''))
				)
			)
			assert.deepStrictEqual(
				pipe(
					snapshot.items,
					Array.filter(item => item.kind === 'port'),
					Array.map(item => [item.name, item.state, item.url])
				),
				[
					['127.0.0.1:5173', 'LISTEN', ''],
					['[::]:5353', 'UNCONN', '']
				]
			)
			assert.isTrue(Array.some(snapshot.sources, source => source.name === 'Docker' && source.error !== ''))
			assert.isTrue(Array.some(snapshot.sources, source => source.name === 'User services' && source.error === ''))
			assert.deepStrictEqual(
				pipe(
					snapshot.items,
					Array.filter(item => item.kind === 'port'),
					Array.map(item => [item.port, item.protocol, item.process])
				),
				[
					[5173, 'tcp', 'fixture'],
					[5353, 'udp', '']
				]
			)
			assert.isTrue(Array.some(snapshot.items, item => item.self === true && item.hostname === 'dev.tailnet.ts.net'))
			assert.isTrue(
				Array.some(
					snapshot.items,
					item =>
						item.kind === 'exposure' &&
						item.port === 5173 &&
						item.url === 'https://dev.tailnet.ts.net:5173/' &&
						item.owned === false
				)
			)
			assert.isTrue(Array.some(snapshot.items, item => String.endsWith('/files')(item.url) && item.port === undefined))
			assert.isTrue(
				Array.some(
					snapshot.items,
					item =>
						item.kind === 'exposure' &&
						item.publicAccess === true &&
						String.startsWith('Funnel permitted (public)')(item.detail)
				)
			)
			// Run now starts only what a timer starts, never an arbitrary unit.
			assert.instanceOf(
				yield* Effect.flip(inventory.run({name: UnitId.make('sshd.service'), scope: 'system'})),
				DeployError
			)
		})
	)
})
