import {Array, Clock, Effect, Number, Option, Schedule, Stream, String, pipe} from 'effect'

import {AsyncResult, Atom, AtomRpc} from 'effect/reactivity'

import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/scope/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layerProtocol
}) {}

// Every app's operations and their newest traces, pushed again whenever a trace arrives.
export const overviewAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('scope.overview', undefined)),
			Stream.unwrap,
			Stream.retry($ =>
				pipe(
					$(Schedule.spaced('2 seconds')),
					Schedule.while(metadata => metadata.input._tag === 'RpcClientError')
				)
			)
		)
	)
)

// The traces the latest push added, so only they grow in; the first push shows at once.
export const arrivalsAtom = Atom.make(get => {
	const result = get(overviewAtom)
	const before = Option.flatMap(get.self<{arrived: string[]; seen: Option.Option<string[]>}>(), last => last.seen)
	if (!AsyncResult.isSuccess(result)) return {arrived: Array.empty<string>(), seen: before}
	const ids = Array.flatMap(result.value.services, service =>
		Array.flatMap(service.operations, operation => Array.map(operation.traces, trace => trace.id))
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
