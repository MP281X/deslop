import {
	Array,
	Boolean,
	Clock,
	DateTime,
	Context,
	Duration,
	Effect,
	Exit,
	FileSystem,
	Filter,
	Function,
	HashMap,
	Layer,
	Option,
	Order,
	Predicate,
	Record,
	Ref,
	Schedule,
	Schema,
	Semaphore,
	String,
	Struct,
	pipe
} from 'effect'

import type {PlatformError} from 'effect/PlatformError'
import type {SqlError} from 'effect/sql'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {executeProcess} from '@deslop/runtime/server/process'

import {migrations} from './migrations.ts'

import {processOwner, processTrackUsage, processTree} from '#services/inventory/lib/utils.ts'
import {DeployError} from '#services/inventory/schema.ts'
import type {AppRequest} from '#services/inventory/schema.ts'
import {Inventory} from '#services/inventory/service.ts'
import {
	SERIES,
	appCgroup,
	appShares,
	cgroupUsage,
	chartWindow,
	counters,
	expired,
	history,
	coverageOf,
	linuxDisks,
	rollup,
	sample
} from '#services/metrics/lib/utils.ts'
import type {AppReading} from '#services/metrics/lib/utils.ts'
import {
	AppHistory,
	CgroupPath,
	Counters,
	HistoryMinutes,
	HistoryQuery,
	MachineSample,
	ProcessSample,
	Sample
} from '#services/metrics/schema.ts'
import type {AppHour, AppSample, Disk, MachineHistory, MetricSource} from '#services/metrics/schema.ts'

const CGROUP = '/sys/fs/cgroup'

const asDeployError = Effect.mapError((cause: SqlError.SqlError | Schema.SchemaError) =>
	DeployError.make({cause, message: 'The resource history could not be read or written.'})
)

// An unreadable machine should report a monitoring error rather than crash the sampler.
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

function sameBucket(row: Sample, time: DateTime.Utc) {
	const step = Duration.toMillis(row.step)
	return Math.floor(DateTime.toEpochMillis(row.since) / step) === Math.floor(DateTime.toEpochMillis(time) / step)
}

export class Metrics extends Context.Service<Metrics>()('@deslop/deploy/services/metrics/service/Metrics', {
	make: Effect.gen(function* () {
		const inventory = yield* Inventory
		const fs = yield* FileSystem.FileSystem
		const sql = yield* SqlClient.SqlClient

		// Each machine point with its app rows as one array; the merge patch drops an unmeasured CPU's null key, and a stored app's CPU counts as measured for the whole point, which its row doesn't record. A point that measured apps without rows has an empty array; one that never measured them has none.
		const joinedSamples = sql`SELECT s.*,
			CASE WHEN COUNT(a.app) = 0 THEN CASE WHEN s.appsCoverage > 0 THEN '[]' END ELSE
				json_group_array(json_patch('{}', json_object('id', a.app, 'cpu', a.cpu, 'cpuCoverage', CASE WHEN a.cpu IS NULL THEN 0 ELSE s.appsCoverage END, 'memory', a.memory)))
			END AS apps
			FROM ${sql(MachineSample.table)} s
			LEFT JOIN ${sql(AppHistory.table)} a ON a.step = s.step AND a.since = s.since`
		// The stored point of each series that a measurement at this time joins.
		const listBuckets = SqlSchema.findAll({
			Request: Sample.fields.time,
			Result: Sample,
			execute: time =>
				sql`${joinedSamples} WHERE ${sql.or(
					Array.map(Record.values(SERIES), spacing => {
						const step = Duration.toMillis(spacing)
						return sql`(s.step = ${step} AND s.since >= ${Math.floor(time / step) * step} AND s.since < ${(Math.floor(time / step) + 1) * step})`
					})
				)} GROUP BY s.step, s.since`
		})
		const saveMachineSamples = SqlSchema.void({
			Request: Schema.NonEmptyArray(MachineSample.insert),
			execute: rows => sql`INSERT OR REPLACE INTO ${sql(MachineSample.table)} ${sql.insert(rows)}`
		})
		const deleteAppSamples = SqlSchema.void({
			Request: Schema.NonEmptyArray(MachineSample.insert),
			execute: rows =>
				sql`DELETE FROM ${sql(AppHistory.table)} WHERE ${sql.or(
					Array.map(rows, row => sql`(step = ${row.step} AND since = ${row.since})`)
				)}`
		})
		const saveAppSamples = SqlSchema.void({
			Request: Schema.NonEmptyArray(AppHistory.insert),
			execute: rows => sql`INSERT INTO ${sql(AppHistory.table)} ${sql.insert(rows)}`
		})
		// Statements of at most 500 rows, well inside SQLite's bound on variables however many apps a backlog holds.
		const saveSamples = Effect.fnUntraced(function* (rows: Array.NonEmptyReadonlyArray<Sample>) {
			const machines = pipe(
				rows,
				Array.map(row => Struct.omit(row, ['apps'])),
				Array.chunksOf(500)
			)
			yield* Effect.forEach(machines, saveMachineSamples, {concurrency: 1})
			yield* Effect.forEach(machines, deleteAppSamples, {concurrency: 1})
			yield* pipe(
				rows,
				Array.flatMap(row =>
					pipe(
						row.apps,
						Option.getOrElse(Array.empty),
						Array.map(app => ({app: app.id, cpu: app.cpu, memory: app.memory, since: row.since, step: row.step}))
					)
				),
				Array.chunksOf(500),
				Effect.forEach(saveAppSamples, {concurrency: 1})
			)
		})
		// One series from a bucket before the range's start: a point covers at most its step, so none that ends inside the range is missed.
		const listSeries = SqlSchema.findAll({
			Request: Schema.Struct({after: Sample.fields.since, step: Sample.fields.step}),
			Result: Sample,
			execute: query =>
				sql`${joinedSamples} WHERE s.step = ${query.step} AND s.since > ${query.after} GROUP BY s.step, s.since ORDER BY s.since`
		})
		const listProcessSamples = SqlSchema.findAll({
			Request: Schema.Struct({
				after: ProcessSample.fields.time,
				app: ProcessSample.fields.app,
				now: ProcessSample.fields.time
			}),
			Result: ProcessSample,
			execute: query =>
				sql`SELECT * FROM ${sql(ProcessSample.table)} WHERE app = ${query.app} AND time > ${query.after} AND time <= ${query.now} ORDER BY time`
		})
		const saveProcessSamples = SqlSchema.void({
			Request: Schema.NonEmptyArray(ProcessSample.insert),
			execute: rows => sql`INSERT OR REPLACE INTO ${sql(ProcessSample.table)} ${sql.insert(rows)}`
		})
		const deleteProcessSamples = SqlSchema.void({
			Request: ProcessSample.fields.time,
			execute: before => sql`DELETE FROM ${sql(ProcessSample.table)} WHERE time <= ${before}`
		})
		const collectProcesses = pipe(
			Effect.gen(function* () {
				const current = yield* inventory.appProcesses
				const rows = pipe(
					current.readings,
					Array.groupBy(reading => reading.app),
					Record.values,
					Array.map(group => ({
						app: group[0].app,
						processes: pipe(
							group,
							Array.map(reading => reading.process),
							processTree,
							processTrackUsage
						),
						time: current.time
					}))
				)
				if (Array.isReadonlyArrayNonEmpty(rows)) yield* asDeployError(saveProcessSamples(rows))
			}),
			Effect.withSpan('Metrics.collectProcesses'),
			Effect.ignore({log: 'Warn', message: 'Process history could not be sampled'})
		)
		// Each series keeps its range, and a bucket goes once all of it has aged out.
		const deleteExpired = SqlSchema.void({
			Request: Sample.fields.time,
			execute: now =>
				Effect.forEach(
					[AppHistory.table, MachineSample.table],
					table =>
						sql`DELETE FROM ${sql(table)} WHERE ${sql.or(
							Array.map(
								HistoryMinutes.literals,
								minutes =>
									sql`(step = ${Duration.toMillis(SERIES[minutes])} AND since < ${now - Duration.toMillis(Duration.minutes(minutes)) - Duration.toMillis(SERIES[minutes])})`
							)
						)}`,
					{concurrency: 1}
				)
		})

		const previous = yield* Ref.make(Option.none<Counters>())
		const lastApps = yield* Ref.make(Option.none<AppReading>())
		const storage = yield* Ref.make<readonly Disk[]>([])
		// The newest measurement's disks and load averages, which no chart draws over time.
		const latest = yield* Ref.make<{disks: readonly Disk[]; load: readonly number[]}>({disks: [], load: []})
		// Each source's last failure, cleared only by that source's next success, so a good sample never hides a failed save.
		const problems = yield* Ref.make(HashMap.empty<MetricSource, string>())
		function report(source: MetricSource, problem: Option.Option<string>) {
			return Ref.update(problems, current =>
				Option.match(problem, {
					onNone: () => HashMap.remove(current, source),
					onSome: message => HashMap.set(current, source, message)
				})
			)
		}
		// The cgroups that are each one app, opened level by level through slices and user managers without entering an app; a cgroup gone mid-walk has no children.
		function walk(
			pending: readonly CgroupPath[],
			found: readonly CgroupPath[]
		): Effect.Effect<readonly CgroupPath[], PlatformError> {
			if (Array.isReadonlyArrayEmpty(pending)) return Effect.succeed(found)
			return pipe(
				pending,
				Effect.forEach(
					path =>
						pipe(
							fs.readDirectory(`${CGROUP}${path}`),
							Effect.catchTag('PlatformError', cause => {
								if (Predicate.isTagged(cause.reason, 'NotFound')) return Effect.succeed(Array.empty<string>())
								return Effect.fail(cause)
							}),
							Effect.map(names =>
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
					const children = Array.flatten(levels)
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
					Option.match(processOwner(path), {
						onNone: () => Effect.fail(DeployError.make({message: `The cgroup ${path} has no app owner.`})),
						onSome: Effect.fnUntraced(function* (id) {
							return yield* pipe(
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
											Effect.fail(
												DeployError.make({message: `The cgroup counters for ${path} are missing or invalid.`})
											),
										onSome: usage => Effect.succeedSome([path, {id, ...usage}] as const)
									})
								})
							)
						})
					}),
				{concurrency: 8}
			)
			return Record.fromEntries(Array.getSomes(readings))
		})
		// A disk that never answers is killed after ten seconds and leaves the last disks read; a row df writes that isn't a disk fails only the disks.
		const refreshStorage = pipe(
			executeProcess(
				'df',
				[
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
				],
				{timeout: '10 seconds'}
			),
			Effect.flatMap(text =>
				Effect.try({
					catch: cause => DeployError.make({cause, message: 'The disk sizes are unreadable.'}),
					try: () => linuxDisks(text)
				})
			),
			Effect.flatMap(disks => Ref.set(storage, disks)),
			Effect.andThen(report('disks', Option.none())),
			Effect.withSpan('Metrics.refreshStorage'),
			Effect.tapError(cause => report('disks', Option.some(cause.message))),
			Effect.ignore({log: 'Warn', message: 'The disk sizes were not read'})
		)
		// A sample reads /proc, and each app's cgroup, so the history can split memory and CPU by app; a slow or failed cgroup read only drops the apps.
		const measure = Effect.fnUntraced(function* (
			time: DateTime.Utc,
			disks: readonly Disk[],
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
				Effect.tap(report('apps', Option.none())),
				Effect.asSome,
				Effect.catchTag('TimeoutError', cause =>
					Effect.as(Effect.logWarning('Per-app metrics exceeded their sampling window', cause), Option.none())
				),
				Effect.catch(cause =>
					pipe(
						Effect.logWarning('Per-app metrics could not be read', cause),
						Effect.andThen(report('apps', Option.some(cause.message))),
						Effect.as(Option.none())
					)
				)
			)
			const value = yield* sampled(() => sample(current, files.memory, disks, old, Option.some(files.load)))
			return {current, value: {...value, point: {...value.point, apps: shares, appsCoverage: coverageOf(shares)}}}
		})
		const pending = yield* Ref.make<readonly Sample[]>(yield* asDeployError(listBuckets(yield* DateTime.now)))
		const writes = yield* Semaphore.make(1)
		const collect = pipe(
			Effect.gen(function* () {
				const time = yield* DateTime.now
				const measurement = yield* measure(time, yield* Ref.get(storage), yield* Ref.get(previous))
				yield* Ref.set(previous, Option.some(measurement.current))
				yield* writes.withPermits(1)(
					Ref.update(pending, rows => {
						const [current, completed] = Array.partition(
							rows,
							Filter.fromPredicate(row => sameBucket(row, time))
						)
						return [
							...completed,
							...Array.map(rollup(measurement.value.point, current), row =>
								Struct.evolve(row, {
									apps: Option.map(Array.sort(Order.mapInput(Order.String, (app: AppSample) => app.id)))
								})
							)
						]
					})
				)
				yield* Ref.set(latest, {disks: measurement.value.disks, load: measurement.value.load})
				yield* report('sample', Option.none())
			}),
			Effect.tapError(cause => Effect.logWarning('Metrics could not be sampled', cause)),
			Effect.catch(cause => report('sample', Option.some(cause.message)))
		)
		// A save that keeps failing holds no bucket its range has already dropped, so the backlog stays bounded.
		const flush = pipe(
			Effect.gen(function* () {
				const rows = yield* Ref.get(pending)
				const saved = yield* Effect.exit(
					Effect.gen(function* () {
						if (Array.isReadonlyArrayNonEmpty(rows)) yield* pipe(saveSamples(rows), sql.withTransaction, asDeployError)
					})
				)
				const time = yield* DateTime.now
				yield* Ref.set(
					pending,
					Array.filter(rows, row =>
						Boolean.match(Exit.isSuccess(saved), {
							onFalse: () => !expired(row, time),
							onTrue: () => sameBucket(row, time)
						})
					)
				)
				return yield* saved
			}),
			writes.withPermits(1),
			Effect.andThen(report('save', Option.none())),
			Effect.withSpan('Metrics.collect'),
			Effect.tapError(cause => report('save', Option.some(cause.message))),
			Effect.ignore({log: 'Error', message: 'Resource history could not be saved'})
		)
		// The wall clock's offset from the monotonic one, and since when it has held: history is pruned only by a wall clock that has kept time for ten minutes, so a clock stepped ahead and then corrected deletes nothing.
		const offset = Effect.gen(function* () {
			const monotonic = Duration.toMillis(Duration.nanos(yield* Clock.monotonicTimeNanos))
			return {monotonic, offset: (yield* Clock.currentTimeMillis) - monotonic}
		})
		const steady = yield* Ref.make(yield* offset)
		const prune = Effect.gen(function* () {
			const current = yield* offset
			const since = yield* Ref.updateAndGet(steady, last =>
				Boolean.match(Math.abs(current.offset - last.offset) > 60_000, {
					onFalse: () => ({...last, offset: current.offset}),
					onTrue: () => current
				})
			)
			if (current.monotonic - since.monotonic < Duration.toMillis(Duration.minutes(10))) {
				return yield* Effect.logDebug('The wall clock moved recently; history is kept until it holds')
			}
			const now = yield* DateTime.now
			yield* pipe(
				deleteExpired(now),
				Effect.andThen(deleteProcessSamples(DateTime.subtractDuration(now, Duration.hours(1)))),
				sql.withTransaction,
				asDeployError,
				Effect.withSpan('Metrics.prune')
			)
		})

		// The first sample doesn't wait for df: its disks arrive with the first answer.
		yield* collect
		// Registered before the collectors: their scoped fibers stop before the final commit.
		yield* Effect.addFinalizer(() => flush)
		yield* pipe(collect, Effect.schedule(Schedule.fixed(Duration.seconds(1))), Effect.forkScoped)
		yield* pipe(flush, Effect.schedule(Schedule.fixed(Duration.seconds(10))), Effect.forkScoped)
		yield* pipe(collectProcesses, Effect.repeat(Schedule.spaced(Duration.seconds(5))), Effect.forkScoped)
		yield* pipe(refreshStorage, Effect.repeat(Schedule.spaced(Duration.seconds(30))), Effect.forkScoped)
		// Expired points go every minute.
		yield* pipe(
			prune,
			Effect.ignore({log: 'Error', message: 'Expired resource history could not be deleted'}),
			Effect.schedule(Schedule.spaced(Duration.minutes(1))),
			Effect.forkScoped
		)

		return {
			processHistory: Effect.fn('Metrics.processHistory')(function* (input: AppRequest, time: DateTime.Utc) {
				const rows = yield* asDeployError(
					listProcessSamples({after: DateTime.subtractDuration(time, Duration.hours(1)), app: input.id, now: time})
				)
				return pipe(
					rows,
					Array.flatMap(row => Array.map(row.processes, process => ({...process, time: row.time}))),
					Array.groupBy(process => process.key),
					Record.values,
					Array.map(group => ({
						key: group[0].key,
						label: group[0].label,
						samples: Array.map(group, point => Struct.pick(point, ['cpu', 'memory', 'time']))
					}))
				) satisfies AppHour['processes']
			}),
			read: Effect.fn('Metrics.read')(function* (query: HistoryQuery) {
				yield* Effect.annotateCurrentSpan({minutes: Duration.toMinutes(query.minutes)})
				const time = yield* DateTime.now
				const step = SERIES[yield* asDeployError(Schema.encodeEffect(HistoryQuery.fields.minutes)(query.minutes))]
				const samples = yield* writes.withPermits(1)(
					Effect.gen(function* () {
						const stored = yield* asDeployError(
							listSeries({after: DateTime.subtractDuration(chartWindow(query.minutes, time).start, step), step})
						)
						const buffered = Array.filter(yield* Ref.get(pending), row => Duration.equals(row.step, step))
						return Array.sort(
							[
								...Array.filter(
									stored,
									row => !Array.some(buffered, value => DateTime.Equivalence(value.since, row.since))
								),
								...buffered
							],
							Order.mapInput(DateTime.Order, (row: Sample) => row.since)
						)
					})
				)
				const now = yield* Ref.get(latest)
				// Built from values the model just decoded, so no sample is checked twice; the RPC encodes it against the schema.
				return {
					disks: now.disks,
					error: pipe(
						yield* Ref.get(problems),
						HashMap.toValues,
						Option.liftPredicate(Array.isReadonlyArrayNonEmpty),
						Option.map(Array.join('; '))
					),
					load: now.load,
					samples: history(samples, query.minutes, time),
					stale: Option.match(Array.last(samples), {
						onNone: Function.constTrue,
						onSome: value => pipe(value.time, DateTime.distance(time), Duration.isGreaterThan(Duration.seconds(90)))
					}),
					time
				} satisfies MachineHistory
			})
		}
	})
}) {
	// The tables this service owns, made and changed at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({loader: Migrator.fromRecord(migrations), table: 'metrics_migrations'})
	)

	static readonly layer = Layer.provide(Layer.effect(this, this.make), this.migrations)
}
