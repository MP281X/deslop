import {Array, DateTime, Duration, Effect, Function, Number, Option, Record, Schema, String, Struct, pipe} from 'effect'

import {SqlSchema} from 'effect/sql'
import type {SqlClient} from 'effect/sql'

import {
	AppHistory,
	CpuCounters,
	HistoryMinutes,
	LoadAverages,
	MachineSample,
	ProcessSample,
	Sample
} from './contract.ts'
import type {AppSample, CgroupPath, Counters, Disk, Point} from './contract.ts'

import type {AppId} from '#inventory/contract.ts'
import {DeployError} from '#machine/contract.ts'

// Each range's series spacing, so its 60 slots hold a few points each. A series keeps its range.
export const SERIES = {
	10: Duration.seconds(10),
	60: Duration.minutes(1),
	1440: Duration.minutes(15),
	10_080: Duration.hours(1),
	43_200: Duration.hours(6)
} satisfies Record<HistoryMinutes, Duration.Duration>

// A point its series' range no longer shows: older than the range and one bucket, as the prune deletes it.
export function expired(row: Sample, now: DateTime.Utc) {
	return Array.some(
		HistoryMinutes.literals,
		minutes =>
			Duration.equals(SERIES[minutes], row.step) &&
			DateTime.toEpochMillis(row.since) <
				DateTime.toEpochMillis(now) - Duration.toMillis(Duration.minutes(minutes)) - Duration.toMillis(SERIES[minutes])
	)
}

// A range's slot width: every range draws 60 slots.
export function resolution(range: Duration.Duration) {
	return Duration.divideUnsafe(range, 60)
}

export function chartWindow(range: Duration.Duration, now: DateTime.Utc) {
	const slot = Duration.toMillis(resolution(range))
	const end = DateTime.mapEpochMillis(now, value => Math.ceil(value / slot) * slot)
	return {end, start: DateTime.subtractDuration(end, range)}
}

// Average known readings by how long each was measured, so unread time between them weighs nothing.
function mean(
	bucket: readonly Sample[],
	coverage: (point: Sample, index: number) => Duration.Duration,
	read: (point: Sample, index: number) => Option.Option<number>
) {
	const known = Array.getSomes(
		Array.map(bucket, (point, index) =>
			Option.map(read(point, index), value => ({value, weight: Duration.toMillis(coverage(point, index))}))
		)
	)
	if (Number.sumAll(Array.map(known, entry => entry.weight)) === 0) return Option.none<number>()
	return Option.some(
		Number.sumAll(Array.map(known, entry => entry.value * entry.weight)) /
			Number.sumAll(Array.map(known, entry => entry.weight))
	)
}

function coverageSum(bucket: readonly Sample[], coverage: (point: Sample, index: number) => Duration.Duration) {
	return Array.reduce(bucket, Duration.zero, (sum, point, index) => Duration.sum(sum, coverage(point, index)))
}

// How long an app's CPU was measured in a point that measured apps; one missing from it used nothing for as long as the point measured.
function cpuCoverage(app: Option.Option<AppSample>, point: Sample) {
	return Option.match(app, {onNone: () => point.appsCoverage, onSome: found => found.cpuCoverage})
}

// A bucket's samples as one point: its use averaged over the bucket, so a short spike still counts; sizes and totals from the latest.
function merge(bucket: Array.NonEmptyReadonlyArray<Sample>) {
	if (bucket.length === 1) return bucket[0]
	const reported = Array.filter(bucket, point => Option.isSome(point.apps))
	const appsById = Array.map(reported, point =>
		pipe(
			point.apps,
			Option.getOrElse(Array.empty<AppSample>),
			Record.fromIterableBy(app => app.id)
		)
	)
	function appPoint(id: AppId, index: number) {
		return Option.fromUndefinedOr(appsById[index]?.[id])
	}
	// An app missing from a point that measured apps used nothing then, for as long as the point measured; one just started has no CPU reading yet, so its CPU average counts only the time it was read.
	function appMean(
		id: AppId,
		coverage: (app: Option.Option<AppSample>, point: Sample) => Duration.Duration,
		read: (app: AppSample) => Option.Option<number>
	) {
		return mean(
			reported,
			(point, index) => coverage(appPoint(id, index), point),
			(_point, index) => Option.match(appPoint(id, index), {onNone: () => Option.some(0), onSome: read})
		)
	}
	const last = Array.lastNonEmpty(bucket)
	return {
		...Struct.pick(last, ['memoryTotal', 'step', 'time']),
		apps: Array.match(reported, {
			onEmpty: () => Option.none(),
			onNonEmpty: () =>
				Option.some(
					Array.map(
						Array.dedupe(
							Array.flatMap(reported, point =>
								pipe(
									point.apps,
									Option.getOrElse(Array.empty),
									Array.map(app => app.id)
								)
							)
						),
						id => ({
							cpu: appMean(id, cpuCoverage, app => app.cpu),
							cpuCoverage: coverageSum(reported, (point, index) => cpuCoverage(appPoint(id, index), point)),
							id,
							memory: pipe(
								appMean(
									id,
									(_app, point) => point.appsCoverage,
									app => Option.some(app.memory)
								),
								Option.getOrElse(Function.constant(0)),
								Number.round(0)
							)
						})
					)
				)
		}),
		appsCoverage: coverageSum(bucket, point => point.appsCoverage),
		cpu: mean(
			bucket,
			point => point.cpuCoverage,
			point => point.cpu
		),
		cpuCoverage: coverageSum(bucket, point => point.cpuCoverage),
		memoryCoverage: coverageSum(bucket, point => point.memoryCoverage),
		memoryUsed: Option.getOrElse(
			mean(
				bucket,
				point => point.memoryCoverage,
				point => Option.some(point.memoryUsed)
			),
			() => last.memoryUsed
		),
		since: bucket[0].since,
		storageCoverage: coverageSum(bucket, point => point.storageCoverage),
		storageUsed: mean(
			bucket,
			point => point.storageCoverage,
			point => point.storageUsed
		)
	} satisfies Sample
}

// What a measurement changes in each series: the stored point of the bucket it falls in, merged with it, or a new point.
export function rollup(point: Point, stored: readonly Sample[]) {
	return Array.map([SERIES[10], SERIES[60], SERIES[1440], SERIES[10_080], SERIES[43_200]] as const, step => {
		// A reading covers the whole second its CPU was read, or none when it wasn't.
		const fresh: Sample = {
			...point,
			apps: Option.map(
				point.apps,
				Array.map(app => ({
					...app,
					cpuCoverage: Option.match(app.cpu, {onNone: () => Duration.zero, onSome: () => point.appsCoverage})
				}))
			),
			since: point.time,
			step
		}
		return pipe(
			stored,
			Array.findFirst(row => Duration.equals(row.step, step)),
			Option.match({onNone: () => fresh, onSome: row => merge([row, fresh])})
		)
	})
}

// A series' points as the range's slots, one merged point each.
export function history(samples: readonly Sample[], minutes: Duration.Duration, now: DateTime.Utc) {
	const window = chartWindow(minutes, now)
	const slot = resolution(minutes)
	return pipe(
		Array.filter(
			samples,
			value => DateTime.isGreaterThan(value.time, window.start) && DateTime.isLessThanOrEqualTo(value.time, now)
		),
		Array.groupBy(
			value =>
				`${Number.clamp(Math.ceil(Duration.toMillis(DateTime.distance(window.start, value.time)) / Duration.toMillis(slot)) - 1, {maximum: 59, minimum: 0})}`
		),
		Record.values,
		Array.map(merge)
	)
}

// One measurement, before it joins a series.
export function counters(stat: string, uptime: string, time: DateTime.Utc) {
	const values = Schema.decodeUnknownSync(CpuCounters)(
		pipe(
			stat,
			String.split('\n'),
			Array.head,
			Option.getOrElse(Function.constant('')),
			String.trim,
			String.split(/\s+/u),
			Array.drop(1),
			Array.take(8)
		)
	)
	return {
		cpuIdle: Duration.millis((values[3] + values[4]) * 10),
		cpuTotal: Duration.millis(Number.sumAll(values) * 10),
		time,
		uptime: Duration.seconds(Schema.decodeSync(Schema.FiniteFromString)(String.split(uptime, ' ')[0]))
	} satisfies Counters
}

function cpuUsage(
	current: {idle: Duration.Duration; total: Duration.Duration},
	elapsed: Duration.Duration,
	previous: Option.Option<{idle: Duration.Duration; total: Duration.Duration}>
) {
	const seconds = Duration.toSeconds(elapsed)
	if (Option.isNone(previous)) return Option.none<number>()
	return Option.flatMap(previous, old => {
		if (
			Duration.isLessThanOrEqualTo(current.total, old.total) ||
			Duration.isLessThan(current.idle, old.idle) ||
			seconds <= 0 ||
			seconds > 90
		) {
			return Option.none<number>()
		}
		return Option.some(
			Number.clamp(
				(1 -
					Duration.toMillis(Duration.subtract(current.idle, old.idle)) /
						Duration.toMillis(Duration.subtract(current.total, old.total))) *
					100,
				{maximum: 100, minimum: 0}
			)
		)
	})
}

// Disks from `df -B1 --output=target,size,used`, each nonempty row after its header: the two numbers end the row, so a mount point may hold spaces; a row without them fails the whole reading.
export function linuxDisks(text: string) {
	return Array.map(
		pipe(text, String.trim, String.split('\n'), Array.drop(1), Array.filter(String.isNonEmpty)),
		line => {
			const fields = Option.getOrThrowWith(String.match(/^\s*(.+?)\s+([0-9]+)\s+([0-9]+)\s*$/u)(line), () =>
				DeployError.make({message: `df wrote a row without a size and use: ${line}`})
			)
			return {
				mount: fields[1] ?? '',
				total: Schema.decodeUnknownSync(Schema.FiniteFromString)(fields[2]),
				used: Schema.decodeUnknownSync(Schema.FiniteFromString)(fields[3])
			}
		}
	) satisfies Disk[]
}

// One reading covers its second, or none when it was not read.
export function coverageOf(value: Option.Option<unknown>) {
	return Option.match(value, {onNone: () => Duration.zero, onSome: () => Duration.seconds(1)})
}

// A measurement from `/proc/meminfo`, the last disks read and `/proc/loadavg`: memory in bytes, the disks it measures and up to three load averages.
export function sample(
	current: Counters,
	memory: string,
	disks: readonly Disk[],
	previous: Option.Option<Counters>,
	load: Option.Option<string>
) {
	const values = pipe(
		String.trim(memory),
		String.split('\n'),
		Record.fromIterableWith(line => {
			const fields = String.split(line, /\s+/u)
			return [fields[0], Schema.decodeSync(Schema.FiniteFromString)(fields[1] ?? '') * 1024] as const
		})
	)
	const memoryTotal = Schema.decodeUnknownSync(Schema.Finite)(values['MemTotal:'])
	const baseline = Option.filter(previous, old => Duration.isLessThan(old.uptime, current.uptime))
	const cpu = cpuUsage(
		{idle: current.cpuIdle, total: current.cpuTotal},
		Option.match(previous, {onNone: () => Duration.zero, onSome: old => DateTime.distance(old.time, current.time)}),
		Option.map(baseline, old => ({idle: old.cpuIdle, total: old.cpuTotal}))
	)
	const storageUsed = Array.match(disks, {
		onEmpty: () => Option.none<number>(),
		onNonEmpty: () => Option.some(Number.sumAll(Array.map(disks, entry => entry.used)))
	})
	const point: Point = {
		apps: Option.none(),
		appsCoverage: Duration.zero,
		cpu,
		cpuCoverage: coverageOf(cpu),
		memoryCoverage: Duration.seconds(1),
		memoryTotal,
		memoryUsed: memoryTotal - Schema.decodeUnknownSync(Schema.Finite)(values['MemAvailable:']),
		storageCoverage: coverageOf(storageUsed),
		storageUsed,
		time: current.time
	}
	return {
		disks,
		load: Schema.decodeSync(LoadAverages)(
			pipe(
				Option.getOrElse(load, Function.constant('')),
				String.trim,
				String.split(/\s+/u),
				Array.filter(String.isNonEmpty),
				Array.take(3)
			)
		),
		point
	}
}

// A cgroup whose whole subtree is one app: a service other than a user manager, a Docker container's scope, or the slice a user manager names `app-<name>.slice` for what its sibling `<name>.service` starts, like T3 Code's agents; a template's instances share such a slice without that sibling, so it's walked into.
export function appCgroup(path: string, siblings: readonly string[]) {
	const name = Option.getOrElse(Array.last(String.split(path, '/')), Function.constant(''))
	if (Option.isSome(String.match(/^docker-[a-f0-9]{12,64}\.scope$/u)(name))) return true
	if (String.endsWith('.service')(name)) return Option.isNone(String.match(/^user@[0-9]+\.service$/u)(name))
	return Option.exists(String.match(/\/user@[0-9]+\.service\/app\.slice\/app-([^/]+)\.slice$/u)(path), match =>
		Array.contains(siblings, `${match[1]}.service`)
	)
}

function statField(text: string, name: string) {
	return Option.flatMap(String.match(new RegExp(`^${name} ([0-9]+)$`, 'mu'))(text), match =>
		Number.parse(match[1] ?? '')
	)
}

// A cgroup's CPU time so far in microseconds, and the memory the machine can't reclaim from it: anonymous, shared and unreclaimable kernel memory.
export function cgroupUsage(cpuStat: string, memoryStat: string) {
	return Option.map(
		Option.all({
			anon: statField(memoryStat, 'anon'),
			kernel: statField(memoryStat, 'kernel'),
			reclaimable: statField(memoryStat, 'slab_reclaimable'),
			shmem: statField(memoryStat, 'shmem'),
			usage: statField(cpuStat, 'usage_usec')
		}),
		fields => ({
			memory: fields.anon + fields.shmem + Number.max(0, fields.kernel - fields.reclaimable),
			usage: Duration.millis(fields.usage / 1000)
		})
	)
}

export type AppReading = {
	cgroups: Record<CgroupPath, {id: AppId; memory: number; usage: Duration.Duration}>
	time: DateTime.Utc
	total: Duration.Duration
}

// Each app holding at least 1 MiB, with its CPU since the previous reading as a share of the whole machine, measured per cgroup so one that restarted or appeared doesn't hide the others; `total` counts the machine's CPU time in /proc/stat's 10 ms ticks.
export function appShares(current: AppReading, previous: Option.Option<AppReading>) {
	const elapsed = Option.match(previous, {
		onNone: () => Duration.zero,
		onSome: old => Duration.subtract(current.total, old.total)
	})
	const measured =
		Duration.isGreaterThan(elapsed, Duration.zero) &&
		Option.exists(previous, old =>
			pipe(old.time, DateTime.distance(current.time), Duration.isLessThanOrEqualTo(Duration.seconds(90)))
		)
	return pipe(
		Record.toEntries(Array.groupBy(Record.toEntries(current.cgroups), entry => entry[1].id)),
		Array.filter(entry => Number.sumAll(Array.map(entry[1], cgroup => cgroup[1].memory)) >= 1024 ** 2),
		Array.map(entry => {
			const [id, cgroups] = entry
			const deltas = Array.getSomes(
				Array.map(cgroups, cgroup =>
					pipe(
						Option.flatMap(previous, old => Record.get(old.cgroups, cgroup[0])),
						Option.filter(old => measured && Duration.isGreaterThanOrEqualTo(cgroup[1].usage, old.usage)),
						Option.map(old => Duration.toMicros(Duration.subtract(cgroup[1].usage, old.usage)))
					)
				)
			)
			return {
				cpu: Array.match(deltas, {
					onEmpty: () => Option.none(),
					onNonEmpty: () =>
						Option.some(
							pipe(
								(Number.sumAll(deltas) / 1000 / Duration.toMillis(elapsed)) * 100,
								Number.clamp({maximum: 100, minimum: 0}),
								Number.round(2)
							)
						)
				}),
				id,
				memory: Number.round(Number.sumAll(Array.map(cgroups, cgroup => cgroup[1].memory)) / 1024, 0) * 1024
			}
		})
	)
}

// The history's tables, as the sampler writes them and the charts read them.
export function makeStore(sql: SqlClient.SqlClient) {
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
	return {
		deleteExpired,
		deleteProcessSamples,
		listBuckets,
		listProcessSamples,
		listSeries,
		saveProcessSamples,
		saveSamples
	}
}
