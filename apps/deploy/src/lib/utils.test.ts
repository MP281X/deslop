// oxlint-disable-next-line effecttsgo/node-builtin-import -- Exercise the real atom protocol with a scoped loopback server.
import {createServer} from 'node:http'

import {NodeHttpServer, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Context, Effect, Fiber, Layer, Match, Option, Queue, Stream, pipe} from 'effect'

import {HttpRouter, HttpServer, HttpServerResponse} from 'effect/http'
import {AsyncResult, AtomRegistry} from 'effect/reactivity'
import type {Atom} from 'effect/reactivity'

import {Auth} from '@deslop/runtime/auth/service'
import {DEVELOPER} from '@deslop/runtime/auth/utils'
import * as ServerRuntime from '@deslop/runtime/server'

import {metricsAtom, minutesAtom} from '#lib/utils.ts'
import {RpcContracts} from '#rpcs/contracts.ts'
import {DeployError, Snapshot} from '#services/inventory/schema.ts'
import {MachineHistory} from '#services/metrics/schema.ts'

it.layer(NodeServices.layer)(test => {
	test.effect('keeps the last loaded range across superseded requests and a failed replacement', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const opened = yield* Queue.unbounded<number>()
				const closed = yield* Queue.unbounded<number>()
				const hour = yield* Queue.unbounded<MachineHistory[]>()
				const minute = yield* Queue.unbounded<MachineHistory[]>()
				const handlers = RpcContracts.toLayer({
					'deploy.expose': () => Effect.succeed(''),
					'deploy.hide': () => Effect.void,
					'deploy.history': () => Effect.never,
					'deploy.inventory': () => Stream.never,
					'deploy.metrics': query => {
						const source = pipe(
							Match.value(query.minutes),
							Match.when(60, () => Stream.fromQueue(hour)),
							Match.when(1, () => Stream.fromQueue(minute)),
							Match.orElse(() => Stream.never)
						)
						return pipe(
							Stream.unwrap(
								Effect.as(
									Effect.acquireRelease(Queue.offer(opened, query.minutes), () => Queue.offer(closed, query.minutes)),
									source
								)
							),
							Stream.mapEffect(values => {
								if (Array.isArrayEmpty(values)) return DeployError.make({message: 'Range unavailable'})
								return Effect.succeed(values)
							})
						)
					},
					'deploy.run': () => Effect.void,
					'deploy.snapshot': () => Effect.succeed(Snapshot.make({items: [], sources: [], time: 1}))
				})
				const context = yield* Layer.build(
					pipe(
						HttpRouter.serve(
							pipe(
								Layer.mergeAll(
									ServerRuntime.layerRpc({group: RpcContracts, handlers}),
									HttpRouter.add(
										'GET',
										'/api/runtime',
										HttpServerResponse.jsonUnsafe({name: 'deploy', traces: '', version: '0.1.0'})
									)
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
						Layer.provide(ServerRuntime.layerProtocol),
						Layer.provideMerge(NodeHttpServer.layer(createServer, {host: '127.0.0.1', port: 0}))
					)
				)
				const origin = HttpServer.formatAddress(Context.get(context, HttpServer.HttpServer).address)
				/* oxlint-disable no-restricted-globals, no-restricted-properties -- Node has no browser origin; scope the real client's origin to the loopback fixture. */
				const previous = Object.getOwnPropertyDescriptor(globalThis, 'location')
				yield* Effect.acquireRelease(
					Effect.sync(() => Object.defineProperty(globalThis, 'location', {configurable: true, value: {origin}})),
					() =>
						Effect.sync(() => {
							if (previous === undefined) Reflect.deleteProperty(globalThis, 'location')
							else Object.defineProperty(globalThis, 'location', previous)
						})
				)
				/* oxlint-enable no-restricted-globals, no-restricted-properties */
				const registry = yield* Effect.acquireRelease(
					Effect.sync(() => AtomRegistry.make()),
					value => Effect.sync(() => value.dispose())
				)
				const updates = yield* Queue.unbounded<Atom.Type<typeof metricsAtom>>()
				yield* Effect.acquireRelease(
					Effect.sync(() =>
						registry.subscribe(
							metricsAtom,
							value => {
								Queue.offerUnsafe(updates, value)
							},
							{immediate: true}
						)
					),
					unsubscribe => Effect.sync(unsubscribe)
				)
				assert.strictEqual(yield* Queue.take(opened), 60)
				const sample = MachineHistory.make({error: '', samples: [], stale: false, time: 1, worker: 'desktop'})
				yield* Queue.offer(hour, [sample])
				yield* pipe(Stream.fromQueue(updates), Stream.filter(AsyncResult.isSuccess), Stream.runHead)
				assert.deepStrictEqual(Option.getOrThrow(AsyncResult.value(registry.get(metricsAtom))), {
					histories: [sample],
					minutes: 60
				})
				registry.set(minutesAtom, 10)
				assert.strictEqual(yield* Queue.take(opened), 10)
				registry.set(minutesAtom, 1)
				assert.strictEqual(yield* Queue.take(opened), 1)
				assert.deepStrictEqual([yield* Queue.take(closed), yield* Queue.take(closed)], [60, 10])
				assert.strictEqual(Option.getOrThrow(AsyncResult.value(registry.get(metricsAtom))).minutes, 60)
				yield* Queue.offer(minute, [sample])
				yield* pipe(
					Stream.fromQueue(updates),
					Stream.filter(value => Option.exists(AsyncResult.value(value), loaded => loaded.minutes === 1)),
					Stream.runHead
				)
				assert.strictEqual(Option.getOrThrow(AsyncResult.value(registry.get(metricsAtom))).minutes, 1)
				const failed = yield* Effect.forkChild(
					pipe(Stream.fromQueue(updates), Stream.filter(AsyncResult.isFailure), Stream.runHead)
				)
				yield* Queue.offer(minute, [])
				assert.isTrue(Option.isSome(yield* Fiber.join(failed)))
				assert.strictEqual(Option.getOrThrow(AsyncResult.value(registry.get(metricsAtom))).minutes, 1)
			})
		)
	)
})
