import {Array, Boolean, HashSet, Number, Option, Order, String} from 'effect'

import {lowImpactIds} from '#routes/(home)/-usage.ts'
import {sourceBelongsToWorker} from '#services/inventory/lib/page.ts'
import {appUsage, dot, itemOwner, type Row, status} from '#services/inventory/lib/utils.ts'
import type {InventoryItem, RunRequest} from '#services/inventory/schema.ts'
import {chartWindow} from '#services/metrics/lib/utils.ts'
import type {MachineHistory} from '#services/metrics/schema.ts'

const size = new Intl.NumberFormat(undefined, {maximumFractionDigits: 1})

// A running job's time in its row's column, counting up from its start as m:ss.
export function counted(milliseconds: number) {
	const seconds = Number.max(0, Math.floor(milliseconds / 1000))
	return `${Math.floor(seconds / 60)}:${String.padStart(2, '0')(`${seconds % 60}`)}`
}

export function bytes(value: number) {
	if (value >= 1024 ** 4) return `${size.format(value / 1024 ** 4)} TiB`
	if (value >= 1024 ** 3) return `${size.format(value / 1024 ** 3)} GiB`
	return `${size.format(value / 1024 ** 2)} MiB`
}

export function rate(value: number) {
	return `${size.format(value)}%`
}

// The key a service or container's usage history is recorded under; loose ports have none.
export function owner(row: Row) {
	return Option.map(
		Option.liftPredicate(row.item, item => item.kind === 'service' || item.kind === 'container'),
		itemOwner
	)
}

// Failing rows first, then the apps by memory, then the jobs a timer starts.
function rank(row: Row) {
	const light = dot(row.item, status(row.item))
	if (light === 'error') return 0
	if (light === 'warning') return 1
	if (row.item.scheduled === true) return 3
	return 2
}

export const order = Order.combine(
	Order.combine(
		Order.mapInput(Order.Number, rank),
		Order.mapInput(Order.flip(Order.Number), (row: Row) => appUsage(row.item.processes ?? []).memory)
	),
	Order.mapInput(Order.Number, (row: Row) => row.item.next ?? 0)
)

function isLowImpact(row: Row, lowImpact: HashSet.HashSet<string>) {
	return dot(row.item, status(row.item)) === 'quiet' && Option.exists(owner(row), id => HashSet.has(lowImpact, id))
}

// The list's two groups: a failure, warning or app outside the chart's low-impact set stays up; a healthy low-impact app sits under its own heading. No history means no divider.
export function impactGroups(rows: readonly Row[], history?: MachineHistory) {
	const lowImpact = Option.match(Option.fromUndefinedOr(history), {
		onNone: () => HashSet.empty<string>(),
		onSome: lowImpactIds
	})
	const low = Array.filter(rows, row => isLowImpact(row, lowImpact))
	return {high: Array.filter(rows, row => !isLowImpact(row, lowImpact)), low}
}

export function ranged(rows: readonly Row[], minutes: number, history?: MachineHistory) {
	if (history === undefined) return rows
	const recorded = HashSet.fromIterable(
		Array.flatMap(history.samples, sample => Array.map(sample.apps ?? [], app => app.id))
	)
	const start = chartWindow(minutes, history.time).start
	return Array.filter(
		rows,
		row =>
			row.item.scheduled === true ||
			Option.match(owner(row), {
				onNone: () => true,
				onSome: id => HashSet.has(recorded, id) || (row.item.failure?.at ?? 0) >= start
			})
	)
}

export function failedFor(
	worker: string,
	inventoryFailure: boolean,
	sources: readonly {error: string; name: string}[],
	history?: MachineHistory
) {
	return (
		inventoryFailure ||
		history?.stale === true ||
		Array.some(sources, source => source.error !== '' && sourceBelongsToWorker(source, worker))
	)
}

export function middleEllipsis(value: string) {
	if (String.length(value) <= 28) return value
	return `${String.slice(0, 7)(value)}…${String.slice(-7)(value)}`
}

export function host(url: string) {
	return Option.getOrElse(Array.head(String.split(String.replace(/^https:\/\//u, '')(url), '/')), () => url)
}

export function runRequest(item: InventoryItem) {
	return {
		name: item.name,
		scope: item.scope ?? 'system',
		...Boolean.match(String.startsWith('remote:')(item.id), {
			onFalse: () => ({}),
			onTrue: () => ({target: item.worker})
		})
	} satisfies RunRequest
}
