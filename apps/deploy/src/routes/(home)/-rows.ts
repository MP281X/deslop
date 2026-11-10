import {Array, Boolean, HashSet, Number, Option, Order, Record, String} from 'effect'

import {RANGES} from '#routes/(home)/-chart.ts'
import {appUsage} from '#routes/(home)/-process-tree.ts'
import {itemOwner, type workloads} from '#services/inventory/lib/utils.ts'
import type {InventoryItem, RunRequest} from '#services/inventory/schema.ts'
import {chartWindow} from '#services/metrics/lib/utils.ts'
import type {HistoryQuery, MachineHistory} from '#services/metrics/schema.ts'

export type Row = ReturnType<typeof workloads>[number]

const untilNext = new Intl.RelativeTimeFormat('en', {numeric: 'auto', style: 'narrow'})
const size = new Intl.NumberFormat(undefined, {maximumFractionDigits: 1})

export function status(item: InventoryItem) {
	if (String.startsWith('stale')(item.state)) return 'stale'
	if (String.includes('unhealthy')(item.detail)) return 'unhealthy'
	if (item.kind === 'port') return 'listening'
	if (item.kind === 'exposure' && item.owned === true) return 'configured'
	if (item.kind === 'exposure' && item.publicAccess === true) return 'public permission'
	return String.replace(/^active · /u, '')(String.toLowerCase(item.state))
}

// Only a problem is marked: a service that runs needs no dot to say so.
export function dot(item: InventoryItem, state: string) {
	if (Option.isSome(String.match(/failed|unhealthy|Exited \([1-9]/u)(item.state + item.detail))) return 'error'
	if (state === 'stale' || state === 'public permission' || state === 'restarting') return 'warning'
	return 'quiet'
}

// How long ago a service stopped: minutes within the hour, hours within two days, then days.
function since(at: number, now: number) {
	const minutes = Number.max(0, Number.round((now - at) / 60_000, 0))
	if (minutes < 60) return untilNext.format(-minutes, 'minute')
	if (minutes < 2880) return untilNext.format(-Number.round(minutes / 60, 0), 'hour')
	return untilNext.format(-Number.round(minutes / 1440, 0), 'day')
}

// When a timer next starts the job, against the snapshot's clock: minutes within the hour, then hours.
export function nextRun(next: number, now: number) {
	const minutes = Number.max(0, Number.round((next - now) / 60_000, 0))
	if (minutes < 60) return untilNext.format(minutes, 'minute')
	return untilNext.format(Number.round(minutes / 60, 0), 'hour')
}

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

// Why a row needs a look, and for an app how long ago; a healthy row has none.
export function reasonOf(row: Row) {
	return Option.match(Option.fromUndefinedOr(row.item.failure), {
		onNone: () => row.item.detail,
		onSome: stop => stop.reason
	})
}

export function failureAge(row: Row, now: number) {
	return Option.map(Option.fromUndefinedOr(row.item.failure?.at), at => since(at, now))
}

export function reasonLine(row: Row, now: number) {
	return Option.match(failureAge(row, now), {onNone: () => reasonOf(row), onSome: age => `${reasonOf(row)} · ${age}`})
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
		Array.some(
			sources,
			source => source.error !== '' && (source.name === worker || String.startsWith(`${worker} · `)(source.name))
		)
	)
}

export function middleEllipsis(value: string) {
	if (String.length(value) <= 28) return value
	return `${String.slice(0, 7)(value)}…${String.slice(-7)(value)}`
}

export function host(url: string) {
	return Option.getOrElse(Array.head(String.split(String.replace(/^https:\/\//u, '')(url), '/')), () => url)
}

export function bandName(id: string, labels: Record<string, string>) {
	if (id === 'other') return 'Small apps'
	if (id === 'system') return 'System'
	return Option.getOrElse(Record.get(labels, id), () =>
		String.replaceAll(/^service:[a-z]+:(?:deslop-)?|\.service$/gu, '')(String.replace(/^container:/u, 'container ')(id))
	)
}

// The phoned range keeps the current range in view beside the three worth carrying.
export function rangeSet(isPhone: boolean, minutes: HistoryQuery['minutes']) {
	if (!isPhone) return RANGES
	return Array.filter(RANGES, range => range.minutes === minutes || Array.contains([60, 1440, 10_080], range.minutes))
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
