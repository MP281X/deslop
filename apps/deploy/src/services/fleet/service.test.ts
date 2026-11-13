import {createServer} from 'node:http'

import {NodeCrypto, NodeHttpClient, NodeHttpServer, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, ConfigProvider, Context, Deferred, Effect, Fiber, Layer, Option, Ref, Schema, pipe} from 'effect'

import {HttpRouter, HttpServer} from 'effect/http'
import {TestClock} from 'effect/testing'

import {Auth} from '@deslop/runtime/server/auth'
import * as ServerRuntime from '@deslop/runtime/server/http'
import {AuthError} from '@deslop/runtime/shared/auth'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Exposures} from '#services/exposures/service.ts'
import {Fleet, layerPeerAuth} from '#services/fleet/service.ts'
import {DeployError, InventoryItem, Snapshot} from '#services/inventory/schema.ts'
import {Inventory} from '#services/inventory/service.ts'
import {MachineHistory, Sample} from '#services/metrics/schema.ts'
import {Metrics} from '#services/metrics/service.ts'

it.layer(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerFetch, NodeCrypto.layer))('Worker RPC', test => {
	test.effect('merges one service view, keeps remote identity stable and marks failed snapshots stale', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const unavailable = yield* Ref.make(false)
				const hanging = yield* Ref.make(false)
				const entered = yield* Deferred.make<void>()
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
				const history = {
					cpuModel: 'Fixture CPU',
					disks: [],
					error: '',
					load: [],
					samples: [
						Sample.make({
							apps: Option.none(),
							cpu: Option.none(),
							memoryTotal: 1024,
							memoryUsed: 512,
							since: 0,
							step: 60_000,
							storageUsed: Option.none(),
							time: 0
						})
					],
					stale: false,
					time: 0,
					worker: 'worker'
				} satisfies MachineHistory
				const group = RpcContracts.omit(
					'inventory.watch',
					'metrics.watch',
					'exposures.expose',
					'exposures.hide',
					'inventory.run'
				)
				const server = yield* Layer.build(
					pipe(
						HttpRouter.serve(
							pipe(
								ServerRuntime.layerRpc({
									group,
									handlers: group.toLayer({
										'inventory.snapshot': () =>
											Effect.flatMap(Ref.get(unavailable), failed => {
												if (failed) return Effect.fail(DeployError.make({message: 'worker unavailable'}))
												return Effect.succeed(snapshot)
											}),
										'metrics.history': Effect.fnUntraced(function* () {
											if (yield* Ref.get(hanging)) {
												yield* Deferred.succeed(entered, undefined)
												return yield* Effect.never
											}
											if (yield* Ref.get(unavailable)) return yield* DeployError.make({message: 'worker unavailable'})
											return history
										})
									})
								}),
								// No person is signed in: only a worker holding the shared key gets through.
								Layer.provide(layerPeerAuth),
								Layer.provide(
									Layer.succeedContext(
										Auth.makeContext(
											Auth.of({
												token: () => Effect.fail(AuthError.make({message: 'Sign in first'})),
												user: () => Effect.fail(AuthError.make({message: 'Sign in first'}))
											})
										)
									)
								),
								Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({DEPLOY_KEY: 'shared-key'})))
							)
						),
						Layer.provide(ServerRuntime.layerProtocol),
						Layer.provideMerge(NodeHttpServer.layer(createServer, {host: '127.0.0.1', port: 0}))
					)
				)
				const url = HttpServer.formatAddress(Context.get(server, HttpServer.HttpServer).address)
				const fleetWith = Effect.fnUntraced(function* (key: string) {
					return Context.get(
						yield* Layer.build(
							pipe(
								Fleet.layer,
								Layer.provide(Layer.succeed(Metrics, {read: () => Effect.succeed(history)})),
								Layer.provide(
									Layer.succeed(Inventory, {
										run: () => Effect.fail(DeployError.make({message: 'read only'})),
										snapshot: Effect.succeed(Snapshot.make({items: [], sources: [], time: 0}))
									})
								),
								Layer.provide(
									Layer.succeed(Exposures, {
										expose: () => Effect.fail(DeployError.make({message: 'read only'})),
										hide: () => Effect.fail(DeployError.make({message: 'read only'})),
										items: Effect.succeed([])
									})
								),
								Layer.provide(
									ConfigProvider.layer(ConfigProvider.fromUnknown({DEPLOY_KEY: key, DEPLOY_WORKERS: `desktop=${url}`}))
								)
							)
						),
						Fleet
					)
				})
				const fleet = yield* fleetWith('shared-key')
				const current = yield* fleet.snapshot
				assert.deepStrictEqual(current.workers, ['desktop'])
				assert.strictEqual(current.items[0]?.id, 'remote:desktop:worker:user:scope.service')
				assert.strictEqual(current.items[0]?.worker, 'desktop')
				const cold = yield* fleet.current({minutes: 60})
				assert.isTrue(Option.getOrThrow(Array.get(cold, 1)).stale)
				assert.isEmpty(Option.getOrThrow(Array.get(cold, 1)).samples)
				// A worker with no cached history has no cpuModel to name, and the metrics response still encodes.
				assert.doesNotThrow(() => {
					Schema.encodeSync(Schema.Array(MachineHistory))(cold)
				})
				const currentMetrics = yield* fleet.metrics({minutes: 60})
				const immediate = yield* fleet.current({minutes: 60})
				assert.strictEqual(Option.getOrThrow(Array.get(immediate, 1)).worker, 'desktop')
				assert.strictEqual(Option.getOrThrow(Array.get(immediate, 1)).cpuModel, 'Fixture CPU')
				assert.strictEqual(currentMetrics[1]?.worker, 'desktop')
				assert.strictEqual(currentMetrics[1]?.cpuModel, 'Fixture CPU')
				yield* Ref.set(hanging, true)
				const pending = yield* Effect.forkScoped(fleet.metrics({minutes: 60}))
				yield* Deferred.await(entered)
				yield* TestClock.adjust('2 seconds')
				const timedOut = yield* Fiber.join(pending)
				assert.isTrue(Option.getOrThrow(Array.get(timedOut, 1)).stale)
				assert.strictEqual(Option.getOrThrow(Array.get(timedOut, 1)).cpuModel, 'Fixture CPU')
				yield* Ref.set(hanging, false)
				yield* Ref.set(unavailable, true)
				// A worker that failed before its first sample has no cpuModel to name, and the response still encodes.
				const uncached = yield* (yield* fleetWith('shared-key')).metrics({minutes: 60})
				assert.doesNotThrow(() => {
					Schema.encodeSync(Schema.Array(MachineHistory))(uncached)
				})
				const staleMetrics = yield* fleet.metrics({minutes: 60})
				assert.isTrue(staleMetrics[1]?.stale)
				assert.strictEqual(staleMetrics[1].cpuModel, 'Fixture CPU')
				assert.lengthOf(staleMetrics[1].samples, 1)
				assert.include(staleMetrics[1].error, 'worker unavailable')
				yield* TestClock.adjust('2 hours')
				assert.isEmpty((yield* fleet.metrics({minutes: 60}))[1]?.samples ?? [])
				assert.include((yield* (yield* fleetWith('another-key')).snapshot).sources[0]?.error ?? '', 'Sign in first')
				const stale = yield* fleet.snapshot
				assert.strictEqual(stale.items[0]?.id, current.items[0]?.id)
				assert.strictEqual(stale.items[0]?.state, 'stale · active')
				assert.strictEqual(stale.sources[0]?.name, 'desktop · Snapshot')
				assert.include(stale.sources[0]?.error ?? '', 'worker unavailable')
			})
		)
	)
})
