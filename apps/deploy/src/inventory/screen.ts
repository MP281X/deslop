import {
	Array,
	Boolean,
	DateTime,
	Equal,
	Function,
	HashMap,
	HashSet,
	Number,
	Option,
	Order,
	Result,
	Schema,
	String,
	pipe
} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {axisPosition} from '@deslop/components/chart'
import type {ToolbarAction} from '@deslop/components/model'
import {ageOf, clockOf, durationOf, percentOf} from '@deslop/runtime/shared/format'

import {Operation, appOf} from '#reads'
import type {DeployRoute} from '#reads'

import {AppId, ItemId, Snapshot} from './contract.ts'
import type {InventoryItem} from './contract.ts'
import {
	availablePorts,
	healthRank,
	itemOwner,
	processTrackUsage,
	processTree,
	requestOf,
	rowUsageOrder,
	workloadName,
	workloads
} from './shared.ts'
import type {Row} from './shared.ts'

import type {AppHour, MachineHistory, Sample} from '#metrics/contract.ts'
import {appFigures, appReadings, memoryOf, restartReason, statistics} from '#metrics/screen.ts'
import type {AppRead} from '#metrics/screen.ts'

const InventoryRead = AsyncResult.Schema({error: Schema.Unknown, success: Snapshot})

export type InventoryRead = typeof InventoryRead.Type

// This part of the screen's model, the messages that fill it, and the sheets that act on an app.
export const inventoryFields = {
	defaultApp: Schema.Option(ItemId),
	effectiveApp: Schema.Option(AppId),
	inventory: InventoryRead
}

export const inventoryMessages = {
	Inventory: {result: InventoryRead},
	OpenedLogs: {id: AppId, name: Schema.String},
	Select: {id: ItemId}
}

export const inventoryDialogs = {
	Failure: {text: Schema.String},
	Logs: {id: AppId, name: Schema.String, result: Schema.Option(Schema.Result(Schema.String, Schema.String))}
}

// Problems first, then the apps by memory, then the jobs a timer starts.
const rowOrder = pipe(
	Order.Number,
	Order.mapInput(healthRank),
	Order.combine(rowUsageOrder),
	Order.combine(Order.mapInput(Option.makeOrder(DateTime.Order), (row: Row) => row.item.next))
)

function host(url: string) {
	return pipe(url, String.replace(/^https?:\/\//u, ''), String.split('/'))[0]
}

export function shown<A>(value: Option.Option<A>, format: (value: A) => string) {
	return Option.match(value, {onNone: Function.constant('—'), onSome: format})
}

// Why an app needs a look: the failure systemd recorded, else what its detail says.
function reasonOf(item: InventoryItem) {
	return Option.match(item.failure, {onNone: () => item.detail, onSome: stop => stop.reason})
}

function reasonLine(item: InventoryItem, now: DateTime.Utc) {
	return pipe(
		item.failure,
		Option.flatMap(stop => stop.at),
		Option.match({onNone: () => reasonOf(item), onSome: at => `${reasonOf(item)} · ${ageOf(at, now)}`})
	)
}

function statusLine(row: Row, now: DateTime.Utc, restart?: string) {
	if (row.item.health !== 'quiet') return reasonLine(row.item, now)
	if (restart !== undefined) return restart
	return undefined
}

function addressOf(row: Row) {
	const url = pipe(
		[row.item, ...row.exposures],
		Array.findFirst(item => Option.isSome(item.url)),
		Option.flatMap(item => item.url)
	)
	const port = pipe(
		[row.item, ...row.listeners],
		Array.findFirst(item => Option.isSome(item.port)),
		Option.flatMap(item => item.port)
	)
	return Option.getOrUndefined(
		pipe(
			url,
			Option.map(host),
			Option.orElse(() => Option.map(port, value => `:${value}`))
		)
	)
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

export function ownerOf(item?: InventoryItem) {
	if (item?.kind !== 'service' || !Option.contains(item.owned, true)) return Option.none()
	return Option.some(itemOwner(item))
}

export function rowsOf(inventory: InventoryRead) {
	return pipe(
		AsyncResult.value(inventory),
		Option.map(snapshot => Array.sort(workloads(snapshot.items), rowOrder)),
		Option.getOrElse(Array.empty<Row>)
	)
}

// The apps and the app the route shows, kept when it is the same, with the history that belongs to it.
export function moveTo(
	inventory: InventoryRead,
	route: DeployRoute,
	current: {
		readonly appHistory: AppRead
		readonly defaultApp: Option.Option<ItemId>
		readonly effectiveApp: Option.Option<AppId>
	}
) {
	const rows = rowsOf(inventory)
	const defaultApp = Option.orElse(current.defaultApp, () =>
		pipe(
			rows,
			Array.findFirst(row => !Option.contains(row.item.scheduled, true)),
			Option.map(row => row.item.id)
		)
	)
	const id = appOf(route) ?? Option.getOrUndefined(defaultApp)
	const effectiveApp = pipe(
		rows,
		Array.findFirst(row => row.item.id === id),
		Option.flatMap(row => ownerOf(row.item))
	)
	return {
		appHistory: pipe(
			current.effectiveApp,
			Equal.equals(effectiveApp),
			Boolean.match({onFalse: () => AsyncResult.initial(), onTrue: () => current.appHistory})
		),
		defaultApp,
		effectiveApp,
		inventory
	}
}

export function actionsOf(admin: boolean, pending: boolean, item?: InventoryItem) {
	if (!admin || item === undefined) return []
	if (Option.contains(item.scheduled, true)) {
		return [
			{disabled: pending || item.running, id: 'run', label: 'Run now', symbol: 'play.fill'}
		] satisfies readonly ToolbarAction[]
	}
	if (Option.isNone(ownerOf(item))) return []
	return [
		{disabled: pending, id: 'restart', label: 'Restart', symbol: 'arrow.clockwise'},
		{disabled: pending, id: 'logs', label: 'Logs', symbol: 'doc.text'},
		{disabled: pending || !(item.active || item.running), id: 'stop', label: 'Stop', symbol: 'stop.fill'}
	] satisfies readonly ToolbarAction[]
}

export function failureSheet(
	dialog: {readonly _tag: 'Failure'} & Schema.Struct.Type<typeof inventoryDialogs.Failure>,
	pending: boolean,
	toolbar: readonly ToolbarAction[]
) {
	return {...dialog, label: 'Couldn’t complete the action', pending, toolbar}
}

export function logsSheet(
	dialog: {readonly _tag: 'Logs'} & Schema.Struct.Type<typeof inventoryDialogs.Logs>,
	pending: boolean,
	toolbar: readonly ToolbarAction[]
) {
	return {
		...dialog,
		label: `${dialog.name} logs`,
		pending,
		text: Option.match(dialog.result, {
			onNone: Function.constant('Loading logs…'),
			onSome: result =>
				Result.match(result, {
					onFailure: Function.identity,
					onSuccess: text =>
						Boolean.match(String.isNonEmpty(String.trim(text)), {
							onFalse: Function.constant('No logs'),
							onTrue: Function.constant(text)
						})
				})
		}),
		toolbar
	}
}

function processRows(item: InventoryItem, now: DateTime.Utc, history?: AppHour) {
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

// The app's detail pane: its figures, facts, endpoints, processes and jobs.
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
		processes: Boolean.match(charted, {onFalse: () => [], onTrue: () => processRows(item, now, app)}),
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
