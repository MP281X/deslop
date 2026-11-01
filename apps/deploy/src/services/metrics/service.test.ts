import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {ConfigProvider, Context, Deferred, Effect, FileSystem, Layer, PlatformError, Ref, String, pipe} from 'effect'

import {TestClock} from 'effect/testing'

import {Metrics} from '#services/metrics/service.ts'

it.layer(NodeServices.layer)('Resource history', test => {
	test.effect(
		'collects without a browser and restores real samples after a service restart',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const layer = pipe(
				Metrics.layer,
				Layer.provide(
					ConfigProvider.layer(ConfigProvider.fromUnknown({DEPLOY_DATA: yield* fs.makeTempDirectoryScoped()}))
				)
			)
			const first = yield* Effect.scoped(
				Effect.gen(function* () {
					const metrics = Context.get(yield* Layer.build(Layer.fresh(layer)), Metrics)
					return yield* metrics.read({hours: 1})
				})
			)
			assert.strictEqual(first.error, '')
			assert.isFalse(first.stale)
			assert.lengthOf(first.samples, 1)
			assert.isAbove(first.samples[0]?.memoryTotal ?? 0, 0)
			assert.isNotEmpty(first.cpuModel ?? '')
			assert.isAbove(first.samples[0]?.cores?.length ?? 0, 0)
			assert.lengthOf(first.samples[0]?.load ?? [], 3)
			assert.isAbove(first.samples[0]?.uptime ?? 0, 0)
			yield* TestClock.adjust('30 seconds')
			const second = yield* Effect.scoped(
				Effect.gen(function* () {
					const metrics = Context.get(yield* Layer.build(Layer.fresh(layer)), Metrics)
					return yield* metrics.read({hours: 1})
				})
			)
			assert.strictEqual(second.worker, first.worker)
			assert.lengthOf(second.samples, 2)
			assert.deepStrictEqual(second.samples[0], first.samples[0])
			assert.isUndefined(second.samples[1]?.cpu)
		})
	)
	test.effect(
		'retries an uncommitted previous-hour bucket before reporting recovered persistence',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			const failed = yield* Ref.make(false)
			const persisted = yield* Deferred.make<void>()
			const layer = pipe(
				Metrics.layer,
				Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({DEPLOY_DATA: directory}))),
				Layer.provide(
					Layer.succeed(
						FileSystem.FileSystem,
						FileSystem.FileSystem.of({
							...fs,
							rename: Effect.fnUntraced(function* (from, to) {
								if (String.endsWith('/metrics-0')(to) && !(yield* Ref.get(failed))) {
									yield* Ref.set(failed, true)
									return yield* PlatformError.badArgument({
										description: 'Simulated disk failure',
										method: 'rename',
										module: 'fixture'
									})
								}
								yield* fs.rename(from, to)
								if (String.endsWith('/metrics-1')(to)) yield* Deferred.succeed(persisted, undefined)
							})
						})
					)
				)
			)
			yield* TestClock.setTime(3_590_000)
			const first = yield* Effect.scoped(
				Effect.gen(function* () {
					const metrics = Context.get(yield* Layer.build(Layer.fresh(layer)), Metrics)
					const value = yield* metrics.read({hours: 1})
					assert.isNotEmpty(value.error)
					yield* TestClock.adjust('30 seconds')
					yield* Deferred.await(persisted)
					return value.samples[0]
				})
			)
			const restored = yield* Effect.scoped(
				Effect.gen(function* () {
					const metrics = Context.get(yield* Layer.build(Layer.fresh(layer)), Metrics)
					return yield* metrics.read({hours: 1})
				})
			)
			assert.strictEqual(restored.error, '')
			assert.deepStrictEqual(restored.samples[0], first)
			assert.lengthOf(restored.samples, 2)
		})
	)
})
