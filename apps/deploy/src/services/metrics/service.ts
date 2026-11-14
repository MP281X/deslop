import {cpus, hostname, loadavg, totalmem} from 'node:os'
import {platform} from 'node:process'

import {
	Array,
	Boolean,
	Clock,
	DateTime,
	Context,
	Duration,
	Effect,
	FileSystem,
	Function,
	Layer,
	Number,
	Option,
	Predicate,
	Record,
	Ref,
	Schedule,
	Schema,
	String,
	pipe
} from 'effect'

import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {executeProcess} from '@deslop/runtime/server/process'

import {processOwner} from '#services/inventory/lib/utils.ts'
import {DeployError, WorkerId} from '#services/inventory/schema.ts'
import {
	SERIES,
	appCgroup,
	appShares,
	cgroupUsage,
	chartWindow,
	counters,
	cpuCounters,
	history,
	reading,
	rollup,
	rootVolume,
	sample,
	vmStatMemory
} from '#services/metrics/lib/utils.ts'
import type {AppReading} from '#services/metrics/lib/utils.ts'
import {CgroupPath, Counters, Sample} from '#services/metrics/schema.ts'
import type {Disk, MachineHistory, HistoryQuery} from '#services/metrics/schema.ts'

const CGROUP = '/sys/fs/cgroup'

const asDeployError = Effect.mapError((cause: unknown) =>
	DeployError.make({cause, message: 'The resource history could not be read or written.'})
)

function counted(read: () => Counters) {
	return Effect.flatMap(
		Effect.try({catch: cause => DeployError.make({cause, message: 'The machine counters are unreadable.'}), try: read}),
		Schema.decodeEffect(Schema.toType(Counters))
	)
}

function sampled<A>(read: () => A) {
	return Effect.try({
		catch: cause => DeployError.make({cause, message: 'The machine sample is unreadable.'}),
		try: read
	})
}

export class Metrics extends Context.Service<Metrics>()('@deslop/deploy/services/metrics/service/Metrics', {
	make: Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem
		const sql = yield* SqlClient.SqlClient
		const worker = yield* Schema.decodeEffect(WorkerId)(hostname())

		// The stored point of each series that a measurement at this time joins.
		const listBuckets = SqlSchema.findAll({
			Request: Sample.fields.time,
			Result: Sample,
			execute: time =>
				sql`SELECT * FROM ${sql(Sample.table)} WHERE ${sql.or(
					Array.map(Record.values(SERIES), spacing => {
						const step = Duration.toMillis(spacing)
						return sql`(step = ${step} AND since >= ${Math.floor(time / step) * step} AND since < ${(Math.floor(time / step) + 1) * step})`
					})
				)}`
		})
		const saveSamples = SqlSchema.void({
			Request: Schema.NonEmptyArray(Sample.insert),
			execute: rows => sql`INSERT OR REPLACE INTO ${sql(Sample.table)} ${sql.insert(rows)}`
		})
		// One series from a bucket before the range's start: a point covers at most its step, so none that ends inside the range is missed.
		const listSeries = SqlSchema.findAll({
			Request: Schema.Struct({after: Sample.fields.since, step: Sample.fields.step}),
			Result: Sample,
			execute: query =>
				sql`SELECT * FROM ${sql(Sample.table)} WHERE step = ${query.step} AND since > ${query.after} ORDER BY since`
		})
		// Each series keeps its range, and a bucket goes once all of it has aged out.
		const deleteExpired = SqlSchema.void({
			Request: Sample.fields.time,
			execute: now =>
				sql`DELETE FROM ${sql(Sample.table)} WHERE ${sql.or(
					Array.map(
						Record.toEntries(SERIES),
						entry =>
							sql`(step = ${Duration.toMillis(entry[1])} AND since < ${now - pipe(entry[0], Number.parse, Option.getOrThrow, Duration.minutes, Duration.toMillis) - Duration.toMillis(entry[1])})`
					)
				)}`
		})

		const previous = yield* Ref.make(Option.none<Counters>())
		const lastApps = yield* Ref.make(Option.none<AppReading>())
		const storage = yield* Ref.make(Option.none<string>())
		// The newest measurement's disks and load averages, which no chart draws over time.
		const latest = yield* Ref.make<{disks: readonly Disk[]; load: readonly number[]}>({disks: [], load: []})
		const failure = yield* Ref.make(Option.none<string>())
		// The cgroups that are each one app, opened level by level through slices and user managers without entering an app; a cgroup gone mid-walk has no children.
		function walk(pending: readonly CgroupPath[], found: readonly CgroupPath[]): Effect.Effect<readonly CgroupPath[]> {
			if (Array.isReadonlyArrayEmpty(pending)) return Effect.succeed(found)
			return pipe(
				pending,
				Effect.forEach(
					path =>
						Effect.option(
							Effect.map(fs.readDirectory(`${CGROUP}${path}`), names =>
								pipe(
									names,
									Array.filter(name => Option.isSome(String.match(/\.(?:slice|scope|service)$/u)(name))),
									Array.map(name => ({
										app: appCgroup(`${path}/${name}`, names),
										path: CgroupPath.make(`${path}/${name}`)
									}))
								)
							)
						),
					{concurrency: 'unbounded'}
				),
				Effect.flatMap(levels => {
					const children = Array.flatten(Array.getSomes(levels))
					return walk(
						pipe(
							children,
							Array.filter(
								child => !child.app && Option.isSome(String.match(/(?:\.slice|\/user@[0-9]+\.service)$/u)(child.path))
							),
							Array.map(child => child.path)
						),
						[
							...found,
							...pipe(
								children,
								Array.filter(child => child.app),
								Array.map(child => child.path)
							)
						]
					)
				})
			)
		}
		const appCgroups = walk([CgroupPath.make('')], [])
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
							if (Predicate.isTagged(cause.reason, 'NotFound')) return Effect.undefined
							return Effect.fail(cause)
						}),
						Effect.flatMap(stats => {
							if (stats === undefined) return Effect.succeedNone
							return Option.match(cgroupUsage(stats.cpu, stats.memory), {
								onNone: () =>
									Effect.fail(DeployError.make({message: `The cgroup counters for ${path} are missing or invalid.`})),
								onSome: usage =>
									Effect.succeedSome([path, {id: Option.getOrThrow(processOwner(path)), ...usage}] as const)
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
						executeProcess('df', [
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
					onTrue: () => executeProcess('df', ['-k', '/'])
				})
			),
			Effect.flatMap(text => Ref.set(storage, Option.some(text))),
			Effect.withSpan('Metrics.refreshStorage', {attributes: {worker}}),
			Effect.ignore({log: 'Warn', message: 'The disk sizes were not read'})
		)
		// A Linux sample reads /proc, and each app's cgroup, so the history can split memory and CPU by app; a slow cgroup read only drops the apps.
		const linux = Effect.fnUntraced(function* (
			time: DateTime.Utc,
			disks: Option.Option<string>,
			old: Option.Option<Counters>
		) {
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
				Effect.timeout(Duration.seconds(1)),
				Effect.flatMap(usage =>
					Ref.modify(lastApps, last => {
						const cgroups = {cgroups: usage, time, total: current.cpuTotal}
						return [appShares(cgroups, last), Option.some(cgroups)]
					})
				),
				Effect.asSome,
				Effect.catchTag('TimeoutError', () => Effect.succeedNone)
			)
			const value = yield* sampled(() => sample(current, files.memory, disks, old, Option.some(files.load)))
			return {current, value: {...value, point: {...value.point, apps: shares}}}
		})
		// A Mac has no cgroups, so its samples carry no apps.
		const darwin = Effect.fnUntraced(function* (
			time: DateTime.Utc,
			disks: Option.Option<string>,
			old: Option.Option<Counters>
		) {
			const memory = yield* Effect.scoped(executeProcess('vm_stat', []))
			const uptime = Duration.nanos(yield* Clock.monotonicTimeNanos)
			const current = yield* counted(() => cpuCounters(cpus(), uptime, time))
			const value = yield* sampled(() =>
				reading(
					current,
					vmStatMemory(memory, totalmem()),
					Option.match(disks, {onNone: () => [], onSome: rootVolume}),
					loadavg(),
					old
				)
			)
			return {current, value}
		})
		// Each measurement joins every series in one commit, so a restart loses nothing measured.
		const collect = pipe(
			Effect.gen(function* () {
				const time = yield* DateTime.now
				const old = yield* Ref.get(previous)
				const disks = yield* Ref.get(storage)
				const measured = yield* Boolean.match(platform === 'darwin', {
					onFalse: () => linux(time, disks, old),
					onTrue: () => darwin(time, disks, old)
				})
				yield* Ref.set(previous, Option.some(measured.current))
				yield* pipe(
					listBuckets(time),
					Effect.flatMap(stored => saveSamples(rollup(measured.value.point, stored))),
					sql.withTransaction,
					asDeployError
				)
				yield* Ref.set(latest, {disks: measured.value.disks, load: measured.value.load})
				yield* Ref.set(failure, Option.none())
			}),
			Effect.withSpan('Metrics.collect', {attributes: {worker}}),
			Effect.tapError(cause => Effect.logWarning('Metrics could not be sampled', cause)),
			Effect.catch(cause => Ref.set(failure, Option.some(cause.message)))
		)
		const prune = pipe(
			DateTime.now,
			Effect.flatMap(deleteExpired),
			asDeployError,
			Effect.withSpan('Metrics.prune', {attributes: {worker}})
		)

		yield* prune
		yield* refreshStorage
		yield* collect
		yield* pipe(collect, Effect.schedule(Schedule.fixed(Duration.seconds(1))), Effect.forkScoped)
		yield* pipe(refreshStorage, Effect.schedule(Schedule.spaced(Duration.seconds(30))), Effect.forkScoped)
		// The shortest series keeps a minute, so expired points go every minute.
		yield* pipe(
			prune,
			Effect.ignore({log: 'Error', message: 'Expired resource history could not be deleted'}),
			Effect.schedule(Schedule.spaced(Duration.minutes(1))),
			Effect.forkScoped
		)

		return {
			read: Effect.fn('Metrics.read')(function* (query: HistoryQuery) {
				yield* Effect.annotateCurrentSpan({minutes: Duration.toMinutes(query.minutes), worker})
				const time = yield* DateTime.now
				const step = Option.getOrThrow(Record.get(SERIES, `${Duration.toMinutes(query.minutes)}`))
				const samples = yield* asDeployError(
					listSeries({after: DateTime.subtractDuration(chartWindow(query.minutes, time).start, step), step})
				)
				const now = yield* Ref.get(latest)
				// Built from values the model just decoded, so no sample is checked twice; the RPC encodes it against the schema.
				return {
					disks: now.disks,
					error: yield* Ref.get(failure),
					load: now.load,
					samples: history(samples, query.minutes, time),
					stale: Option.match(Array.last(samples), {
						onNone: Function.constTrue,
						onSome: value => pipe(value.time, DateTime.distance(time), Duration.isGreaterThan(Duration.seconds(90)))
					}),
					time,
					worker
				} satisfies MachineHistory
			})
		}
	})
}) {
	// The table this service owns, made and changed at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({
			loader: Migrator.fromRecord({
				// Keyed by series, then time, so a range reads one span of the key; its rows carry the apps' JSON, too wide for WITHOUT ROWID.
				'0001_metrics': Effect.flatMap(
					SqlClient.SqlClient,
					sql => sql`
						CREATE TABLE samples (
							step INTEGER NOT NULL,
							since INTEGER NOT NULL,
							time INTEGER NOT NULL,
							cpu REAL,
							memoryTotal REAL NOT NULL,
							memoryUsed REAL NOT NULL,
							storageUsed REAL,
							apps TEXT,
							PRIMARY KEY (step, since)
						) STRICT
					`
				)
			}),
			table: 'metrics_migrations'
		})
	)

	static readonly layer = Layer.provide(Layer.effect(this, this.make), this.migrations)
}
