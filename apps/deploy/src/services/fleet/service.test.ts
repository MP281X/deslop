// @effect-diagnostics-next-line nodeBuiltinImport:off -- A real scoped loopback server proves the worker RPC transport.
import {createServer} from 'node:http'

import {NodeHttpClient, NodeHttpServer, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {ConfigProvider, Context, Effect, Layer, Ref, Schema, pipe} from 'effect'

import {HttpRouter, HttpServer} from 'effect/http'
import {RpcServer} from 'effect/rpc'
import {TestClock} from 'effect/testing'

import {Auth} from '@deslop/runtime/auth/service'
import {DEVELOPER} from '@deslop/runtime/auth/utils'
import * as ServerRuntime from '@deslop/runtime/server'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Exposures} from '#services/exposures/service.ts'
import {Fleet} from '#services/fleet/service.ts'
import {DeployError, InventoryItem, Snapshot, Worker} from '#services/inventory/schema.ts'
import {Inventory} from '#services/inventory/service.ts'
import {MachineHistory, Sample} from '#services/metrics/schema.ts'
import {Metrics} from '#services/metrics/service.ts'

it.layer(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerFetch))('Worker RPC', test => {
	test.effect('merges one service view, keeps remote identity stable and marks failed snapshots stale', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const unavailable = yield* Ref.make(false)
				const item = InventoryItem.make({
					detail: 'fixture',
					id: 'worker:user:scope.service',
					kind: 'service',
					name: 'scope.service',
					state: 'active',
					url: '',
					worker: 'worker'
				})
				const snapshot = Snapshot.make({items: [item], sources: [], time: 123})
				const history = MachineHistory.make({
					cpuModel: 'Fixture CPU',
					error: '',
					samples: [Sample.make({disks: [], memoryTotal: 1024, memoryUsed: 512, swapTotal: 0, swapUsed: 0, time: 0})],
					stale: false,
					time: 0,
					worker: 'worker'
				})
				const group = RpcContracts.omit('deploy.inventory', 'deploy.metrics', 'deploy.expose', 'deploy.hide')
				const server = yield* Layer.build(
					pipe(
						HttpRouter.serve(
							pipe(
								RpcServer.layerHttp({group, path: '/api/rpc', protocol: 'websocket'}),
								Layer.provide(
									group.toLayer({
										'deploy.history': () =>
											Effect.flatMap(Ref.get(unavailable), failed => {
												if (failed) return Effect.fail(DeployError.make({message: 'worker unavailable'}))
												return Effect.succeed(history)
											}),
										'deploy.snapshot': () =>
											Effect.flatMap(Ref.get(unavailable), failed => {
												if (failed) return Effect.fail(DeployError.make({message: 'worker unavailable'}))
												return Effect.succeed(snapshot)
											})
									})
								),
								Layer.provide(
									Layer.succeedContext(
										Auth.makeContext(
											Auth.of({access: () => Effect.succeed(DEVELOPER), user: () => Effect.succeed(DEVELOPER)})
										)
									)
								)
							)
						),
						Layer.provide(ServerRuntime.layer('fixture')),
						Layer.provideMerge(NodeHttpServer.layer(createServer, {host: '127.0.0.1', port: 0}))
					)
				)
				const url = HttpServer.formatAddress(Context.get(server, HttpServer.HttpServer).address)
				const fleet = Context.get(
					yield* Layer.build(
						pipe(
							Fleet.layer,
							Layer.provide(Layer.succeed(Metrics, {read: () => Effect.succeed(history)})),
							Layer.provide(
								Layer.succeed(Inventory, {snapshot: Effect.succeed(Snapshot.make({items: [], sources: [], time: 0}))})
							),
							Layer.provide(
								Layer.succeed(Exposures, {
									expose: () => Effect.fail(DeployError.make({message: 'read only'})),
									hide: () => Effect.fail(DeployError.make({message: 'read only'})),
									items: Effect.succeed([])
								})
							),
							Layer.provide(
								ConfigProvider.layer(
									ConfigProvider.fromUnknown({
										DEPLOY_WORKERS: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Worker)))([
											{auth: '', name: 'desktop', url}
										])
									})
								)
							)
						)
					),
					Fleet
				)
				const current = yield* fleet.snapshot
				assert.strictEqual(current.items[0]?.id, 'remote:desktop:worker:user:scope.service')
				assert.strictEqual(current.items[0]?.worker, 'desktop')
				const currentMetrics = yield* fleet.metrics({hours: 1})
				assert.strictEqual(currentMetrics[1]?.worker, 'desktop')
				assert.strictEqual(currentMetrics[1]?.cpuModel, 'Fixture CPU')
				yield* Ref.set(unavailable, true)
				const staleMetrics = yield* fleet.metrics({hours: 1})
				assert.isTrue(staleMetrics[1]?.stale)
				assert.strictEqual(staleMetrics[1]?.cpuModel, 'Fixture CPU')
				assert.lengthOf(staleMetrics[1]?.samples ?? [], 1)
				assert.include(staleMetrics[1]?.error ?? '', 'worker unavailable')
				yield* TestClock.adjust('2 hours')
				assert.isEmpty((yield* fleet.metrics({hours: 1}))[1]?.samples ?? [])
				const stale = yield* fleet.snapshot
				assert.strictEqual(stale.items[0]?.id, current.items[0]?.id)
				assert.strictEqual(stale.items[0]?.state, 'stale · active')
				assert.include(stale.sources[0]?.error ?? '', 'worker unavailable')
			})
		)
	)
})
