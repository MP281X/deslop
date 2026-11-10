import {Array, Boolean, DateTime, Number, Option, Order, Record, pipe} from 'effect'

import {bandName, chartWindow, resolution} from '#services/metrics/lib/utils.ts'
import type {AppUsage, HistoryToolInput, MachineHistory, Sample} from '#services/metrics/schema.ts'

function rounded(value: number) {
	return Number.round(value, 1)
}

// The machine's used disk space: its recorded total, or the sum of its mounts for a sample from before that field.
function diskUsed(sample: Sample) {
	const recorded = Option.fromUndefinedOr(sample.storageUsed)
	if (Option.isSome(recorded)) return recorded
	if (Array.isReadonlyArrayNonEmpty(sample.disks)) {
		return Option.some(Array.reduce(sample.disks, 0, (sum, disk) => sum + disk.used))
	}
	return Option.none()
}

function diskTotal(machine: MachineHistory) {
	return Option.map(
		Array.findLast(machine.samples, sample => Array.isReadonlyArrayNonEmpty(sample.disks)),
		sample => Array.reduce(sample.disks, 0, (sum, disk) => sum + disk.total)
	)
}

// Each of the range's 60 slots in order: a slot without a sample stays null, as the page's charts leave it blank.
function series(machine: MachineHistory, minutes: number, read: (sample: Sample) => Option.Option<number>) {
	const start = chartWindow(minutes, machine.time).start
	const slot = resolution(minutes)
	const bySlot = Record.fromEntries(
		Array.map(
			machine.samples,
			sample =>
				[`${Number.clamp(Math.ceil((sample.time - start) / slot) - 1, {maximum: 59, minimum: 0})}`, sample] as const
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
		apps: Option.match(latest, {onNone: () => [], onSome: sample => appsOf(labels, sample)}),
		cpuPct: series(machine, minutes, sample => Option.fromUndefinedOr(sample.cpu)),
		diskPct: series(machine, minutes, sample =>
			Option.flatMap(diskUsed(sample), used => Option.map(storageTotal, total => (used / total) * 100))
		),
		from: DateTime.formatIso(DateTime.makeUnsafe(chartWindow(minutes, machine.time).start)),
		memoryPct: series(machine, minutes, sample => Option.some((sample.memoryUsed / sample.memoryTotal) * 100)),
		...Option.match(latest, {
			onNone: () => ({}),
			onSome: sample => ({
				now: {
					...Record.getSomes({cpuPct: Option.map(Option.fromUndefinedOr(sample.cpu), rounded)}),
					...Record.getSomes({
						diskGiB: Option.map(diskUsed(sample), used => rounded(used / 1024 ** 3)),
						diskTotalGiB: Option.map(storageTotal, total => rounded(total / 1024 ** 3))
					}),
					...Record.getSomes({load: Option.filter(Option.fromUndefinedOr(sample.load), Array.isReadonlyArrayNonEmpty)}),
					memoryGiB: rounded(sample.memoryUsed / 1024 ** 3),
					memoryTotalGiB: rounded(sample.memoryTotal / 1024 ** 3)
				}
			})
		}),
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
