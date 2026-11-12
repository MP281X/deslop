import {cpus, hostname, loadavg, totalmem} from 'node:os'
import {platform} from 'node:process'

import {
	Array,
	Boolean,
	Clock,
	Context,
	Duration,
	Effect,
	FileSystem,
	HashSet,
	Layer,
	Number,
	Option,
	Order,
	Record,
	Ref,
	Schedule,
	Schema,
	String,
	pipe
} from 'effect'

import {KeyValueStore} from 'effect/persistence'

import {execute} from '@deslop/runtime/server/process'

import {processOwner} from '#services/inventory/lib/utils.ts'
import {DeployError} from '#services/inventory/schema.ts'
import {
	appCgroup,
	appShares,
	cgroupUsage,
	compact,
	counters,
	cpuCounters,
	history,
	reading,
	rootVolume,
	sample,
	vmStatMemory
} from '#services/metrics/lib/utils.ts'
import type {AppReading} from '#services/metrics/lib/utils.ts'
import {Counters, MachineHistory, Sample} from '#services/metrics/schema.ts'
import type {HistoryQuery} from '#services/metrics/schema.ts'

const CGROUP = '/sys/fs/cgroup'

const HOURLY_FILE_PREFIX = 'metrics-'

function counted(read: () => Counters) {
	return pipe(
		Effect.try({catch: cause => DeployError.make({cause, message: 'The machine counters are unreadable.'}), try: read}),
		Effect.flatMap(Schema.decodeEffect(Counters))
	)
}

function sampled(read: () => Sample) {
	return pipe(
		Effect.try({catch: cause => DeployError.make({cause, message: 'The machine sample is unreadable.'}), try: read}),
		Effect.flatMap(Schema.decodeEffect(Sample))
	)
}

export class Metrics extends Context.Service<
	Metrics,
	{readonly read: (query: HistoryQuery) => Effect.Effect<MachineHistory>}
>()('@deslop/deploy/services/metrics/service/Metrics') {
	static readonly layer = Layer.effect(
		Metrics,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const worker = hostname()
			const cpuModel = Option.getOrElse(
				Option.map(Array.head(cpus()), cpu => String.trim(cpu.model)),
				() => ''
			)
			const base = yield* KeyValueStore.KeyValueStore
			const store = KeyValueStore.toSchemaStore(base, Schema.Array(Sample))
			const now = yield* Clock.currentTimeMillis
			const saved = yield* Effect.forEach(
				Array.filter(
					yield* base.keys,
					key => String.startsWith(HOURLY_FILE_PREFIX)(key) && !String.endsWith('.tmp')(key)
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
			const lastApps = yield* Ref.make(Option.none<AppReading>())
			const storage = yield* Ref.make('')
			const dirty = yield* Ref.make(Array.empty<number>())
			const collectError = yield* Ref.make('')
			const persistError = yield* Ref.make('')
			// The cgroups that are each one app, opened level by level through slices and user managers without entering an app; a cgroup gone mid-walk has no children.
			function walk(pending: readonly string[], found: readonly string[]): Effect.Effect<readonly string[]> {
				if (Array.isReadonlyArrayEmpty(pending)) return Effect.succeed(found)
				return Effect.flatMap(
					Effect.forEach(
						pending,
						path =>
							Effect.option(
								Effect.map(fs.readDirectory(`${CGROUP}${path}`), names =>
									Array.map(
										Array.filter(names, name => Option.isSome(String.match(/\.(?:slice|scope|service)$/u)(name))),
										name => ({app: appCgroup(`${path}/${name}`, names), path: `${path}/${name}`})
									)
								)
							),
						{concurrency: 'unbounded'}
					),
					levels => {
						const children = Array.flatten(Array.getSomes(levels))
						return walk(
							Array.map(
								Array.filter(
									children,
									child => !child.app && Option.isSome(String.match(/(?:\.slice|\/user@[0-9]+\.service)$/u)(child.path))
								),
								child => child.path
							),
							[
								...found,
								...Array.map(
									Array.filter(children, child => child.app),
									child => child.path
								)
							]
						)
					}
				)
			}
			const appCgroups = walk([''], [])
			// Each app cgroup's memory and CPU time, which count processes that came and went between samples.
			const apps = Effect.gen(function* () {
				const readings = yield* Effect.forEach(
					yield* appCgroups,
					path =>
						pipe(
							Effect.all(
								{
									cpu: fs.readFileString(`${CGROUP}${path}/cpu.stat`),
									memory: fs.readFileString(`${CGROUP}${path}/memory.stat`)
								},
								{concurrency: 'unbounded'}
							),
							Effect.catchTag('PlatformError', cause => {
								if (cause.reason._tag === 'NotFound') return Effect.undefined
								return Effect.fail(cause)
							}),
							Effect.flatMap(stats => {
								if (stats === undefined) return Effect.succeedNone
								return Option.match(cgroupUsage(stats.cpu, stats.memory), {
									onNone: () =>
										Effect.fail(DeployError.make({message: `The cgroup counters for ${path} are missing or invalid.`})),
									onSome: usage => Effect.succeedSome([path, {id: processOwner(path), ...usage}] as const)
								})
							})
						),
					{concurrency: 8}
				)
				return Record.fromEntries(Array.getSomes(readings))
			})
			const refreshStorage = pipe(
				Effect.scoped(
					Boolean.match(platform === 'darwin', {
						onFalse: () =>
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
							]),
						onTrue: () => execute('df', ['-k', '/'])
					})
				),
				Effect.flatMap(text => Ref.set(storage, text)),
				Effect.ignore({log: 'Warn', message: 'The disk sizes were not read'})
			)
			// A Linux sample reads /proc, and each app's cgroup, so the history can split memory and CPU by app; a slow cgroup read only drops the apps.
			const linux = Effect.fnUntraced(function* (time: number, disks: string, old?: Counters) {
				const files = yield* Effect.all(
					{
						load: fs.readFileString('/proc/loadavg'),
						memory: fs.readFileString('/proc/meminfo'),
						stat: fs.readFileString('/proc/stat'),
						uptime: fs.readFileString('/proc/uptime')
					},
					{concurrency: 'unbounded'}
				)
				const current = yield* counted(() => counters(files.stat, files.uptime, time))
				const shares = yield* pipe(
					apps,
					Effect.timeout('1 second'),
					Effect.flatMap(usage =>
						Ref.modify(lastApps, last => {
							const cgroups = {cgroups: usage, time, total: current.cpuTotal}
							return [appShares(cgroups, Option.getOrUndefined(last)), Option.some(cgroups)]
						})
					),
					Effect.asSome,
					Effect.catchTag('TimeoutError', () => Effect.succeedNone)
				)
				const value = yield* sampled(() => ({
					...sample(current, files.memory, disks, old, files.load),
					...Option.match(shares, {onNone: () => ({}), onSome: usage => ({apps: usage})})
				}))
				return {current, value}
			})
			// A Mac has no cgroups, so its samples carry no apps.
			const darwin = Effect.fnUntraced(function* (time: number, disks: string, old?: Counters) {
				const memory = yield* Effect.scoped(execute('vm_stat', []))
				const uptime = Duration.toSeconds(Duration.nanos(yield* Clock.monotonicTimeNanos))
				const current = yield* counted(() => cpuCounters(cpus(), uptime, time))
				const value = yield* sampled(() =>
					reading(current, vmStatMemory(memory, totalmem()), rootVolume(disks), loadavg(), old)
				)
				return {current, value}
			})
			const collect = pipe(
				Effect.gen(function* () {
					const time = yield* Clock.currentTimeMillis
					const old = Option.getOrUndefined(yield* Ref.get(previous))
					const disks = yield* Ref.get(storage)
					const measured = yield* Boolean.match(platform === 'darwin', {
						onFalse: () => linux(time, disks, old),
						onTrue: () => darwin(time, disks, old)
					})
					yield* Ref.set(previous, Option.some(measured.current))
					const before = yield* Ref.get(state)
					const samples = compact([...before, measured.value], time)
					yield* Ref.set(state, samples)
					const retained = HashSet.fromIterable(Array.map(samples, entry => entry.time))
					const hour = Math.floor(time / 3_600_000)
					// Each hour's file is rewritten on the next save: this one, and those whose samples merged or aged out.
					yield* Ref.update(dirty, buckets =>
						Array.dedupe([
							...Array.filter(buckets, bucket => bucket >= hour - 168),
							hour,
							...Array.map(
								Array.filter(
									before,
									entry => !HashSet.has(retained, entry.time) && entry.time >= time - 168 * 3_600_000
								),
								entry => Math.floor(entry.time / 3_600_000)
							)
						])
					)
					yield* Ref.set(collectError, '')
				}),
				Effect.catch(cause => Ref.set(collectError, cause.message))
			)
			const persist = pipe(
				Effect.gen(function* () {
					const time = yield* Clock.currentTimeMillis
					// The hours to write are taken before the samples, so one a merge dirties meanwhile waits for the next save; a failed or interrupted save puts them back.
					const buckets = yield* Ref.getAndSet(dirty, [])
					const samples = yield* Ref.get(state)
					yield* pipe(
						Effect.forEach(
							buckets,
							bucket =>
								store.set(
									`${HOURLY_FILE_PREFIX}${bucket}`,
									Array.filter(samples, entry => Math.floor(entry.time / 3_600_000) === bucket)
								),
							{concurrency: 1, discard: true}
						),
						Effect.onError(() => Ref.update(dirty, pending => Array.dedupe([...pending, ...buckets])))
					)
					yield* Effect.forEach(
						Array.filter(
							yield* base.keys,
							key =>
								String.startsWith(HOURLY_FILE_PREFIX)(key) &&
								(String.endsWith('.tmp')(key) ||
									Option.exists(
										Number.parse(String.slice(HOURLY_FILE_PREFIX.length)(key)),
										bucket => bucket < Math.floor(time / 3_600_000) - 168
									))
						),
						key => base.remove(key),
						{concurrency: 1, discard: true}
					)
					yield* Ref.set(persistError, '')
				}),
				Effect.catch(cause => Ref.set(persistError, cause.message))
			)
			yield* refreshStorage
			yield* collect
			yield* persist
			// Samples land every second and reach disk every 30 seconds and on shutdown, so a restart loses at most the seconds since.
			yield* Effect.addFinalizer(() => persist)
			yield* pipe(collect, Effect.schedule(Schedule.fixed('1 second')), Effect.forkScoped)
			yield* pipe(
				Effect.andThen(refreshStorage, persist),
				Effect.schedule(Schedule.spaced('30 seconds')),
				Effect.forkScoped
			)
			return Metrics.of({
				read: Effect.fnUntraced(function* (query) {
					const samples = yield* Ref.get(state)
					const time = yield* Clock.currentTimeMillis
					return MachineHistory.make({
						cpuModel,
						error: Array.join(
							Array.filter([yield* Ref.get(collectError), yield* Ref.get(persistError)], String.isNonEmpty),
							'\n'
						),
						samples: history(samples, query.minutes, time),
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
	)
}
