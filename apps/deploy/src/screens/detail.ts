import {Array, Boolean, DateTime, Function, HashSet, Number, Option, String, pipe} from 'effect'

import {clockOf, countOf, durationOf, percentOf} from '@deslop/runtime/shared/format'

import {availablePorts, itemOwner, processTrackUsage, processTree, requestOf, workloadName} from '#contracts'
import type {AppHour, InventoryItem, MachineHistory, Row, Sample, Snapshot} from '#contracts'

import {axisPosition} from '#screens/chart.ts'
import type {Reading} from '#screens/chart.ts'
import {appFigures, appReadings, machineReadings} from '#screens/readings.ts'
import {Operation} from '#screens/reads.ts'
import {addressOf, host, machineHost, reasonOf, shown, statusLine} from '#screens/rows.ts'

const memoryOf = (bytes: number) => `${countOf(bytes / 1024 ** 2)} MiB`

const decimal = new Intl.NumberFormat('en', {maximumFractionDigits: 1})
const gib = (bytes: number) => decimal.format(bytes / 1024 ** 3)

function machineName(snapshot: Snapshot) {
	return Option.match(machineHost(snapshot), {
		onNone: Function.constant('Machine'),
		onSome: hostname => Array.headNonEmpty(String.split(hostname, '.'))
	})
}

export function restartReason(restarts: readonly DateTime.Utc[], now: DateTime.Utc) {
	const recent = Array.filter(restarts, at => axisPosition(at, now) >= 100 - 100 / 6 && axisPosition(at, now) <= 100)
	if (Array.isArrayEmpty(recent)) return undefined
	if (recent.length === 1) return 'Restarted once in 10 min'
	return `Restarted ${recent.length} times in 10 min`
}

function statistics(readings: readonly Reading[]) {
	const values = Array.getSomes(Array.map(readings, reading => reading.value))
	if (Array.isArrayEmpty(values)) return '—'
	return `${percentOf(Array.reduce(values, 0, Number.max))}, ${percentOf(Number.sumAll(values) / values.length)}`
}

export function machineDetail(snapshot: Snapshot, history?: MachineHistory) {
	const latest = Option.getOrUndefined(Array.last(history?.samples ?? []))
	const readings = machineReadings(history)
	const disks = history?.disks ?? []
	const used = Number.sumAll(Array.map(disks, disk => disk.used))
	const total = Number.sumAll(Array.map(disks, disk => disk.total))
	const cpu = latest?.cpu ?? Option.none()
	return {
		cpu: shown(cpu, percentOf),
		disk: Boolean.match(total > 0, {onFalse: Function.constant('—'), onTrue: () => `${gib(used)} / ${gib(total)} GiB`}),
		memory: latest === undefined ? '—' : `${gib(latest.memoryUsed)} / ${gib(latest.memoryTotal)} GiB`,
		name: machineName(snapshot),
		peak: statistics(readings),
		readings
	}
}

function processes(item: InventoryItem, now: DateTime.Utc, history?: AppHour) {
	const current = pipe(item.processes, Option.getOrElse(Array.empty), processTree, processTrackUsage)
	const keys = HashSet.fromIterable(Array.map(current, track => track.key))
	const tracks = [
		...Array.map(current, track => ({...track, lastSeen: undefined})),
		...pipe(
			history?.processes ?? [],
			Array.filter(track => !HashSet.has(keys, track.key)),
			Array.flatMap(track =>
				pipe(
					track.samples,
					Array.findLast(sample => {
						const at = axisPosition(sample.time, now)
						return at >= 0 && at <= 100
					}),
					Option.map(sample => ({
						key: track.key,
						label: track.label,
						lastSeen: clockOf(sample.time),
						memory: sample.memory
					})),
					Option.toArray
				)
			)
		)
	]
	const max = Array.reduce(tracks, 0, (value, track) => Number.max(value, track.memory))
	return Array.map(tracks, track => ({
		key: track.key,
		label: Array.join(Array.filter([track.label.name, track.label.detail], String.isNonEmpty), ' '),
		line: track.lastSeen === undefined ? undefined : `Last measured at ${track.lastSeen}`,
		proportion: max > 0 ? (100 * track.memory) / max : 0,
		value: memoryOf(track.memory)
	}))
}

function endpointsOf(row: Row, rows: readonly Row[]) {
	const free = availablePorts(rows)
	const ports = pipe(
		row.listeners,
		Array.filter(listener => Option.isSome(listener.port) && !Option.contains(listener.address, 'container')),
		Array.dedupeWith((first, second) =>
			Option.makeEquivalence<number>((left, right) => left === right)(first.port, second.port)
		),
		Array.map(listener => ({
			id: listener.id,
			label: shown(listener.port, port => `:${port}`),
			target: Array.findFirst(free, item => item.id === listener.id)
		}))
	)
	return {
		exposures: Array.map(row.exposures, site => ({
			id: site.id,
			label: Option.getOrElse(Option.map(site.url, host), () => shown(site.port, port => `:${port}`)),
			line: site.health === 'quiet' ? undefined : reasonOf(site),
			status: site.health === 'quiet' ? undefined : site.health,
			url: Option.getOrUndefined(site.url)
		})),
		ports
	}
}

function jobLine(item: InventoryItem) {
	if (item.running) return 'Job · running'
	return 'Job · next run'
}

export function listItem(row: Row, now: DateTime.Utc, restart?: string, history?: MachineHistory, latest?: Sample) {
	const item = row.item
	const job = Option.contains(item.scheduled, true)
	const charted = !job && (item.kind === 'service' || item.kind === 'container')
	const figures = appFigures(item, latest)
	const reason = statusLine(row, now, restart)
	const status = item.health === 'warning' && restart === undefined ? ('warning' as const) : ('error' as const)
	const address = addressOf(row) ?? ''
	const line =
		item.kind === 'container' ? Array.join(Array.filter([address, 'Container'], String.isNonEmpty), ' · ') : address
	return {
		id: item.id,
		item,
		job,
		line: job ? jobLine(item) : line,
		...(reason !== undefined && {problem: {reason, status}}),
		readings: charted ? appReadings(item, history) : [],
		title: workloadName(item),
		trailing: job
			? shown(item.next, at => clockOf(at))
			: `${shown(figures.cpu, percentOf)}   ${shown(figures.memory, memoryOf)}`
	}
}

export function runJob(item: InventoryItem) {
	return Operation.cases.Run.make({request: requestOf(item)})
}

export function loadAverages(history?: MachineHistory) {
	if (Array.isReadonlyArrayEmpty(history?.load ?? [])) return undefined
	return Array.join(
		Array.map(history?.load ?? [], value => value.toFixed(2)),
		' / '
	)
}

export function appDetail(row: Row, rows: readonly Row[], now: DateTime.Utc, history?: MachineHistory, app?: AppHour) {
	const item = row.item
	const scheduled = Option.contains(item.scheduled, true)
	const charted = !scheduled && (item.kind === 'service' || item.kind === 'container')
	const readings = appReadings(item, history)
	const figures = appFigures(item, Option.getOrUndefined(Array.last(history?.samples ?? [])))
	const restarts = app?.restarts ?? []
	const restart = restartReason(restarts, now)
	const line = statusLine(row, now, restart)
	const address = addressOf(row)
	const subtitle = Array.join(Array.filter([line ?? '', address ?? ''], String.isNonEmpty), ' · ')
	const jobs = Array.filter(
		rows,
		candidate =>
			item.kind === 'service' &&
			Option.contains(candidate.item.scheduled, true) &&
			candidate.item.name === String.replace(/\.service$/u, '-update.service')(item.name)
	)
	const endpoints = endpointsOf(row, rows)
	const facts = [
		...(Array.isReadonlyArrayNonEmpty(restarts)
			? [{label: 'Restarts', value: restart ?? `${restarts.length} in 1 h`}]
			: []),
		...pipe(
			Array.last(restarts),
			Option.filter(() => item.running),
			Option.map(at => ({label: 'Uptime', value: durationOf(DateTime.distance(at, now))})),
			Option.toArray
		),
		...(Array.isReadonlyArrayNonEmpty(readings) && !scheduled
			? [{label: 'Peak, mean', value: statistics(readings)}]
			: []),
		...(scheduled ? [{label: 'Next run', value: shown(item.next, at => clockOf(at))}] : []),
		...(item.kind === 'service' ? [{label: 'Unit', value: item.name}] : []),
		...(!Array.isArrayNonEmpty(endpoints.ports) && Option.isSome(item.port)
			? [{label: 'Port', value: String.String(item.port.value)}]
			: []),
		...(Array.isReadonlyArrayNonEmpty(row.exposures)
			? [
					{
						label: 'Exposure',
						value: pipe(
							row.exposures,
							Array.map(site => (Option.contains(site.publicAccess, true) ? 'public' : 'tailnet')),
							Array.dedupe,
							Array.join(' · ')
						)
					}
				]
			: [])
	]
	return {
		...endpoints,
		charted,
		cpu: shown(figures.cpu, percentOf),
		facts,
		jobs: Array.map(jobs, job => listItem(job, now)),
		memory: shown(figures.memory, memoryOf),
		name: workloadName(item),
		processes: charted ? processes(item, now, app) : [],
		readings,
		restarts,
		scheduled,
		status:
			item.health === 'warning' && restart === undefined
				? ('warning' as const)
				: item.health === 'error' || restart !== undefined
					? ('error' as const)
					: undefined,
		subtitle
	}
}

export function ownerOf(item?: InventoryItem) {
	if (item?.kind !== 'service' || !Option.contains(item.owned, true)) return Option.none()
	return Option.some(itemOwner(item))
}
