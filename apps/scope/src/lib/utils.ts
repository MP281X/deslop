import {Array, Clock, Effect, Number, Option, Stream, String, pipe} from 'effect'

import {AsyncResult, Atom, AtomRpc} from 'effect/reactivity'

import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/scope/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layerProtocol
}) {}

// Every app's operations and their slowest traces, pushed again whenever a trace arrives.
export const overviewAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('scope.overview', undefined)),
			Stream.unwrap,
			WebRuntime.reconnecting
		)
	)
)

// The traces the latest push added, so only they grow in; the first push shows at once.
export const arrivalsAtom = Atom.make(get => {
	const result = get(overviewAtom)
	const before = Option.flatMap(get.self<{arrived: string[]; seen: Option.Option<string[]>}>(), last => last.seen)
	if (!AsyncResult.isSuccess(result)) return {arrived: Array.empty<string>(), seen: before}
	const ids = Array.flatMap(result.value.apps, app =>
		Array.flatMap(app.operations, operation => Array.map(operation.traces, trace => trace.id))
	)
	return {
		arrived: Option.match(before, {onNone: () => Array.empty<string>(), onSome: seen => Array.difference(ids, seen)}),
		seen: Option.some(ids)
	}
})

// One trace, keyed by its id and length, so a trace that grows while open is read again.
export const traceAtom = Atom.family((key: string) =>
	RpcClient.query('scope.trace', {id: Option.getOrElse(Array.head(String.split(key, ':')), () => key)})
)

// The page's clock, so ages keep counting on a quiet page.
export const nowAtom = Atom.make(Stream.mapEffect(Stream.tick('30 seconds'), () => Clock.currentTimeMillis))

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

// "412 ms", "2.8 s", "28 s", "48 min" or "1.2 h": short enough to keep to its column.
export function durationOf(ms: number) {
	// Each bound sits where rounding would reach the next unit, so 59.6 s reads 1 min, not 60 s.
	if (ms < 999.5) return `${Number.round(ms, 0)} ms`
	if (ms < 9950) return `${Number.round(ms / 1000, 1)} s`
	if (ms < 59_500) return `${Number.round(ms / 1000, 0)} s`
	if (ms < 3_570_000) return `${Number.round(ms / 60_000, 0)} min`
	return `${Number.round(ms / 3_600_000, 1)} h`
}
