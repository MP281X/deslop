import {Duration, Number, Option, String, pipe} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'

import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/scope/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layerProtocol
}) {}

// What the trace list shows: one service or every one, and only failed traces when asked.
export const filtersAtom = Atom.make({errors: false, service: ''})

// The newest hundred traces of the last three days; the page's refresh reads them again, nothing polls.
export const tracesAtom = Atom.make(get =>
	get(
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
)

export const servicesAtom = RpcClient.query('scope.services', undefined)

export const traceAtom = Atom.family((id: string) => RpcClient.query('scope.trace', {id}))

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

// "412 ms" or "2.8 s".
export function durationOf(ms: number) {
	if (ms < 1000) return `${Number.round(ms, 0)} ms`
	return `${Number.round(ms / 1000, 1)} s`
}
