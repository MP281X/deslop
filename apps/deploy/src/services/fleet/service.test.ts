// oxlint-disable-next-line effecttsgo/node-builtin-import -- A real scoped loopback server proves the worker RPC transport.
import {createServer} from 'node:http'

import {NodeCrypto, NodeHttpClient, NodeHttpServer, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	ConfigProvider,
	Context,
	DateTime,
	Deferred,
	Duration,
	Effect,
	Fiber,
	Layer,
	Option,
	Ref,
	Schema,
	pipe
} from 'effect'

import {HttpRouter, HttpServer} from 'effect/http'
import {TestClock} from 'effect/testing'

import {Auth} from '@deslop/runtime/server/auth'
import {layerServerProtocol, layerRpc} from '@deslop/runtime/server/http'
import {AuthError} from '@deslop/runtime/shared/auth'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Exposures} from '#services/exposures/service.ts'
import {Fleet, layerPeerAuth} from '#services/fleet/service.ts'
import {DeployError, InventoryItem, Snapshot} from '#services/inventory/schema.ts'
import {Inventory} from '#services/inventory/service.ts'
import {MachineHistory} from '#services/metrics/schema.ts'
import {Metrics} from '#services/metrics/service.ts'

it.layer(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerFetch, NodeCrypto.layer))('Worker RPC', test => {
	test.effect('shares a peer connection and leaves the last snapshot unchanged during outages', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const unavailable = yield* Ref.make(false)
				const hanging = yield* Ref.make(false)
				const entered = yield* Deferred.make<void>()
				const item = yield* Schema.decodeEffect(InventoryItem)({
					active: true,
					detail: 'fixture',
					health: 'quiet',
					id: 'worker:user:scope.service',
					kind: 'service',
					name: 'scope.service',
					running: true,
					state: 'active',
					url: '',
					worker: 'worker'
				})
				const snapshot = Snapshot.make({items: [item], sources: [], time: DateTime.makeUnsafe(123), workers: []})
				const history = yield* Schema.decodeEffect(MachineHistory)({
					disks: [],
					error: '',
					load: [],
					samples: [{memoryTotal: 1024, memoryUsed: 512, since: 0, step: 60_000, time: 0}],
					stale: false,
					time: 0,
					worker: 'worker'
				})
				const group = RpcContracts.omit(
					'inventory.watch',
					'metrics.watch',
					'exposures.expose',
					'exposures.hide',
					'inventory.run'
				)
				const upgrades = {count: 0}
				const server = yield* Layer.build(
					pipe(
						HttpRouter.serve(
							pipe(
								layerRpc({
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
						Layer.provide(layerServerProtocol),
						Layer.provideMerge(
							NodeHttpServer.layer(
								() => {
									const http = createServer()
									http.on('upgrade', () => {
										upgrades.count += 1
									})
									return http
								},
								{host: '127.0.0.1', port: 0}
							)
						)
					)
				)
				const url = HttpServer.formatAddress(Context.get(server, HttpServer.HttpServer).address)
				const fleetWith = Effect.fnUntraced(function* (key: string) {
					return Context.get(
						yield* Layer.build(
							pipe(
								Fleet.layer,
								Layer.provide(
									Layer.succeed(Metrics, {
										read: () =>
											Effect.succeed({
												...history,
												disks: Array.fromIterable(history.disks),
												load: Array.fromIterable(history.load),
												samples: Array.fromIterable(history.samples)
											})
									})
								),
								Layer.provide(
									Layer.succeed(Inventory, {
										run: () => Effect.fail(DeployError.make({message: 'read only'})),
										snapshot: Effect.succeed(
											yield* Schema.decodeEffect(Snapshot)({items: [], sources: [], time: 0, workers: []})
										)
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
				assert.deepStrictEqual((yield* Schema.encodeEffect(Snapshot)(current)).workers, ['desktop'])
				assert.strictEqual(current.items[0]?.id, 'desktop:worker:user:scope.service')
				assert.strictEqual(current.items[0]?.worker, 'desktop')
				const cold = yield* fleet.current({minutes: Duration.minutes(60)})
				assert.isTrue(Option.getOrThrow(Array.get(cold, 1)).stale)
				assert.isEmpty(Option.getOrThrow(Array.get(cold, 1)).samples)
				// An offline worker's empty history still encodes.
				assert.doesNotThrow(() => {
					Schema.encodeSync(Schema.Array(MachineHistory))(cold)
				})
				const currentMetrics = yield* fleet.metrics({minutes: Duration.minutes(60)})
				assert.strictEqual(
					Option.getOrThrow(Array.get(yield* fleet.current({minutes: Duration.minutes(60)}), 1)).worker,
					'desktop'
				)
				assert.strictEqual(currentMetrics[1]?.worker, 'desktop')
				assert.strictEqual(upgrades.count, 1)
				yield* Ref.set(hanging, true)
				const pending = yield* Effect.forkScoped(fleet.metrics({minutes: Duration.minutes(60)}))
				yield* Deferred.await(entered)
				yield* TestClock.adjust('2 seconds')
				assert.isTrue(Option.getOrThrow(Array.get(yield* Fiber.join(pending), 1)).stale)
				yield* Ref.set(hanging, false)
				yield* Ref.set(unavailable, true)
				// A worker that failed before its first sample still encodes.
				const uncached = yield* (yield* fleetWith('shared-key')).metrics({minutes: Duration.minutes(60)})
				assert.doesNotThrow(() => {
					Schema.encodeSync(Schema.Array(MachineHistory))(uncached)
				})
				const staleMetrics = yield* fleet.metrics({minutes: Duration.minutes(60)})
				assert.isTrue(staleMetrics[1]?.stale)
				assert.lengthOf(staleMetrics[1].samples, 1)
				assert.include(Option.getOrThrow(staleMetrics[1].error), 'worker unavailable')
				yield* TestClock.adjust('2 hours')
				assert.isEmpty((yield* fleet.metrics({minutes: Duration.minutes(60)}))[1]?.samples ?? [])
				assert.include(
					Option.getOrThrow((yield* (yield* fleetWith('another-key')).snapshot).sources[0]?.error ?? Option.none()),
					'Sign in first'
				)
				const stale = yield* fleet.snapshot
				assert.strictEqual(stale.items[0]?.id, current.items[0]?.id)
				assert.strictEqual(stale.items[0]?.state, 'active')
				assert.strictEqual(stale.sources[0]?.name, 'desktop · Snapshot')
				assert.include(Option.getOrThrow(stale.sources[0]?.error ?? Option.none()), 'worker unavailable')
			})
		)
	)
})
