import {Array, DateTime, Function, Option, Order, String, pipe} from 'effect'

import {rowUsageOrder} from '#services/inventory/lib/utils.ts'
import type {Row} from '#services/inventory/lib/utils.ts'
import type {Snapshot} from '#services/inventory/schema.ts'

export function machineHost(snapshot: Snapshot) {
	return pipe(
		snapshot.items,
		Array.findFirst(item => Option.contains(item.self, true)),
		Option.flatMap(item => item.hostname)
	)
}

// Problems first, then the apps by memory, then the jobs a timer starts.
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

export function host(url: string) {
	return pipe(url, String.replace(/^https:\/\//u, ''), String.split('/'))[0]
}

export function shown<A>(value: Option.Option<A>, format: (value: A) => string) {
	return Option.match(value, {onNone: Function.constant('—'), onSome: format})
}
