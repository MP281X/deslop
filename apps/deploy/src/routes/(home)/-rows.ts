import type {Duration} from 'effect'
import {Array, Boolean, DateTime, Function, HashSet, Option, Order, String, pipe} from 'effect'

import {lowImpactIds} from '#routes/(home)/-usage.ts'
import {itemOwner, type Row, rowUsageOrder, sourceBelongsToWorker} from '#services/inventory/lib/utils.ts'
import type {AppId, WorkerId} from '#services/inventory/schema.ts'
import {chartWindow} from '#services/metrics/lib/utils.ts'
import type {MachineHistory} from '#services/metrics/schema.ts'

// The key a service or container's usage history is recorded under; loose ports have none.
export function owner(row: Row) {
	return pipe(
		row.item,
		Option.liftPredicate(item => item.kind === 'service' || item.kind === 'container'),
		Option.map(itemOwner)
	)
}

// Failing rows first, then the apps by memory, then the jobs a timer starts.
function rank(row: Row) {
	if (row.item.health === 'error') return 0
	if (row.item.health === 'warning') return 1
	if (Option.contains(row.item.scheduled, true)) return 3
	return 2
}

export const rowOrder = pipe(
	Order.Number,
	Order.mapInput(rank),
	Order.combine(rowUsageOrder),
	Order.combine(Order.mapInput(Option.makeOrder(DateTime.Order), (row: Row) => row.item.next))
)

// The list's two groups: a failure, warning or app outside the chart's low-impact set stays up; a healthy low-impact app sits under its own heading. No history means no divider.
export function impactGroups(rows: readonly Row[], history?: MachineHistory) {
	const lowImpact = Option.match(Option.fromUndefinedOr(history), {
		onNone: () => HashSet.empty<AppId>(),
		onSome: lowImpactIds
	})
	const groups = Array.groupBy(rows, row =>
		Boolean.match(row.item.health === 'quiet' && Option.exists(owner(row), id => HashSet.has(lowImpact, id)), {
			onFalse: Function.constant('high' as const),
			onTrue: Function.constant('low' as const)
		})
	)
	return {high: groups.high ?? [], low: groups.low ?? []}
}

// The rows whose apps the range recorded; a history without app readings, such as a Mac's, keeps them all.
export function ranged(rows: readonly Row[], minutes: Duration.Duration, history?: MachineHistory) {
	if (history === undefined || !Array.some(history.samples, sample => Option.isSome(sample.apps))) return rows
	const recorded = HashSet.fromIterable(
		Array.flatMap(history.samples, sample =>
			pipe(
				sample.apps,
				Option.getOrElse(Array.empty),
				Array.map(app => app.id)
			)
		)
	)
	const start = chartWindow(minutes, history.time).start
	return Array.filter(
		rows,
		row =>
			Option.contains(row.item.scheduled, true) ||
			Option.match(owner(row), {
				onNone: Function.constTrue,
				onSome: id =>
					HashSet.has(recorded, id) ||
					pipe(
						row.item.failure,
						Option.flatMap(failure => failure.at),
						Option.exists(at => DateTime.isGreaterThanOrEqualTo(at, start))
					)
			})
	)
}

export function failureOf(
	worker: WorkerId,
	inventoryFailure: boolean,
	sources: readonly {error: Option.Option<string>; name: string}[],
	history?: MachineHistory
) {
	return (
		inventoryFailure ||
		history?.stale === true ||
		Array.some(sources, source => Option.isSome(source.error) && sourceBelongsToWorker(source, worker))
	)
}

export function middleEllipsis(value: string) {
	if (String.length(value) <= 28) return value
	return `${String.slice(0, 7)(value)}…${String.slice(-7)(value)}`
}

export function host(url: string) {
	return Option.getOrElse(Array.head(String.split(String.replace(/^https:\/\//u, '')(url), '/')), () => url)
}
