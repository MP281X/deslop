import {Number, Option, String} from 'effect'

import type {InventoryItem} from '#services/inventory/schema.ts'

const untilNext = new Intl.RelativeTimeFormat('en', {numeric: 'auto', style: 'narrow'})

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
export function since(at: number, now: number) {
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

// Why an app needs a look: the failure systemd recorded, else what its detail says.
export function reasonOf(item: InventoryItem) {
	return Option.match(Option.fromUndefinedOr(item.failure), {onNone: () => item.detail, onSome: stop => stop.reason})
}

export function failureAge(item: InventoryItem, now: number) {
	return Option.map(Option.fromUndefinedOr(item.failure?.at), at => since(at, now))
}

export function reasonLine(item: InventoryItem, now: number) {
	return Option.match(failureAge(item, now), {
		onNone: () => reasonOf(item),
		onSome: age => `${reasonOf(item)} · ${age}`
	})
}
