import {
	Array,
	Clock,
	Config,
	Context,
	Effect,
	FileSystem,
	Layer,
	Number,
	Option,
	Order,
	Path,
	Ref,
	Schedule,
	Schema,
	String,
	pipe
} from 'effect'

import {KeyValueStore} from 'effect/persistence'

import {layerKeyValueStore} from '@deslop/runtime/server'
import {execute} from '@deslop/runtime/service'

import {counters, history, sample} from '#services/metrics/lib/utils.ts'
import {Counters, MachineHistory, Sample} from '#services/metrics/schema.ts'
import type {HistoryQuery} from '#services/metrics/schema.ts'

export class Metrics extends Context.Service<
	Metrics,
	{readonly read: (query: HistoryQuery) => Effect.Effect<MachineHistory>}
>()('@deslop/deploy/services/metrics/service/Metrics') {
	static readonly layer = Layer.unwrap(
		Effect.gen(function* () {
			const path = yield* Path.Path
			const directory = yield* pipe(
				Config.String('DEPLOY_DATA'),
				Config.orElse(() => Config.map(Config.String('HOME'), home => path.join(home, '.deslop', 'deploy')))
			)
			return pipe(
				Layer.effect(
					Metrics,
					Effect.gen(function* () {
						const fs = yield* FileSystem.FileSystem
						const worker = String.trim(yield* fs.readFileString('/proc/sys/kernel/hostname'))
						const base = yield* KeyValueStore.KeyValueStore
						const store = KeyValueStore.toSchemaStore(base, Schema.Array(Sample))
						const now = yield* Clock.currentTimeMillis
						const saved = yield* Effect.forEach(
							Array.filter(
								yield* base.keys,
								key => String.startsWith('metrics-')(key) && !String.endsWith('.tmp')(key)
							),
							key =>
								pipe(
									store.get(key),
									Effect.orElseSucceed(() => Option.none())
								),
							{concurrency: 8}
						)
						const state = yield* Ref.make(
							Array.sort(
								Array.filter(Array.flatten(Array.getSomes(saved)), value => value.time >= now - 168 * 3_600_000),
								Order.mapInput(Order.Number, (value: Sample) => value.time)
							)
						)
						const previous = yield* Ref.make(Option.none<Counters>())
						const dirty = yield* Ref.make(Array.empty<number>())
						const error = yield* Ref.make('')
						const collect = pipe(
							Effect.gen(function* () {
								const time = yield* Clock.currentTimeMillis
								const files = yield* Effect.all(
									{
										disk: fs.readFileString('/proc/diskstats'),
										memory: fs.readFileString('/proc/meminfo'),
										network: fs.readFileString('/proc/net/dev'),
										stat: fs.readFileString('/proc/stat'),
										storage: Effect.scoped(
											execute('df', [
												'-B1',
												'--output=target,size,used',
												'-x',
												'tmpfs',
												'-x',
												'devtmpfs',
												'-x',
												'overlay',
												'-x',
												'squashfs',
												'-x',
												'efivarfs'
											])
										),
										uptime: fs.readFileString('/proc/uptime')
									},
									{concurrency: 'unbounded'}
								)
								const current = yield* pipe(
									Effect.try(() => counters(files.stat, files.network, files.disk, files.uptime, time)),
									Effect.flatMap(Schema.decodeEffect(Counters))
								)
								const old = Option.getOrUndefined(yield* Ref.get(previous))
								const value = yield* pipe(
									Effect.try(() => sample(current, files.memory, files.storage, old)),
									Effect.flatMap(Schema.decodeEffect(Sample))
								)
								yield* Ref.set(previous, Option.some(current))
								const samples = yield* Ref.updateAndGet(state, all => [
									...Array.filter(all, entry => entry.time >= time - 168 * 3_600_000),
									value
								])
								const hour = Math.floor(time / 3_600_000)
								yield* Effect.forEach(
									yield* Ref.updateAndGet(dirty, buckets =>
										Array.dedupe([...Array.filter(buckets, bucket => bucket >= hour - 168), hour])
									),
									bucket =>
										pipe(
											store.set(
												`metrics-${bucket}`,
												Array.filter(samples, entry => Math.floor(entry.time / 3_600_000) === bucket)
											),
											Effect.andThen(Ref.update(dirty, buckets => Array.filter(buckets, pending => pending !== bucket)))
										),
									{concurrency: 1, discard: true}
								)
								yield* Effect.forEach(
									Array.filter(
										yield* base.keys,
										key =>
											String.startsWith('metrics-')(key) &&
											(String.endsWith('.tmp')(key) ||
												Option.exists(Number.parse(String.slice(8)(key)), bucket => bucket < hour - 168))
									),
									key => base.remove(key),
									{concurrency: 1, discard: true}
								)
								yield* Ref.set(error, '')
							}),
							Effect.catch(cause => Ref.set(error, `${cause}`))
						)
						yield* collect
						yield* pipe(collect, Effect.schedule(Schedule.spaced('30 seconds')), Effect.forkScoped)
						return Metrics.of({
							read: Effect.fnUntraced(function* (query) {
								const samples = yield* Ref.get(state)
								const time = yield* Clock.currentTimeMillis
								return MachineHistory.make({
									error: yield* Ref.get(error),
									samples: history(samples, query.hours, time),
									stale:
										time -
											Option.getOrElse(
												Option.map(Array.last(samples), value => value.time),
												() => 0
											) >
										90_000,
									time,
									worker
								})
							})
						})
					})
				),
				Layer.provide(layerKeyValueStore(directory))
			)
		})
	)
}
