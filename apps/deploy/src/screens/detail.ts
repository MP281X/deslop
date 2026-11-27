import {Array, Boolean, DateTime, Function, HashMap, HashSet, Number, Option, String, pipe} from 'effect'

import {clockOf, countOf, durationOf, percentOf} from '@deslop/runtime/shared/format'

import {availablePorts, itemOwner, processTrackUsage, processTree, requestOf, workloadName} from '#contracts'
import type {AppHour, InventoryItem, MachineHistory, Row, Sample, Snapshot} from '#contracts'

import {axisPosition} from '#screens/chart.ts'
import type {Reading} from '#screens/chart.ts'
import {appFigures, appReadings, machineReadings} from '#screens/readings.ts'
import {Operation} from '#screens/reads.ts'
import {addressOf, host, machineHost, reasonOf, shown, statusLine} from '#screens/rows.ts'

function memoryOf(bytes: number) {
	return `${countOf(bytes / 1024 ** 2)} MiB`
}

const decimal = new Intl.NumberFormat('en', {maximumFractionDigits: 1})
function gib(bytes: number) {
	return decimal.format(bytes / 1024 ** 3)
}

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

	return {
		cpu: shown(latest?.cpu ?? Option.none(), percentOf),
		disk: Boolean.match(total > 0, {onFalse: Function.constant('—'), onTrue: () => `${gib(used)} / ${gib(total)} GiB`}),
		memory: Option.match(Option.fromUndefinedOr(latest), {
			onNone: Function.constant('—'),
			onSome: sample => `${gib(sample.memoryUsed)} / ${gib(sample.memoryTotal)} GiB`
		}),
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
		label: pipe([track.label.name, track.label.detail], Array.filter(String.isNonEmpty), Array.join(' ')),
		line: Boolean.match(track.lastSeen === undefined, {
			onFalse: () => `Last measured at ${track.lastSeen}`,
			onTrue: Function.constUndefined
		}),
		proportion: Boolean.match(max > 0, {onFalse: Function.constant(0), onTrue: () => (100 * track.memory) / max}),
		value: memoryOf(track.memory)
	}))
}

function endpointStatus(item: InventoryItem) {
	if (item.health === 'quiet') return undefined
	return item.health
}

function endpointsOf(row: Row, rows: readonly Row[]) {
	const free = HashMap.fromIterable(Array.map(availablePorts(rows), item => [item.id, item] as const))
	const ports = pipe(
		row.listeners,
		Array.filter(listener => Option.isSome(listener.port) && !Option.contains(listener.address, 'container')),
		Array.dedupeWith((first, second) =>
			Option.makeEquivalence<number>((left, right) => left === right)(first.port, second.port)
		),
		Array.map(listener => ({
			id: listener.id,
			label: shown(listener.port, port => `:${port}`),
			target: HashMap.get(free, listener.id)
		}))
	)
	return {
		exposures: Array.map(row.exposures, site => ({
			id: site.id,
			label: pipe(
				site.url,
				Option.map(host),
				Option.getOrElse(() => shown(site.port, port => `:${port}`))
			),
			line: Boolean.match(site.health === 'quiet', {onFalse: () => reasonOf(site), onTrue: Function.constUndefined}),
			status: endpointStatus(site),
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
	const job = Option.contains(row.item.scheduled, true)
	const charted = !job && (row.item.kind === 'service' || row.item.kind === 'container')
	const figures = appFigures(row.item, latest)
	const reason = statusLine(row, now, restart)
	const status = Boolean.match(row.item.health === 'warning' && restart === undefined, {
		onFalse: Function.constant('error' as const),
		onTrue: Function.constant('warning' as const)
	})
	const address = addressOf(row) ?? ''
	const line = Boolean.match(row.item.kind === 'container', {
		onFalse: Function.constant(address),
		onTrue: () => pipe([address, 'Container'], Array.filter(String.isNonEmpty), Array.join(' · '))
	})
	return {
		id: row.item.id,
		item: row.item,
		job,
		line: Boolean.match(job, {onFalse: Function.constant(line), onTrue: () => jobLine(row.item)}),
		...(reason !== undefined && {problem: {reason, status}}),
		readings: Boolean.match(charted, {onFalse: () => [], onTrue: () => appReadings(row.item, history)}),
		title: workloadName(row.item),
		trailing: Boolean.match(job, {
			onFalse: () => `${shown(figures.cpu, percentOf)}   ${shown(figures.memory, memoryOf)}`,
			onTrue: () => shown(row.item.next, at => clockOf(at))
		})
	}
}

export function runJob(item: InventoryItem) {
	return Operation.cases.Run.make({request: requestOf(item)})
}

export function loadAverages(history?: MachineHistory) {
	if (Array.isReadonlyArrayEmpty(history?.load ?? [])) return undefined
	return pipe(
		history?.load ?? [],
		Array.map(value => value.toFixed(2)),
		Array.join(' / ')
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

	const subtitle = pipe(
		[statusLine(row, now, restart) ?? '', addressOf(row) ?? ''],
		Array.filter(String.isNonEmpty),
		Array.join(' · ')
	)
	const jobs = Array.filter(
		rows,
		candidate =>
			item.kind === 'service' &&
			Option.contains(candidate.item.scheduled, true) &&
			candidate.item.name === String.replace(/\.service$/u, '-update.service')(item.name)
	)
	const endpoints = endpointsOf(row, rows)
	const facts = [
		...Boolean.match(Array.isReadonlyArrayNonEmpty(restarts), {
			onFalse: () => [],
			onTrue: () => [{label: 'Restarts', value: restart ?? `${restarts.length} in 1 h`}]
		}),
		...pipe(
			Array.last(restarts),
			Option.filter(() => item.running),
			Option.map(at => ({label: 'Uptime', value: durationOf(DateTime.distance(at, now))})),
			Option.toArray
		),
		...Boolean.match(Array.isReadonlyArrayNonEmpty(readings) && !scheduled, {
			onFalse: () => [],
			onTrue: () => [{label: 'Peak, mean', value: statistics(readings)}]
		}),
		...Boolean.match(scheduled, {
			onFalse: () => [],
			onTrue: () => [{label: 'Next run', value: shown(item.next, at => clockOf(at))}]
		}),
		...Boolean.match(item.kind === 'service', {onFalse: () => [], onTrue: () => [{label: 'Unit', value: item.name}]}),
		...pipe(
			item.port,
			Option.filter(() => Array.isArrayEmpty(endpoints.ports)),
			Option.map(port => ({label: 'Port', value: String.String(port)})),
			Option.toArray
		),
		...Boolean.match(Array.isReadonlyArrayNonEmpty(row.exposures), {
			onFalse: () => [],
			onTrue: () => [
				{
					label: 'Exposure',
					value: pipe(
						row.exposures,
						Array.map(site =>
							pipe(
								site.publicAccess,
								Option.contains(true),
								Boolean.match({onFalse: Function.constant('tailnet'), onTrue: Function.constant('public')})
							)
						),
						Array.dedupe,
						Array.join(' · ')
					)
				}
			]
		})
	]
	return {
		...endpoints,
		charted,
		cpu: shown(figures.cpu, percentOf),
		facts,
		jobs: Array.map(jobs, job => listItem(job, now)),
		memory: shown(figures.memory, memoryOf),
		name: workloadName(item),
		processes: Boolean.match(charted, {onFalse: () => [], onTrue: () => processes(item, now, app)}),
		readings,
		restarts,
		scheduled,
		status: Boolean.match(item.health === 'warning' && restart === undefined, {
			onFalse: () =>
				Boolean.match(item.health === 'error' || restart !== undefined, {
					onFalse: Function.constUndefined,
					onTrue: Function.constant('error' as const)
				}),
			onTrue: Function.constant('warning' as const)
		}),
		subtitle
	}
}

export function ownerOf(item?: InventoryItem) {
	if (item?.kind !== 'service' || !Option.contains(item.owned, true)) return Option.none()
	return Option.some(itemOwner(item))
}
