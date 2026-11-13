import {Array, Boolean, DateTime, Number, Option, Order, Predicate, Record, Schema, String, Struct, pipe} from 'effect'

import type {AppUsage, Counters, HistoryToolInput, MachineHistory, Sample} from '#services/metrics/schema.ts'

// How long samples stay at each spacing: seconds for a minute, ten seconds for ten minutes, minutes for an hour, quarter-hours for a day, hours for a week.
const TIERS = [
	{every: 1000, keep: 60_000},
	{every: 10_000, keep: 600_000},
	{every: 60_000, keep: 3_600_000},
	{every: 900_000, keep: 86_400_000},
	{every: 3_600_000, keep: 604_800_000}
] as const

function cpuFields(fields: readonly string[]) {
	return Schema.decodeSync(Schema.Array(Schema.FiniteFromString).check(Schema.isMinLength(5)))(
		Array.take(Array.drop(fields, 1), 8)
	)
}

export function counters(stat: string, uptime: string, time: number) {
	const values = cpuFields(
		pipe(
			stat,
			String.split('\n'),
			Array.head,
			Option.getOrElse(() => ''),
			String.trim,
			String.split(/\s+/u)
		)
	)
	return {
		cores: pipe(
			stat,
			String.split('\n'),
			Array.filter(line => Option.isSome(String.match(/^cpu[0-9]+\s/u)(line))),
			Array.map(line => {
				const fields = String.split(String.trim(line), /\s+/u)
				const counts = cpuFields(fields)
				return {id: fields[0], idle: (counts[3] ?? 0) + (counts[4] ?? 0), total: Number.sumAll(counts)}
			})
		),
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

function coreUsages(current: Counters, seconds: number, old?: Counters) {
	const oldCores = Array.groupBy(old?.cores ?? [], core => core.id)
	return Array.map(current.cores ?? [], core => ({
		id: core.id,
		...Record.getSomes({usage: cpuUsage(core, seconds, Option.getOrUndefined(Array.head(oldCores[core.id] ?? [])))})
	}))
}

// A Mac's counters from `os.cpus()`, in milliseconds per core; `uptime` is a monotonic clock in seconds, since the Mac's own uptime counts whole seconds.
export function cpuCounters(
	cpus: readonly {times: Record<'idle' | 'irq' | 'nice' | 'sys' | 'user', number>}[],
	uptime: number,
	time: number
) {
	const cores = Array.map(cpus, (cpu, index) => ({
		id: `cpu${index}`,
		idle: cpu.times.idle,
		total: Number.sumAll(Record.values(cpu.times))
	}))
	return {
		cores,
		cpuIdle: Number.sumAll(Array.map(cores, core => core.idle)),
		cpuTotal: Number.sumAll(Array.map(cores, core => core.total)),
		time,
		uptime
	}
}

// What Activity Monitor calls used memory, from `vm_stat`: app memory (anonymous less purgeable), wired, and what the compressor occupies.
export function vmStatMemory(text: string, total: number) {
	const pages = Record.fromEntries(
		Array.getSomes(
			Array.map(String.split(text, '\n'), line =>
				Option.map(
					String.match(/^"?([^":]+)"?:\s+([0-9]+)\.$/u)(String.trim(line)),
					match => [match[1] ?? '', match[2] ?? ''] as const
				)
			)
		)
	)
	const page = Schema.decodeSync(Schema.FiniteFromString)(
		Option.getOrElse(
			Option.map(String.match(/page size of ([0-9]+) bytes/u)(text), match => match[1] ?? ''),
			() => ''
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
export function rootVolume(text: string) {
	return Array.map(Array.filter(Array.drop(String.split(String.trim(text), '\n'), 1), String.isNonEmpty), line => {
		const fields = String.split(String.trim(line), /\s+/u)
		const size = Schema.decodeSync(Schema.FiniteFromString)(fields[1] ?? '') * 1024
		return {mount: '/', total: size, used: size - Schema.decodeSync(Schema.FiniteFromString)(fields[3] ?? '') * 1024}
	})
}

// A sample from the machine's readings: memory in bytes, the disks it measures and up to three load averages.
export function reading(
	current: Counters,
	memory: {total: number; used: number},
	disks: Sample['disks'],
	load: readonly number[],
	previous?: Counters
) {
	const used = Number.sumAll(Array.map(disks, entry => entry.used))
	const seconds = (current.time - (previous?.time ?? current.time)) / 1000
	const baseline = Option.filter(Option.fromUndefinedOr(previous), old => old.uptime < current.uptime)
	const value: Sample = {
		cores: coreUsages(current, seconds, Option.getOrUndefined(baseline)),
		...Record.getSomes({
			cpu: cpuUsage(
				{idle: current.cpuIdle, total: current.cpuTotal},
				seconds,
				Option.getOrUndefined(Option.map(baseline, old => ({idle: old.cpuIdle, total: old.cpuTotal})))
			)
		}),
		disks,
		load,
		memoryTotal: memory.total,
		memoryUsed: memory.used,
		time: current.time,
		uptime: current.uptime
	}
	return Array.match(disks, {onEmpty: () => value, onNonEmpty: () => ({...value, storageUsed: used})})
}

// A Linux sample from `/proc/meminfo`, `df -B1 --output=target,size,used` and `/proc/loadavg`.
export function sample(current: Counters, memory: string, disk: string, previous?: Counters, load?: string) {
	const values = Record.fromEntries(
		Array.map(String.split(String.trim(memory), '\n'), line => {
			const fields = String.split(line, /\s+/u)
			return [fields[0], Schema.decodeSync(Schema.FiniteFromString)(fields[1] ?? '') * 1024] as const
		})
	)
	return reading(
		current,
		{total: values['MemTotal:'] ?? 0, used: (values['MemTotal:'] ?? 0) - (values['MemAvailable:'] ?? 0)},
		pipe(
			disk,
			String.trim,
			String.split('\n'),
			Array.drop(1),
			Array.filter(String.isNonEmpty),
			Array.map(line => {
				const fields = String.split(String.trim(line), /\s+/u)
				return {
					mount: fields[0],
					total: Schema.decodeSync(Schema.FiniteFromString)(fields[1] ?? ''),
					used: Schema.decodeSync(Schema.FiniteFromString)(fields[2] ?? '')
				}
			})
		),
		Schema.decodeSync(Schema.Array(Schema.FiniteFromString))(
			Array.take(Array.filter(String.split(String.trim(load ?? ''), /\s+/u), String.isNonEmpty), 3)
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
function mean(bucket: readonly Sample[], read: (point: Sample, index: number) => unknown) {
	const known = Array.getSomes(
		Array.map(bucket, (point, index) =>
			Option.map(Option.liftPredicate(read(point, index), Predicate.isNumber), value => ({
				value,
				weight: point.time - (point.since ?? point.time) + 1000
			}))
		)
	)
	if (Array.isReadonlyArrayEmpty(known)) return Option.none<number>()
	return Option.some(
		Array.reduce(known, 0, (sum, entry) => sum + entry.value * entry.weight) /
			Array.reduce(known, 0, (sum, entry) => sum + entry.weight)
	)
}

// A bucket's samples as one point: its use averaged over the bucket, so a short spike still counts; sizes, totals and disks from the latest.
function merge(bucket: Array.NonEmptyReadonlyArray<Sample>) {
	if (bucket.length === 1) return bucket[0]
	const reported = Array.filter(bucket, value => value.apps !== undefined)
	const appsById = Array.map(reported, point =>
		Record.fromEntries(Array.map(point.apps ?? [], app => [app.id, app] as const))
	)
	function appAt(index: number, id: string) {
		return Option.fromUndefinedOr(appsById[index]?.[id])
	}
	const last = Array.lastNonEmpty(bucket)
	const merged: Sample = {
		...last,
		// An app missing from a point that reported apps used nothing then; one just started has no CPU reading yet.
		...Array.match(reported, {
			onEmpty: () => ({}),
			onNonEmpty: () => ({
				apps: Array.map(
					Array.dedupe(Array.flatMap(reported, value => Array.map(value.apps ?? [], app => app.id))),
					id => ({
						...Record.getSomes({
							cpu: mean(reported, (_point, index) =>
								Option.match(appAt(index, id), {onNone: () => 0, onSome: app => app.cpu})
							)
						}),
						id,
						memory: Number.round(
							Option.getOrElse(
								mean(reported, (_point, index) =>
									Option.match(appAt(index, id), {onNone: () => 0, onSome: app => app.memory})
								),
								() => 0
							),
							0
						)
					})
				)
			})
		}),
		cores: Array.map(last.cores ?? [], core => ({
			id: core.id,
			...Record.getSomes({
				usage: mean(
					bucket,
					point => Option.getOrUndefined(Array.findFirst(point.cores ?? [], entry => entry.id === core.id))?.usage
				)
			})
		})),
		...Record.getSomes({cpu: mean(bucket, point => point.cpu)}),
		memoryUsed: Option.getOrElse(
			mean(bucket, point => point.memoryUsed),
			() => last.memoryUsed
		),
		...Record.getSomes({storageUsed: mean(bucket, point => point.storageUsed)}),
		since: bucket[0].since ?? bucket[0].time
	}
	return merged
}

export function compact(samples: readonly Sample[], now: number) {
	return pipe(
		samples,
		Array.filter(value => value.time >= now - 168 * 3_600_000),
		Array.groupBy(value => {
			// The coarsest spacing whose whole bucket is past what the finer one keeps, so a bucket merges once it's complete.
			const tier = Option.getOrElse(
				Array.findLast(
					TIERS,
					(candidate, index) =>
						now - (Math.floor(value.time / candidate.every) + 1) * candidate.every >= (TIERS[index - 1]?.keep ?? 0)
				),
				() => TIERS[0]
			)
			return `${tier.every}:${Math.floor(value.time / tier.every)}`
		}),
		Record.values,
		Array.map(merge),
		Array.sort(Order.mapInput(Order.Number, (value: Sample) => value.time))
	)
}

// The machine's used disk space: its recorded total, or the sum of its mounts for a sample from before that field.
export function usedStorage(point: Sample) {
	return point.storageUsed ?? Array.reduce(point.disks, 0, (sum, disk) => sum + disk.used)
}

export function history(samples: readonly Sample[], minutes: number, now: number) {
	const window = chartWindow(minutes, now)
	const slot = resolution(minutes)
	const selected = pipe(
		Array.filter(samples, value => value.time > window.start && value.time <= now),
		Array.groupBy(
			value => `${Number.clamp(Math.ceil((value.time - window.start) / slot) - 1, {maximum: 59, minimum: 0})}`
		),
		Record.values,
		Array.map(merge)
	)
	// Every point keeps its cores and apps, which the charts split by; mounts and load stay on the latest only.
	return Array.map(selected, (value, index) => {
		if (index === selected.length - 1) return value
		const point: Sample = {...pipe(value, Struct.omit(['load', 'uptime'])), disks: [], storageUsed: usedStorage(value)}
		return point
	})
}

// A band's label: the page's name for the app when it has a row, else the unit or container the id names.
export function bandName(id: string, labels: Record<string, string>) {
	if (id === 'other') return 'Low impact'
	if (id === 'system') return 'System'
	return Option.getOrElse(Record.get(labels, id), () =>
		String.replaceAll(/^service:[a-z]+:(?:deslop-)?|\.service$/gu, '')(String.replace(/^container:/u, 'container ')(id))
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
	return Array.map(
		Array.filter(
			Record.toEntries(Array.groupBy(Record.toEntries(current.cgroups), entry => entry[1].id)),
			entry => Array.reduce(entry[1], 0, (sum, cgroup) => sum + cgroup[1].memory) >= 1024 ** 2
		),
		entry => {
			const [id, cgroups] = entry
			const deltas = Array.getSomes(
				Array.map(cgroups, cgroup =>
					Option.map(
						Option.filter(
							Option.fromUndefinedOr(previous?.cgroups[cgroup[0]]),
							old => measured && cgroup[1].usage >= old.usage
						),
						old => cgroup[1].usage - old.usage
					)
				)
			)
			return {
				...Array.match(deltas, {
					onEmpty: () => ({}),
					onNonEmpty: () => ({
						cpu: Number.round(
							Number.clamp((Number.sumAll(deltas) / 10_000 / elapsed) * 100, {maximum: 100, minimum: 0}),
							2
						)
					})
				}),
				id,
				memory: Number.round(Array.reduce(cgroups, 0, (sum, cgroup) => sum + cgroup[1].memory) / 1024, 0) * 1024
			}
		}
	)
}

function rounded(value: number) {
	return Number.round(value, 1)
}

// The machine's used disk space: its recorded total, or the sum of its mounts for a sample from before that field.
function diskUsed(point: Sample) {
	const recorded = Option.fromUndefinedOr(point.storageUsed)
	if (Option.isSome(recorded)) return recorded
	if (Array.isReadonlyArrayNonEmpty(point.disks)) {
		return Option.some(Number.sumAll(Array.map(point.disks, disk => disk.used)))
	}
	return Option.none()
}

function diskTotal(machine: MachineHistory) {
	return Option.map(
		Array.findLast(machine.samples, point => Array.isReadonlyArrayNonEmpty(point.disks)),
		point => Number.sumAll(Array.map(point.disks, disk => disk.total))
	)
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
		Option.map(Option.flatMap(Option.fromUndefinedOr(bySlot[`${index}`]), read), rounded)
	)
}

function appsOf(labels: Record<string, string>, latest: Sample) {
	const sorted = Array.sort(
		Array.map(
			latest.apps ?? [],
			app =>
				({
					cpu: Option.getOrUndefined(Option.map(Option.fromUndefinedOr(app.cpu), rounded)),
					mib: Number.round(app.memory / 1024 ** 2, 0),
					name: bandName(app.id, labels)
				}) satisfies AppUsage
		),
		Order.combine(
			Order.mapInput(Order.flip(Order.Number), (app: AppUsage) => app.mib),
			Order.mapInput(Order.String, (app: AppUsage) => app.name)
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
				onTrue: () => ({cpu: rounded(Number.sumAll(cpus))})
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
		cpuPct: series(machine, minutes, point => Option.fromUndefinedOr(point.cpu)),
		diskPct: series(machine, minutes, point =>
			Option.flatMap(diskUsed(point), used => Option.map(storageTotal, total => (used / total) * 100))
		),
		...Boolean.match(String.isNonEmpty(machine.error), {onFalse: () => ({}), onTrue: () => ({error: machine.error})}),
		from: DateTime.formatIso(DateTime.makeUnsafe(chartWindow(minutes, machine.time).start)),
		memoryPct: series(machine, minutes, point => Option.some((point.memoryUsed / point.memoryTotal) * 100)),
		...Option.match(latest, {
			onNone: () => ({}),
			onSome: point => ({
				now: {
					...Record.getSomes({cpuPct: Option.map(Option.fromUndefinedOr(point.cpu), rounded)}),
					...Record.getSomes({
						diskGiB: Option.map(diskUsed(point), used => rounded(used / 1024 ** 3)),
						diskTotalGiB: Option.map(storageTotal, total => rounded(total / 1024 ** 3))
					}),
					...Record.getSomes({load: Option.filter(Option.fromUndefinedOr(point.load), Array.isReadonlyArrayNonEmpty)}),
					memoryGiB: rounded(point.memoryUsed / 1024 ** 3),
					memoryTotalGiB: rounded(point.memoryTotal / 1024 ** 3)
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
		Array.filter(machines, machine => input.worker === undefined || machine.worker === input.worker),
		Array.map(machine => workerHistory(machine, input.minutes, names[machine.worker] ?? {}))
	)
}
