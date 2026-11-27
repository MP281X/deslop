import {Array, DateTime, Function, Option, Order, String, pipe} from 'effect'

import {ageOf} from '@deslop/runtime/shared/format'

import {healthRank, rowUsageOrder} from '#contracts'
import type {InventoryItem, Row, Snapshot} from '#contracts'

export function machineHost(snapshot: Snapshot) {
	return pipe(
		snapshot.items,
		Array.findFirst(item => Option.contains(item.self, true)),
		Option.flatMap(item => item.hostname)
	)
}

// Problems first, then the apps by memory, then the jobs a timer starts.
export const rowOrder = pipe(
	Order.Number,
	Order.mapInput(healthRank),
	Order.combine(rowUsageOrder),
	Order.combine(Order.mapInput(Option.makeOrder(DateTime.Order), (row: Row) => row.item.next))
)

export function host(url: string) {
	return pipe(url, String.replace(/^https:\/\//u, ''), String.split('/'))[0]
}

export function shown<A>(value: Option.Option<A>, format: (value: A) => string) {
	return Option.match(value, {onNone: Function.constant('—'), onSome: format})
}

// Why an app needs a look: the failure systemd recorded, else what its detail says.
export function reasonOf(item: InventoryItem) {
	return Option.match(item.failure, {onNone: () => item.detail, onSome: stop => stop.reason})
}

function reasonLine(item: InventoryItem, now: DateTime.Utc) {
	return pipe(
		item.failure,
		Option.flatMap(stop => stop.at),
		Option.match({onNone: () => reasonOf(item), onSome: at => `${reasonOf(item)} · ${ageOf(at, now)}`})
	)
}

export function statusLine(row: Row, now: DateTime.Utc, restart?: string) {
	if (row.item.health !== 'quiet') return reasonLine(row.item, now)
	if (restart !== undefined) return restart
	return pipe(
		row.exposures,
		Array.findFirst(site => Option.isSome(site.url)),
		Option.flatMap(site => site.url),
		Option.map(host),
		Option.getOrUndefined
	)
}
