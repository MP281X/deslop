import {Array, Boolean, DateTime, Number, Option, Order, Record, Schema, String, Struct, pipe} from 'effect'

import {HistoryQuery} from '#services/metrics/schema.ts'
import type {
	AppSample,
	AppUsage,
	Counters,
	Disk,
	HistoryToolInput,
	MachineHistory,
	Sample
} from '#services/metrics/schema.ts'

// Each range's series spacing, so its 60 slots hold a few points each: seconds for a minute, ten seconds for ten minutes, minutes for an hour, quarter-hours for a day, hours for a week. A series keeps its range.
export const SERIES = {1: 1000, 10: 10_000, 60: 60_000, 1440: 900_000, 10_080: 3_600_000} as const satisfies Record<
	HistoryQuery['minutes'],
	number
>

// One measurement, before it joins a series.
export type Point = Omit<Sample, 'since' | 'step'>

export function counters(stat: string, uptime: string, time: number) {
	const values = Schema.decodeSync(Schema.Array(Schema.FiniteFromString).check(Schema.isMinLength(5)))(
		pipe(
			stat,
			String.split('\n'),
			Array.head,
			Option.getOrElse(() => ''),
			String.trim,
			String.split(/\s+/u),
			Array.drop(1),
			Array.take(8)
		)
	)
	return {
		cpuIdle: (values[3] ?? 0) + (values[4] ?? 0),
		cpuTotal: Number.sumAll(values),
		time,
		uptime: Schema.decodeSync(Schema.FiniteFromString)(String.split(uptime, ' ')[0])
	}
}

function cpuUsage(current: {idle: number; total: number}, seconds: number, previous?: {idle: number; total: number}) {
	if (
		previous === undefined ||
		current.total <= previous.total ||
		current.idle < previous.idle ||
		seconds <= 0 ||
		seconds > 90
	) {
		return Option.none<number>()
	}
	return Option.some(
		Number.clamp((1 - (current.idle - previous.idle) / (current.total - previous.total)) * 100, {
			maximum: 100,
			minimum: 0
		})
	)
}

// A Mac's counters from `os.cpus()`, in milliseconds summed over its cores; `uptime` is a monotonic clock in seconds, since the Mac's own uptime counts whole seconds.
export function cpuCounters(
	cpus: readonly {times: Record<'idle' | 'irq' | 'nice' | 'sys' | 'user', number>}[],
	uptime: number,
	time: number
) {
	return {
		cpuIdle: Number.sumAll(Array.map(cpus, cpu => cpu.times.idle)),
		cpuTotal: Number.sumAll(Array.map(cpus, cpu => Number.sumAll(Record.values(cpu.times)))),
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
	const page = Schema.decodeSync(Schema.FiniteFromString)(
		pipe(
			String.match(/page size of ([0-9]+) bytes/u)(text),
			Option.map(match => match[1] ?? ''),
			Option.getOrElse(() => '')
		)
	)
	function count(name: string) {
		return Schema.decodeSync(Schema.FiniteFromString)(pages[name] ?? '')
	}
	return {
		total,
		used: Number.clamp(
			(count('Anonymous pages') -
				count('Pages purgeable') +
				count('Pages wired down') +
				count('Pages occupied by compressor')) *
				page,
			{maximum: total, minimum: 0}
		)
	}
}

// A Mac's startup volume from `df -k /`: APFS reports the system volume's own use, so its container's use is size less available.
function diskRows(output: string) {
	return pipe(
		output,
		String.trim,
		String.split('\n'),
		Array.drop(1),
		Array.filter(String.isNonEmpty),
		Array.map(line => String.split(String.trim(line), /\s+/u))
	)
}

export function rootVolume(text: string) {
	return Array.map(diskRows(text), fields => {
		const size = Schema.decodeSync(Schema.FiniteFromString)(fields[1] ?? '') * 1024
		return {mount: '/', total: size, used: size - Schema.decodeSync(Schema.FiniteFromString)(fields[3] ?? '') * 1024}
	})
}

// A measurement from the machine's readings: memory in bytes, the disks it measures and up to three load averages.
export function reading(
	current: Counters,
	memory: {total: number; used: number},
	disks: readonly Disk[],
	load: readonly number[],
	previous?: Counters
) {
	const baseline = Option.filter(Option.fromUndefinedOr(previous), old => old.uptime < current.uptime)
	const point: Point = {
		apps: Option.none(),
		cpu: cpuUsage(
			{idle: current.cpuIdle, total: current.cpuTotal},
			(current.time - (previous?.time ?? current.time)) / 1000,
			Option.getOrUndefined(Option.map(baseline, old => ({idle: old.cpuIdle, total: old.cpuTotal})))
		),
		memoryTotal: memory.total,
		memoryUsed: memory.used,
		storageUsed: Array.match(disks, {
			onEmpty: () => Option.none(),
			onNonEmpty: () => Option.some(Number.sumAll(Array.map(disks, entry => entry.used)))
		}),
		time: current.time
	}
	return {disks, load, point}
}

// A Linux sample from `/proc/meminfo`, `df -B1 --output=target,size,used` and `/proc/loadavg`.
export function sample(current: Counters, memory: string, disk: string, previous?: Counters, load?: string) {
	const values = Record.fromEntries(
		pipe(
			String.trim(memory),
			String.split('\n'),
			Array.map(line => {
				const fields = String.split(line, /\s+/u)
				return [fields[0], Schema.decodeSync(Schema.FiniteFromString)(fields[1] ?? '') * 1024] as const
			})
		)
	)
	return reading(
		current,
		{total: values['MemTotal:'] ?? 0, used: (values['MemTotal:'] ?? 0) - (values['MemAvailable:'] ?? 0)},
		Array.map(diskRows(disk), fields => ({
			mount: fields[0],
			total: Schema.decodeSync(Schema.FiniteFromString)(fields[1] ?? ''),
			used: Schema.decodeSync(Schema.FiniteFromString)(fields[2] ?? '')
		})),
		Schema.decodeSync(Schema.Array(Schema.FiniteFromString))(
			pipe(String.trim(load ?? ''), String.split(/\s+/u), Array.filter(String.isNonEmpty), Array.take(3))
		),
		previous
	)
}

// A range's slot width: every range draws 60 slots.
export function resolution(minutes: number) {
	return minutes * 1000
}

export function chartWindow(minutes: number, now: number) {
	const end = Math.ceil(now / resolution(minutes)) * resolution(minutes)
	return {end, start: end - minutes * 60_000}
}

// The readings of a bucket's samples averaged over the time each covers, skipping missing ones: a merged point counts for its span, a second point for its second.
function mean(bucket: readonly Sample[], read: (point: Sample, index: number) => Option.Option<number>) {
	const known = Array.getSomes(
		Array.map(bucket, (point, index) =>
			Option.map(read(point, index), value => ({value, weight: point.time - point.since + 1000}))
		)
	)
	if (Array.isReadonlyArrayEmpty(known)) return Option.none<number>()
	return Option.some(
		Array.reduce(known, 0, (sum, entry) => sum + entry.value * entry.weight) /
			Array.reduce(known, 0, (sum, entry) => sum + entry.weight)
	)
}

// A bucket's samples as one point: its use averaged over the bucket, so a short spike still counts; sizes and totals from the latest.
function merge(bucket: Array.NonEmptyReadonlyArray<Sample>) {
	if (bucket.length === 1) return bucket[0]
	const reported = Array.filter(bucket, point => Option.isSome(point.apps))
	const appsById = Array.map(reported, point =>
		Record.fromEntries(
			pipe(
				point.apps,
				Option.getOrElse(Array.empty),
				Array.map(app => [app.id, app] as const)
			)
		)
	)
	// An app missing from a point that reported apps used nothing then; one just started has no CPU reading yet.
	function appMean(id: string, read: (app: AppSample) => Option.Option<number>) {
		return mean(reported, (_point, index) =>
			Option.match(Option.fromUndefinedOr(appsById[index]?.[id]), {onNone: () => Option.some(0), onSome: read})
		)
	}
	const last = Array.lastNonEmpty(bucket)
	return {
		...Struct.pick(last, ['memoryTotal', 'step', 'time']),
		apps: Array.match(reported, {
			onEmpty: () => Option.none(),
			onNonEmpty: () =>
				Option.some(
					Array.map(Array.dedupe(Array.flatMap(appsById, Record.keys)), id => ({
						...Record.getSomes({cpu: appMean(id, app => Option.fromUndefinedOr(app.cpu))}),
						id,
						memory: pipe(
							appMean(id, app => Option.some(app.memory)),
							Option.getOrElse(() => 0),
							Number.round(0)
						)
					}))
				)
		}),
		cpu: mean(bucket, point => point.cpu),
		memoryUsed: Option.getOrElse(
			mean(bucket, point => Option.some(point.memoryUsed)),
			() => last.memoryUsed
		),
		since: bucket[0].since,
		storageUsed: mean(bucket, point => point.storageUsed)
	} satisfies Sample
}

// What a measurement changes in each series: the stored point of the bucket it falls in, merged with it, or a new point.
export function rollup(point: Point, stored: readonly Sample[]) {
	const buckets = Record.fromEntries(
		Array.map(stored, row => [`${row.step}:${Math.floor(row.since / row.step)}`, row] as const)
	)
	return Array.map(HistoryQuery.fields.minutes.literals, minutes => {
		const step = SERIES[minutes]
		const fresh: Sample = {...point, since: point.time, step}
		return Option.match(Record.get(buckets, `${step}:${Math.floor(point.time / step)}`), {
			onNone: () => fresh,
			onSome: row => merge([row, fresh])
		})
	})
}

// A series' points as the range's slots, one merged point each.
export function history(samples: readonly Sample[], minutes: number, now: number) {
	const window = chartWindow(minutes, now)
	const slot = resolution(minutes)
	return pipe(
		Array.filter(samples, value => value.time > window.start && value.time <= now),
		Array.groupBy(
			value => `${Number.clamp(Math.ceil((value.time - window.start) / slot) - 1, {maximum: 59, minimum: 0})}`
		),
		Record.values,
		Array.map(merge)
	)
}

// A band's label: the page's name for the app when it has a row, else the unit or container the id names.
export function bandName(id: string, labels: Record<string, string>) {
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
	const name = Option.getOrElse(Array.last(String.split(path, '/')), () => '')
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
			usage: fields.usage
		})
	)
}

export type AppReading = {
	cgroups: Record<string, {id: string; memory: number; usage: number}>
	time: number
	total: number
}

// Each app holding at least 1 MiB, with its CPU since the previous reading as a share of the whole machine, measured per cgroup so one that restarted or appeared doesn't hide the others; `total` counts the machine's CPU time in /proc/stat's 10 ms ticks.
export function appShares(current: AppReading, previous?: AppReading) {
	const elapsed = current.total - (previous?.total ?? current.total)
	const measured = elapsed > 0 && current.time - (previous?.time ?? 0) <= 90_000
	return pipe(
		Record.toEntries(Array.groupBy(Record.toEntries(current.cgroups), entry => entry[1].id)),
		Array.filter(entry => Array.reduce(entry[1], 0, (sum, cgroup) => sum + cgroup[1].memory) >= 1024 ** 2),
		Array.map(entry => {
			const [id, cgroups] = entry
			const deltas = Array.getSomes(
				Array.map(cgroups, cgroup =>
					pipe(
						Option.fromUndefinedOr(previous?.cgroups[cgroup[0]]),
						Option.filter(old => measured && cgroup[1].usage >= old.usage),
						Option.map(old => cgroup[1].usage - old.usage)
					)
				)
			)
			return {
				...Array.match(deltas, {
					onEmpty: () => ({}),
					onNonEmpty: () => ({
						cpu: pipe(
							(Number.sumAll(deltas) / 10_000 / elapsed) * 100,
							Number.clamp({maximum: 100, minimum: 0}),
							Number.round(2)
						)
					})
				}),
				id,
				memory: Number.round(Array.reduce(cgroups, 0, (sum, cgroup) => sum + cgroup[1].memory) / 1024, 0) * 1024
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

// Each of the range's 60 slots in order: a slot without a sample stays null, as the page's charts leave it blank.
function series(machine: MachineHistory, minutes: number, read: (sample: Sample) => Option.Option<number>) {
	const start = chartWindow(minutes, machine.time).start
	const slot = resolution(minutes)
	const bySlot = Record.fromEntries(
		Array.map(
			machine.samples,
			point =>
				[`${Number.clamp(Math.ceil((point.time - start) / slot) - 1, {maximum: 59, minimum: 0})}`, point] as const
		)
	)
	return Array.makeBy(60, index =>
		pipe(
			Option.fromUndefinedOr(bySlot[`${index}`]),
			Option.flatMap(read),
			Option.map(value => Number.round(value, 1))
		)
	)
}

function appsOf(labels: Record<string, string>, latest: Sample) {
	const sorted = Array.sort(
		pipe(
			latest.apps,
			Option.getOrElse(Array.empty),
			Array.map(
				app =>
					({
						...Record.getSomes({cpu: Option.map(Option.fromUndefinedOr(app.cpu), value => Number.round(value, 1))}),
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
	const cpus = Array.getSomes(Array.map(rest, (app: AppUsage) => Option.fromUndefinedOr(app.cpu)))
	return [
		...Array.take(sorted, 15),
		{
			...Boolean.match(Array.isReadonlyArrayNonEmpty(cpus), {
				onFalse: () => ({}),
				onTrue: () => ({cpu: Number.round(Number.sumAll(cpus), 1)})
			}),
			mib: Number.sumAll(Array.map(rest, (app: AppUsage) => app.mib)),
			name: 'other'
		} satisfies AppUsage
	]
}

function workerHistory(machine: MachineHistory, minutes: number, labels: Record<string, string>) {
	const latest = Array.last(machine.samples)
	const storageTotal = diskTotal(machine)
	return {
		apps: Option.match(latest, {onNone: () => [], onSome: point => appsOf(labels, point)}),
		cpuPct: series(machine, minutes, point => point.cpu),
		diskPct: series(machine, minutes, point =>
			Option.flatMap(point.storageUsed, used => Option.map(storageTotal, total => (used / total) * 100))
		),
		...Boolean.match(String.isNonEmpty(machine.error), {onFalse: () => ({}), onTrue: () => ({error: machine.error})}),
		from: DateTime.formatIso(DateTime.makeUnsafe(chartWindow(minutes, machine.time).start)),
		memoryPct: series(machine, minutes, point => Option.some((point.memoryUsed / point.memoryTotal) * 100)),
		...Option.match(latest, {
			onNone: () => ({}),
			onSome: point => ({
				now: {
					...Record.getSomes({
						cpuPct: Option.map(point.cpu, value => Number.round(value, 1)),
						diskGiB: Option.map(point.storageUsed, used => Number.round(used / 1024 ** 3, 1)),
						diskTotalGiB: Option.map(storageTotal, total => Number.round(total / 1024 ** 3, 1))
					}),
					...Record.getSomes({load: Option.liftPredicate(machine.load, Array.isReadonlyArrayNonEmpty)}),
					memoryGiB: Number.round(point.memoryUsed / 1024 ** 3, 1),
					memoryTotalGiB: Number.round(point.memoryTotal / 1024 ** 3, 1)
				}
			})
		}),
		...Boolean.match(machine.stale, {onFalse: () => ({}), onTrue: () => ({stale: true as const})}),
		stepSeconds: resolution(minutes) / 1000,
		worker: machine.worker
	}
}

// Memory, CPU and disk as 60 aligned points per worker with the current figures and the heaviest apps, in as few tokens as the page's charts need.
export function resourceHistory(
	machines: readonly MachineHistory[],
	input: HistoryToolInput,
	names: Record<string, Record<string, string>>
) {
	return pipe(
		machines,
		Array.filter(machine => input.worker === undefined || machine.worker === input.worker),
		Array.map(machine => workerHistory(machine, input.minutes, names[machine.worker] ?? {}))
	)
}
