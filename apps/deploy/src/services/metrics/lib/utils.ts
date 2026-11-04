import {Array, Number, Option, Order, Predicate, Record, Schema, String, pipe} from 'effect'

import type {Counters, MachineHistory, Sample} from '#services/metrics/schema.ts'

// How long samples stay at each spacing: seconds for a minute, ten seconds for ten minutes, minutes for an hour, quarter-hours for a day, hours for a week.
const TIERS = [
	{every: 1000, keep: 60_000},
	{every: 10_000, keep: 600_000},
	{every: 60_000, keep: 3_600_000},
	{every: 900_000, keep: 86_400_000},
	{every: 3_600_000, keep: 604_800_000}
] as const

export function counters(stat: string, network: string, disk: string, uptime: string, time: number) {
	const cpu = pipe(
		stat,
		String.split('\n'),
		Array.head,
		Option.getOrElse(() => ''),
		String.trim,
		String.split(/\s+/u)
	)
	const values = Schema.decodeSync(Schema.Array(Schema.FiniteFromString).check(Schema.isMinLength(5)))(
		Array.take(Array.drop(cpu, 1), 8)
	)
	const interfaces = pipe(
		network,
		String.split('\n'),
		Array.filter(line => Option.isSome(String.match(/^\s*(?:eth|en|wl)[^:]*:/u)(line))),
		Array.map(line => String.split(String.trim(line), /\s+/u))
	)
	const devices = pipe(
		disk,
		String.split('\n'),
		Array.map(line => String.split(String.trim(line), /\s+/u)),
		Array.filter(fields => Option.isSome(String.match(/^(?:[svh]d[a-z]+|nvme[0-9]+n[0-9]+)$/u)(fields[2] ?? '')))
	)
	return {
		cores: pipe(
			stat,
			String.split('\n'),
			Array.filter(line => Option.isSome(String.match(/^cpu[0-9]+\s/u)(line))),
			Array.map(line => {
				const fields = String.split(String.trim(line), /\s+/u)
				const counts = Schema.decodeSync(Schema.Array(Schema.FiniteFromString).check(Schema.isMinLength(5)))(
					Array.take(Array.drop(fields, 1), 8)
				)
				return {id: fields[0] ?? '', idle: (counts[3] ?? 0) + (counts[4] ?? 0), total: Number.sumAll(counts)}
			})
		),
		cpuIdle: (values[3] ?? 0) + (values[4] ?? 0),
		cpuTotal: Number.sumAll(values),
		diskRead: Array.reduce(
			devices,
			0,
			(total, fields) => total + Schema.decodeSync(Schema.FiniteFromString)(fields[5] ?? '') * 512
		),
		diskWrite: Array.reduce(
			devices,
			0,
			(total, fields) => total + Schema.decodeSync(Schema.FiniteFromString)(fields[9] ?? '') * 512
		),
		networkReceive: Array.reduce(
			interfaces,
			0,
			(total, fields) => total + Schema.decodeSync(Schema.FiniteFromString)(fields[1] ?? '')
		),
		networkSend: Array.reduce(
			interfaces,
			0,
			(total, fields) => total + Schema.decodeSync(Schema.FiniteFromString)(fields[9] ?? '')
		),
		time,
		uptime: Schema.decodeSync(Schema.FiniteFromString)(String.split(uptime, ' ')[0] ?? '')
	}
}

function rate(current: number, seconds: number, previous?: number) {
	if (previous === undefined || current < previous || seconds <= 0 || seconds > 90) return
	return (current - previous) / seconds
}

function cpuUsage(current: {idle: number; total: number}, seconds: number, previous?: {idle: number; total: number}) {
	if (
		previous === undefined ||
		current.total <= previous.total ||
		current.idle < previous.idle ||
		seconds <= 0 ||
		seconds > 90
	) {
		return
	}
	return Number.clamp((1 - (current.idle - previous.idle) / (current.total - previous.total)) * 100, {
		maximum: 100,
		minimum: 0
	})
}

export function sample(current: Counters, memory: string, disk: string, previous?: Counters, load?: string) {
	const values = Record.fromEntries(
		Array.map(String.split(String.trim(memory), '\n'), line => {
			const fields = String.split(line, /\s+/u)
			return [fields[0] ?? '', Schema.decodeSync(Schema.FiniteFromString)(fields[1] ?? '') * 1024] as const
		})
	)
	const seconds = (current.time - (previous?.time ?? current.time)) / 1000
	const baseline = Option.filter(Option.fromUndefinedOr(previous), old => old.uptime < current.uptime)
	const old = Option.getOrUndefined(baseline)
	return {
		cores: Array.map(current.cores ?? [], core => ({
			id: core.id,
			usage: cpuUsage(
				core,
				seconds,
				Option.getOrUndefined(Array.findFirst(old?.cores ?? [], candidate => candidate.id === core.id))
			)
		})),
		cpu: cpuUsage(
			{idle: current.cpuIdle, total: current.cpuTotal},
			seconds,
			Option.getOrUndefined(Option.map(baseline, value => ({idle: value.cpuIdle, total: value.cpuTotal})))
		),
		diskRead: rate(current.diskRead, seconds, old?.diskRead),
		diskWrite: rate(current.diskWrite, seconds, old?.diskWrite),
		disks: pipe(
			disk,
			String.trim,
			String.split('\n'),
			Array.drop(1),
			Array.filter(String.isNonEmpty),
			Array.map(line => {
				const fields = String.split(String.trim(line), /\s+/u)
				return {
					mount: fields[0] ?? '/',
					total: Schema.decodeSync(Schema.FiniteFromString)(fields[1] ?? ''),
					used: Schema.decodeSync(Schema.FiniteFromString)(fields[2] ?? '')
				}
			})
		),
		load: Schema.decodeSync(Schema.Array(Schema.FiniteFromString))(
			Array.take(Array.filter(String.split(String.trim(load ?? ''), /\s+/u), String.isNonEmpty), 3)
		),
		memoryAvailable: values['MemAvailable:'] ?? 0,
		memoryBuffers: values['Buffers:'] ?? 0,
		memoryCached: (values['Cached:'] ?? 0) + (values['SReclaimable:'] ?? 0),
		memoryTotal: values['MemTotal:'] ?? 0,
		memoryUsed: (values['MemTotal:'] ?? 0) - (values['MemAvailable:'] ?? 0),
		networkReceive: rate(current.networkReceive, seconds, old?.networkReceive),
		networkSend: rate(current.networkSend, seconds, old?.networkSend),
		swapTotal: values['SwapTotal:'] ?? 0,
		swapUsed: (values['SwapTotal:'] ?? 0) - (values['SwapFree:'] ?? 0),
		time: current.time,
		uptime: current.uptime
	} satisfies Sample
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
function mean(bucket: readonly Sample[], read: (point: Sample) => unknown) {
	const known = Array.getSomes(
		Array.map(bucket, point =>
			Option.map(Option.liftPredicate(read(point), Predicate.isNumber), value => ({
				value,
				weight: point.time - (point.since ?? point.time) + 1000
			}))
		)
	)
	if (Array.isReadonlyArrayEmpty(known)) return
	return (
		Array.reduce(known, 0, (sum, entry) => sum + entry.value * entry.weight) /
		Array.reduce(known, 0, (sum, entry) => sum + entry.weight)
	)
}

function appEntry(point: Sample, id: string) {
	return Array.findFirst(point.apps ?? [], app => app.id === id)
}

// A bucket's samples as one point: its use averaged over the bucket, so a short spike still counts; sizes, totals and disks from the latest.
function merge(bucket: Array.NonEmptyReadonlyArray<Sample>) {
	if (bucket.length === 1) return bucket[0]
	const reported = Array.filter(bucket, value => value.apps !== undefined)
	const last = Array.lastNonEmpty(bucket)
	return {
		...last,
		// An app missing from a point that reported apps used nothing then; one just started has no CPU reading yet.
		apps: Array.match(reported, {
			onEmpty: () => undefined,
			onNonEmpty: () =>
				Array.map(Array.dedupe(Array.flatMap(reported, value => Array.map(value.apps ?? [], app => app.id))), id => ({
					cpu: mean(reported, point => Option.match(appEntry(point, id), {onNone: () => 0, onSome: app => app.cpu})),
					id,
					memory: Number.round(
						mean(reported, point => Option.match(appEntry(point, id), {onNone: () => 0, onSome: app => app.memory})) ??
							0,
						0
					)
				}))
		}),
		cores: Array.map(last.cores ?? [], core => ({
			id: core.id,
			usage: mean(
				bucket,
				point => Option.getOrUndefined(Array.findFirst(point.cores ?? [], entry => entry.id === core.id))?.usage
			)
		})),
		cpu: mean(bucket, point => point.cpu),
		diskRead: mean(bucket, point => point.diskRead),
		diskWrite: mean(bucket, point => point.diskWrite),
		memoryUsed: mean(bucket, point => point.memoryUsed) ?? last.memoryUsed,
		networkReceive: mean(bucket, point => point.networkReceive),
		networkSend: mean(bucket, point => point.networkSend),
		since: bucket[0].since ?? bucket[0].time
	} satisfies Sample
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

export function history(samples: readonly Sample[], minutes: number, now: number) {
	const selected = pipe(
		Array.filter(samples, value => value.time > chartWindow(minutes, now).start && value.time <= now),
		Array.groupBy(
			value =>
				`${Number.clamp(Math.ceil((value.time - chartWindow(minutes, now).start) / resolution(minutes)) - 1, {maximum: 59, minimum: 0})}`
		),
		Record.values,
		Array.map(merge)
	)
	// Every point keeps its cores and apps, which the charts split by; mounts and load stay on the latest only.
	return Array.map(selected, (value, index) => {
		if (index === selected.length - 1) return value
		return {
			...value,
			disks: [],
			load: undefined,
			storageUsed: value.storageUsed ?? Array.reduce(value.disks, 0, (sum, disk) => sum + disk.used),
			uptime: undefined
		}
	})
}

export function compactHistory(machine: MachineHistory, minutes: number) {
	return {
		cpuModel: machine.cpuModel,
		current: Option.getOrUndefined(Array.last(machine.samples)),
		error: machine.error,
		intervalSeconds: resolution(minutes) / 1000,
		recordedSince: machine.samples[0]?.since ?? machine.samples[0]?.time,
		series: {
			cpu: Array.map(machine.samples, value => Option.map(Option.fromUndefinedOr(value.cpu), Number.round(1))),
			diskRead: Array.map(machine.samples, value =>
				Option.map(Option.fromUndefinedOr(value.diskRead), Number.round(0))
			),
			diskWrite: Array.map(machine.samples, value =>
				Option.map(Option.fromUndefinedOr(value.diskWrite), Number.round(0))
			),
			memoryUsed: Array.map(machine.samples, value => value.memoryUsed),
			networkReceive: Array.map(machine.samples, value =>
				Option.map(Option.fromUndefinedOr(value.networkReceive), Number.round(0))
			),
			networkSend: Array.map(machine.samples, value =>
				Option.map(Option.fromUndefinedOr(value.networkSend), Number.round(0))
			),
			storageUsed: Array.map(
				machine.samples,
				value => value.storageUsed ?? Array.reduce(value.disks, 0, (sum, disk) => sum + disk.used)
			),
			swapUsed: Array.map(machine.samples, value => value.swapUsed),
			time: Array.map(machine.samples, value => value.time)
		},
		stale: machine.stale,
		time: machine.time,
		worker: machine.worker
	}
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
	return Option.getOrElse(
		Option.flatMap(String.match(new RegExp(`^${name} ([0-9]+)$`, 'mu'))(text), match => Number.parse(match[1] ?? '')),
		() => 0
	)
}

// A cgroup's CPU time so far in microseconds, and the memory the machine can't reclaim from it: anonymous, shared and unreclaimable kernel memory.
export function cgroupUsage(cpuStat: string, memoryStat: string) {
	return {
		memory:
			statField(memoryStat, 'anon') +
			statField(memoryStat, 'shmem') +
			Number.max(0, statField(memoryStat, 'kernel') - statField(memoryStat, 'slab_reclaimable')),
		usage: statField(cpuStat, 'usage_usec')
	}
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
