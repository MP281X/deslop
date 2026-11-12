import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Context, Effect, FileSystem, Layer, Option, pipe} from 'effect'

import {SqlClient} from 'effect/sql'
import {TestClock} from 'effect/testing'

import {layerDataStore} from '@deslop/runtime/server/store'

import {DeployError} from '#services/inventory/schema.ts'
import {Metrics} from '#services/metrics/service.ts'

// Metrics started over the worker's data directory, as a restart opens the database it left; its scope ends when the read is done.
function restarted<A, E, R>(directory: string, use: (metrics: Metrics['Service']) => Effect.Effect<A, E, R>) {
	return Effect.scoped(
		Effect.flatMap(Layer.build(pipe(Metrics.layer, Layer.provide(layerDataStore(directory)))), context =>
			use(Context.get(context, Metrics))
		)
	)
}

// A statement on the worker's database, past the service.
function statement<A, E>(directory: string, run: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) {
	return Effect.scoped(
		Effect.flatMap(Layer.build(layerDataStore(directory)), context =>
			Effect.flatMap(Effect.provideContext(SqlClient.SqlClient, context), run)
		)
	)
}

// Each series' stored points.
function stored(directory: string) {
	return statement(
		directory,
		sql => sql<{since: number; step: number; time: number}>`SELECT step, since, time FROM samples ORDER BY step, since`
	)
}

it.layer(NodeServices.layer)('Resource history', test => {
	test.effect(
		'collects without a browser and restores real samples after a service restart',
		Effect.fnUntraced(function* () {
			const database = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const first = yield* restarted(database, metrics => metrics.read({minutes: 60}))
			assert.strictEqual(first.error, '')
			assert.isFalse(first.stale)
			assert.lengthOf(first.samples, 1)
			assert.isAbove(first.samples[0]?.memoryTotal ?? 0, 0)
			assert.isNotEmpty(first.cpuModel)
			assert.lengthOf(first.load, 3)
			yield* TestClock.adjust('90 seconds')
			const second = yield* restarted(database, metrics => metrics.read({minutes: 60}))
			assert.strictEqual(second.worker, first.worker)
			assert.lengthOf(second.samples, 2)
			assert.strictEqual(second.samples[0]?.time, first.samples[0]?.time)
			assert.strictEqual(second.samples[0]?.memoryUsed, first.samples[0]?.memoryUsed)
			assert.isTrue(Option.isNone(second.samples[1]?.cpu ?? Option.none()))
		})
	)
	test.effect(
		'joins each measurement into every series and deletes the points a series no longer keeps',
		Effect.fnUntraced(function* () {
			const database = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			// The tests share a clock; the buckets below start from the epoch.
			yield* TestClock.setTime(0)
			const first = yield* restarted(database, metrics => metrics.read({minutes: 60}))
			// One point in each of the five series.
			assert.deepStrictEqual(
				Array.map(yield* stored(database), row => row.step),
				[1000, 10_000, 60_000, 900_000, 3_600_000]
			)
			// Five seconds on, a second measurement is its own second but joins the same bucket of every coarser series.
			yield* TestClock.adjust('5 seconds')
			const seconds = yield* restarted(database, metrics => metrics.read({minutes: 1}))
			assert.lengthOf(seconds.samples, 2)
			assert.isTrue(Option.isNone(seconds.samples[1]?.cpu ?? Option.none()))
			assert.deepStrictEqual(
				Array.map(
					Array.filter(yield* stored(database), row => row.step === 10_000),
					row => [row.since, row.time]
				),
				[[0, 5000]]
			)
			yield* TestClock.adjust('35 seconds')
			yield* restarted(database, metrics => metrics.read({minutes: 1}))
			// Ninety seconds on, the hour's first minute keeps all three, and the seconds that aged past their minute are gone.
			yield* TestClock.adjust('50 seconds')
			const second = yield* restarted(database, metrics => metrics.read({minutes: 60}))
			assert.lengthOf(second.samples, 2)
			assert.strictEqual(second.samples[0]?.since, 0)
			assert.strictEqual(second.samples[0]?.time, 40_000)
			assert.strictEqual(second.samples[0]?.memoryTotal, first.samples[0]?.memoryTotal)
			assert.deepStrictEqual(
				Array.map(
					Array.filter(yield* stored(database), row => row.step === 1000),
					row => row.time
				),
				[40_000, 90_000]
			)
		})
	)
	test.effect(
		'fails the read with its error when a stored point does not decode',
		Effect.fnUntraced(function* () {
			const database = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const failure = yield* restarted(database, metrics =>
				Effect.gen(function* () {
					yield* statement(database, sql => sql`UPDATE samples SET apps = 'not json'`)
					return yield* Effect.flip(metrics.read({minutes: 60}))
				})
			)
			assert.instanceOf(failure, DeployError)
		})
	)
})
