import {Array, Duration, Number, Option, String, pipe} from 'effect'

import {AsyncResult, Atom, AtomRpc} from 'effect/reactivity'

import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/scope/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layerProtocol
}) {}

// What the trace list shows: one service or every one, and only failed traces when asked.
export const filtersAtom = Atom.make({errors: false, service: ''})

// The query for the newest hundred traces of the last three days under the filters; refreshing it asks the server again.
export const tracesQueryAtom = Atom.make(get =>
	RpcClient.query('scope.traces', {
		...get(filtersAtom),
		limit: 100,
		offset: 0,
		operation: '',
		runs: 'all',
		since: Duration.days(3),
		sort: 'recent',
		text: '',
		traceId: ''
	})
)

// A new filter's first answer keeps the previous page on screen, marked waiting, instead of blanking it.
export const tracesAtom = Atom.make(get => {
	const result = get(get(tracesQueryAtom))
	if (!AsyncResult.isInitial(result)) return result
	return Option.match(get.self<typeof result>(), {
		onNone: () => result,
		onSome: previous => AsyncResult.waiting(previous)
	})
})

// The traces a refresh added under the same filters, so only they grow in; the first page and a new filter show at once.
export const arrivalsAtom = Atom.make(get => {
	const filters = get(filtersAtom)
	const result = get(tracesAtom)
	// The last settled page and its filters; a waiting or failed answer keeps it and adds nothing.
	const baseline = Option.flatMap(
		get.self<{arrived: string[]; baseline: Option.Option<{filters: typeof filters; ids: string[]}>}>(),
		before => before.baseline
	)
	if (!AsyncResult.isSuccess(result) || result.waiting) return {arrived: Array.empty<string>(), baseline}
	const ids = Array.map(result.value.entries, trace => trace.id)
	return {
		arrived: Option.match(
			Option.filter(baseline, last => last.filters === filters),
			{onNone: () => Array.empty<string>(), onSome: last => Array.difference(ids, last.ids)}
		),
		baseline: Option.some({filters, ids})
	}
})

export const servicesAtom = RpcClient.query('scope.services', undefined)

const traceAtom = Atom.family((id: string) => RpcClient.query('scope.trace', {id}))

export const selectedAtom = Atom.make(Option.none<string>())

// The picked trace; while the next one loads the previous stays on screen, marked waiting, so the axis can ease between them.
export const selectedTraceAtom = Atom.make(get =>
	Option.map(get(selectedAtom), id => {
		const result = get(traceAtom(id))
		if (!AsyncResult.isInitial(result)) return result
		return Option.match(Option.flatten(get.self<Option.Option<typeof result>>()), {
			onNone: () => result,
			onSome: previous => AsyncResult.waiting(previous)
		})
	})
)

// "now", "40s", "12m", "3h" or "2d" since a nanosecond timestamp.
export function ageOf(time: string, now: number) {
	const seconds = Number.max(
		0,
		(now - Option.getOrElse(Number.parse(pipe(time, String.slice(0, -6))), () => now)) / 1000
	)
	if (seconds < 10) return 'now'
	if (seconds < 60) return `${Number.round(seconds, 0)}s`
	if (seconds < 3600) return `${Number.round(seconds / 60, 0)}m`
	if (seconds < 86_400) return `${Number.round(seconds / 3600, 0)}h`
	return `${Number.round(seconds / 86_400, 0)}d`
}

// "@deslop/stash-server" reads "stash", "@deslop/auth-client" "auth web", "@deslop/trips-ios" "trips iOS".
export function serviceLabel(service: string) {
	return pipe(
		service,
		String.replace(/^@deslop\//u, ''),
		String.replace(/-server$/u, ''),
		String.replace(/-client$/u, ' web'),
		String.replace(/-ios$/u, ' iOS')
	)
}

// "412 ms" or "2.8 s".
export function durationOf(ms: number) {
	if (ms < 1000) return `${Number.round(ms, 0)} ms`
	return `${Number.round(ms / 1000, 1)} s`
}
