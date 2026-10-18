import {Array, Boolean, Number, Option, Order, String, pipe} from 'effect'
import type {Schema} from 'effect'

import type {Entry, Query, Resource, Stats} from '#services/telemetry/schema.ts'

export function serviceName(resource: Resource) {
	return pipe(
		resource.attributes ?? [],
		Array.findFirst(attribute => attribute.key === 'service.name'),
		Option.flatMap(attribute => Option.liftPredicate(attribute.value['stringValue'], String.isString)),
		Option.getOrElse(() => 'unknown')
	)
}

export function displayValue(value: unknown) {
	return JSON.stringify(value, undefined, 2)
}

export function logMessage(body: Schema.JsonObject) {
	if (String.isString(body['stringValue'])) return body['stringValue']
	return displayValue(body)
}

export function attributeText(resource: Resource) {
	return Array.join(
		Array.map(resource.attributes ?? [], attribute => `${attribute.key} ${displayValue(attribute.value)}`),
		' '
	)
}

export function durationMs(start: string, end: string) {
	if (BigInt(end) < BigInt(start)) return 0
	return pipe(Number.parse(`${BigInt(end) - BigInt(start)}`), Option.getOrThrow) / 1_000_000
}

export function summary(entries: Entry[], query: Query) {
	const times = Array.sort(
		Array.map(entries, entry => entry.durationMs),
		Order.Number
	)
	function percentile(ratio: number) {
		return pipe(
			Array.get(times, Number.max(0, Math.ceil(times.length * ratio) - 1)),
			Option.getOrElse(() => 0)
		)
	}
	return {
		count: entries.length,
		errors: Array.filter(entries, entry => entry.status === 2).length,
		from: query.from,
		maxMs: percentile(1),
		p50Ms: percentile(0.5),
		p95Ms: percentile(0.95),
		to: query.to
	} satisfies Stats
}

export function orderEntries(entries: Entry[], sort: Query['sort']) {
	return Array.sort(
		entries,
		Boolean.match(sort === 'slowest', {
			onFalse: () => Order.flip(Order.mapInput(Order.BigInt, (entry: Entry) => BigInt(entry.time))),
			onTrue: () => Order.flip(Order.mapInput(Order.Number, (entry: Entry) => entry.durationMs))
		})
	)
}
