import {Array, DateTime, Duration, Function, Number, Option, Order, Record, Schema, String, Struct, pipe} from 'effect'

import {DeployError} from '#services/inventory/schema.ts'
import type {AppId, WorkerId} from '#services/inventory/schema.ts'
import {CpuCounters, HistoryMinutes, LoadAverages, VmStatPages} from '#services/metrics/schema.ts'
import type {
	AppSample,
	AppUsage,
	CgroupPath,
	Counters,
	BandId,
	CpuState,
	Disk,
	HistoryToolInput,
	MachineHistory,
	Sample,
	Point
} from '#services/metrics/schema.ts'

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

// One measurement, before it joins a series.

// judge-ignore no-unrelated-jobs -- CPU ticks and boot age are fields of one same-time Counters sample, used together to calculate utilization.
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

// A Mac's counters from `os.cpus()`, in milliseconds summed over its cores, with the supplied monotonic uptime duration and sample time, since a Mac's uptime has only whole seconds.
export function cpuCounters(
	cpus: readonly {times: Record<CpuState, number>}[],
	uptime: Duration.Duration,
	time: DateTime.Utc
) {
	return {
		cpuIdle: Duration.millis(Number.sumAll(Array.map(cpus, cpu => cpu.times.idle))),
		cpuTotal: Duration.millis(Number.sumAll(Array.map(cpus, cpu => Number.sumAll(Record.values(cpu.times))))),
		time,
		uptime
	}
}

// What Activity Monitor calls used memory, from `vm_stat`: app memory (anonymous less purgeable), wired, and what the compressor occupies.
export function vmStatMemory(text: string, total: number) {
	const pages = Record.fromEntries(
		Array.getSomes(
			pipe(
				text,
				String.split('\n'),
				Array.map(line =>
					Option.map(
						String.match(/^"?([^":]+)"?:\s+([0-9]+)\.$/u)(String.trim(line)),
						match => [match[1] ?? '', match[2] ?? ''] as const
					)
				)
			)
		)
	)
	const page = Schema.decodeUnknownSync(Schema.FiniteFromString)(
		pipe(String.match(/page size of ([0-9]+) bytes/u)(text), Option.flatMap(Array.get(1)), Option.getOrUndefined)
	)
	const counts = Schema.decodeUnknownSync(VmStatPages)(pages)
	return {
		total,
		used: Number.clamp(
			(counts['Anonymous pages'] -
				counts['Pages purgeable'] +
				counts['Pages wired down'] +
				counts['Pages occupied by compressor']) *
				page,
			{maximum: total, minimum: 0}
		)
	}
}

// Nonempty rows after df's header.
function diskRows(output: string) {
	return pipe(output, String.trim, String.split('\n'), Array.drop(1), Array.filter(String.isNonEmpty))
}

// A Mac's startup volume from `df -k /`: APFS reports only the system volume's own use, so the container's use is size less available.
export function rootVolume(text: string) {
	return Array.map(diskRows(text), line => {
		const fields = String.split(String.trim(line), /\s+/u)
		const size = Schema.decodeUnknownSync(Schema.FiniteFromString)(fields[1]) * 1024
		return {mount: '/', total: size, used: size - Schema.decodeUnknownSync(Schema.FiniteFromString)(fields[3]) * 1024}
	}) satisfies Disk[]
}

// Linux disks from `df -B1 --output=target,size,used`: the two numbers end the row, so a mount point may hold spaces; a row without them fails the whole reading.
export function linuxDisks(text: string) {
	return Array.map(diskRows(text), line => {
		const fields = Option.getOrThrowWith(String.match(/^\s*(.+?)\s+([0-9]+)\s+([0-9]+)\s*$/u)(line), () =>
			DeployError.make({message: `df wrote a row without a size and use: ${line}`})
		)
		return {
			mount: fields[1] ?? '',
			total: Schema.decodeUnknownSync(Schema.FiniteFromString)(fields[2]),
			used: Schema.decodeUnknownSync(Schema.FiniteFromString)(fields[3])
		}
	}) satisfies Disk[]
}

// One reading covers its second, or none when it was not read.
export function coverageOf(value: Option.Option<unknown>) {
	return Option.match(value, {onNone: () => Duration.zero, onSome: () => Duration.seconds(1)})
}

// A measurement from the machine's readings: memory in bytes, the disks it measures and up to three load averages.
export function reading(
	current: Counters,
	memory: {total: number; used: number},
	disks: readonly Disk[],
	load: readonly number[],
	previous: Option.Option<Counters>
) {
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
		memoryTotal: memory.total,
		memoryUsed: memory.used,
		storageCoverage: coverageOf(storageUsed),
		storageUsed,
		time: current.time
	}
	return {disks, load, point}
}

// A Linux sample from `/proc/meminfo`, the last disks read and `/proc/loadavg`.
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
	return reading(
		current,
		{
			total: Schema.decodeUnknownSync(Schema.Finite)(values['MemTotal:']),
			used:
				Schema.decodeUnknownSync(Schema.Finite)(values['MemTotal:']) -
				Schema.decodeUnknownSync(Schema.Finite)(values['MemAvailable:'])
		},
		disks,
		Schema.decodeSync(LoadAverages)(
			pipe(
				Option.getOrElse(load, Function.constant('')),
				String.trim,
				String.split(/\s+/u),
				Array.filter(String.isNonEmpty),
				Array.take(3)
			)
		),
		previous
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

// A peer's last answer and the error of its latest read, if that failed.
export type PeerHistory = {
	error: Option.Option<string>
	saved: Option.Option<{history: MachineHistory; received: DateTime.Utc}>
}

// A peer's history as the page draws it now: its last answer windowed in the peer's own clock, moved on by how long ago the answer arrived, so a clock ahead or behind this one keeps its newest points. It is stale once that answer is older than 90 seconds or the latest read failed.
export function peerHistory(
	minutes: Duration.Duration,
	now: DateTime.Utc,
	worker: WorkerId,
	peer: Option.Option<PeerHistory>
) {
	const saved = Option.flatMap(peer, current => current.saved)
	const time = Option.match(saved, {
		onNone: () => now,
		onSome: last => DateTime.addDuration(last.history.time, DateTime.distance(last.received, now))
	})
	return {
		disks: Option.match(saved, {onNone: () => [], onSome: last => last.history.disks}),
		error: Option.match(peer, {
			onNone: () => Option.some('Waiting for worker'),
			onSome: current => Option.orElse(current.error, () => Option.flatMap(current.saved, last => last.history.error))
		}),
		load: Option.match(saved, {onNone: () => [], onSome: last => last.history.load}),
		platform: Option.flatMap(saved, last => last.history.platform),
		samples: history(Option.match(saved, {onNone: () => [], onSome: last => last.history.samples}), minutes, time),
		stale:
			Option.exists(peer, current => Option.isSome(current.error)) ||
			Option.match(saved, {
				onNone: Function.constTrue,
				onSome: last =>
					last.history.stale ||
					pipe(last.received, DateTime.distance(now), Duration.isGreaterThan(Duration.seconds(90)))
			}),
		time,
		worker
	} satisfies MachineHistory
}

// A band's label: the page's name for the app when it has a row, else the unit or container the id names.
export function bandName(id: BandId, labels: Record<AppId, string>) {
	if (id === 'other') return 'Low impact'
	if (id === 'system') return 'System'
	return pipe(
		labels,
		Record.get(id),
		Option.getOrElse(() =>
			String.replaceAll(
				/^service:[a-z]+:(?:deslop-)?|\.service$/gu,
				''
			)(String.replace(/^container:/u, 'container ')(id))
		)
	)
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

function diskTotal(machine: MachineHistory) {
	return Array.match(machine.disks, {
		onEmpty: () => Option.none<number>(),
		onNonEmpty: disks => Option.some(Number.sumAll(Array.map(disks, disk => disk.total)))
	})
}

// Each of the range's 60 slots in order, with None for a missing sample or reading and Some for its rounded value.
function series(machine: MachineHistory, minutes: Duration.Duration, read: (sample: Sample) => Option.Option<number>) {
	const start = chartWindow(minutes, machine.time).start
	const slot = resolution(minutes)
	const bySlot = Record.fromIterableWith(
		machine.samples,
		point =>
			[
				`${Number.clamp(Math.ceil(Duration.toMillis(DateTime.distance(start, point.time)) / Duration.toMillis(slot)) - 1, {maximum: 59, minimum: 0})}`,
				point
			] as const
	)
	return Array.makeBy(60, index =>
		pipe(
			Option.fromUndefinedOr(bySlot[`${index}`]),
			Option.flatMap(read),
			Option.map(value => Number.round(value, 1))
		)
	)
}

function appsOf(labels: Record<AppId, string>, latest: Sample) {
	const sorted = Array.sort(
		pipe(
			latest.apps,
			Option.getOrElse(Array.empty),
			Array.map(
				app =>
					({
						cpu: Option.map(app.cpu, value => Number.round(value, 1)),
						mib: Number.round(app.memory / 1024 ** 2, 0),
						name: bandName(app.id, labels)
					}) satisfies AppUsage
			)
		),
		pipe(
			Order.flip(Order.Number),
			Order.mapInput((app: AppUsage) => app.mib),
			Order.combine(Order.mapInput(Order.String, (app: AppUsage) => app.name))
		)
	)
	if (sorted.length <= 15) return sorted
	const rest = Array.drop(sorted, 15)
	const cpus = Array.getSomes(Array.map(rest, (app: AppUsage) => app.cpu))
	return [
		...Array.take(sorted, 15),
		{
			cpu: Array.match(cpus, {
				onEmpty: () => Option.none(),
				onNonEmpty: values => Option.some(Number.round(Number.sumAll(values), 1))
			}),
			mib: Number.sumAll(Array.map(rest, (app: AppUsage) => app.mib)),
			name: 'other'
		} satisfies AppUsage
	]
}

function workerHistory(machine: MachineHistory, minutes: Duration.Duration, labels: Record<AppId, string>) {
	const latest = Array.last(machine.samples)
	const storageTotal = diskTotal(machine)
	return {
		apps: Option.match(latest, {onNone: () => [], onSome: point => appsOf(labels, point)}),
		cpuPct: series(machine, minutes, point => point.cpu),
		diskPct: series(machine, minutes, point =>
			Option.flatMap(point.storageUsed, used => Option.map(storageTotal, total => (used / total) * 100))
		),
		error: machine.error,
		from: chartWindow(minutes, machine.time).start,
		memoryPct: series(machine, minutes, point => Option.some((point.memoryUsed / point.memoryTotal) * 100)),
		now: Option.map(latest, point => ({
			cpuPct: Option.map(point.cpu, value => Number.round(value, 1)),
			diskGiB: Option.map(point.storageUsed, used => Number.round(used / 1024 ** 3, 1)),
			diskTotalGiB: Option.map(storageTotal, total => Number.round(total / 1024 ** 3, 1)),
			load: Option.liftPredicate(machine.load, Array.isReadonlyArrayNonEmpty),
			memoryGiB: Number.round(point.memoryUsed / 1024 ** 3, 1),
			memoryTotalGiB: Number.round(point.memoryTotal / 1024 ** 3, 1)
		})),
		stale: Option.liftPredicate(true as const, () => machine.stale),
		stepSeconds: resolution(minutes),
		worker: machine.worker
	}
}

// Memory, CPU and disk as 60 aligned points per worker with the current figures and the heaviest apps, in as few tokens as the page's charts need.
export function resourceHistory(
	machines: readonly MachineHistory[],
	input: HistoryToolInput,
	names: Record<string, Record<AppId, string>>
) {
	return pipe(
		machines,
		Array.filter(machine => !Option.exists(input.worker, worker => machine.worker !== worker)),
		Array.map(machine => workerHistory(machine, input.minutes, names[machine.worker] ?? {}))
	)
}
