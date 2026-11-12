import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Context, Effect, FileSystem, Layer, PlatformError, Ref, Schema, String, pipe} from 'effect'

import {TestClock} from 'effect/testing'

import {layerKeyValueStore} from '@deslop/runtime/server/store'

import {Sample} from '#services/metrics/schema.ts'
import {Metrics} from '#services/metrics/service.ts'

it.layer(NodeServices.layer)('Resource history', test => {
	test.effect(
		'collects without a browser and restores real samples after a service restart',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const layer = Layer.provide(Metrics.layer, layerKeyValueStore(yield* fs.makeTempDirectoryScoped()))
			const first = yield* Effect.scoped(
				Effect.gen(function* () {
					const metrics = Context.get(yield* Layer.build(Layer.fresh(layer)), Metrics)
					return yield* metrics.read({minutes: 60})
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
			yield* TestClock.adjust('90 seconds')
			const second = yield* Effect.scoped(
				Effect.gen(function* () {
					const metrics = Context.get(yield* Layer.build(Layer.fresh(layer)), Metrics)
					return yield* metrics.read({minutes: 60})
				})
			)
			assert.strictEqual(second.worker, first.worker)
			assert.lengthOf(second.samples, 2)
			assert.strictEqual(second.samples[0]?.time, first.samples[0]?.time)
			assert.strictEqual(second.samples[0]?.memoryUsed, first.samples[0]?.memoryUsed)
			assert.isEmpty(second.samples[0]?.disks ?? [])
			assert.isUndefined(second.samples[1]?.cpu)
		})
	)
	test.effect(
		'retries an uncommitted previous-hour bucket before reporting recovered persistence',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			const failed = yield* Ref.make(false)
			const layer = pipe(
				Metrics.layer,
				Layer.provide(layerKeyValueStore(directory)),
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
							})
						})
					)
				)
			)
			yield* TestClock.setTime(3_590_000)
			// The failed save is reported; seconds keep landing across the hour, and shutdown saves the bucket again.
			const first = yield* Effect.scoped(
				Effect.gen(function* () {
					const metrics = Context.get(yield* Layer.build(Layer.fresh(layer)), Metrics)
					const value = yield* metrics.read({minutes: 60})
					assert.isNotEmpty(value.error)
					yield* TestClock.adjust('30 seconds')
					return value.samples[0]
				})
			)
			const restored = yield* Effect.scoped(
				Effect.gen(function* () {
					const metrics = Context.get(yield* Layer.build(Layer.fresh(layer)), Metrics)
					return yield* metrics.read({minutes: 60})
				})
			)
			assert.strictEqual(restored.error, '')
			const saved = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.toCodecJson(Schema.Array(Sample))))(
				yield* fs.readFileString(`${directory}/metrics-0`)
			)
			assert.deepStrictEqual(saved[0], first)
			assert.isNotEmpty(restored.samples)
			assert.isAtLeast(restored.samples[0]?.time ?? 0, first?.time ?? 0)
		})
	)
})

it('decodes samples saved before the unused counters were removed', () => {
	const saved = Schema.decodeSync(Schema.fromJsonString(Sample))(
		'{"diskRead":1,"diskWrite":2,"disks":[],"memoryAvailable":3,"memoryBuffers":4,"memoryCached":5,"memoryTotal":1024,"memoryUsed":512,"networkReceive":6,"networkSend":7,"swapTotal":8,"swapUsed":9,"time":0}'
	)
	assert.strictEqual(saved.memoryUsed, 512)
})
