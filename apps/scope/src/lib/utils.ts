import {Clock, Effect, Number, Option, Schema, Stream, String, pipe} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {Atom, AtomRpc} from 'effect/reactivity'

import {toast} from '@deslop/components-web/ui/toast'
import {AuthError} from '@deslop/runtime/auth/schema'
import {withoutDeniedData} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Operation} from '#services/telemetry/schema.ts'

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/scope/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layerProtocol
}) {}

export type OperationKey = typeof OperationKey.Type
const OperationKey = Schema.Struct({app: Schema.String, name: Operation.fields.name, runtime: Operation.fields.runtime})
type Selection = typeof Selection.Type
const Selection = Schema.Struct({
	operation: OperationKey,
	spanId: Schema.optionalKey(Schema.String),
	traceId: Schema.optionalKey(Schema.String)
})
type SelectedTrace = typeof SelectedTrace.Type
const SelectedTrace = Schema.Struct({...Selection.fields, traceId: Schema.String})
type SelectedSpan = typeof SelectedSpan.Type
const SelectedSpan = Schema.Struct({...SelectedTrace.fields, spanId: Schema.String})

// Back preserves one selection. Operation and trace events establish their own selection.
const Navigation = Machine.make({
	events: Machine.events({
		Back: {},
		Operation: {operation: OperationKey},
		Span: {selection: SelectedSpan},
		Trace: {selection: SelectedTrace}
	}),
	root: Machine.state({
		states: {
			Operations: {fields: {selection: Schema.optionalKey(Selection)}},
			Span: {fields: {selection: SelectedSpan}},
			Trace: {fields: {selection: SelectedTrace}},
			Traces: {fields: {selection: Selection}}
		}
	})
}).handle({
	initial: {target: 'Operations'},
	on: {
		Operation: {data: transition => ({selection: {operation: transition.event.operation}}), target: 'Traces'},
		Span: {data: transition => ({selection: transition.event.selection}), target: 'Span'},
		Trace: {data: transition => ({selection: transition.event.selection}), target: 'Trace'}
	},
	states: {
		Operations: {},
		Span: {on: {Back: {data: transition => ({selection: transition.state.selection}), target: 'Trace'}}},
		Trace: {on: {Back: {data: transition => ({selection: transition.state.selection}), target: 'Traces'}}},
		Traces: {on: {Back: {data: transition => ({selection: transition.state.selection}), target: 'Operations'}}}
	}
})

export const navigationAtom = AtomMachine.make(Navigation)

// Every app's operations and their slowest traces, pushed again whenever a trace arrives.
export const overviewAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		withoutDeniedData(
			get,
			pipe(
				RpcClient,
				Effect.map(client => client('scope.overview', undefined)),
				Stream.unwrap
			),
			WebRuntime.reconnecting
		)
	)
)

// An open trace follows arrivals, including late children and logs that do not change its duration.
export const traceAtom = Atom.family((id: string) =>
	RpcClient.runtime.atom(get => {
		get(overviewAtom)
		return withoutDeniedData(get, Stream.fromEffect(Effect.flatMap(RpcClient, client => client('scope.trace', {id}))))
	})
)

// The page's clock, so ages keep counting on a quiet page.
export const nowAtom = Atom.make(Stream.mapEffect(Stream.tick('30 seconds'), () => Clock.currentTimeMillis))

// Copies a trace id; the result waits a moment after, while the button shows it was copied.
export const copyAtom = Atom.fn((text: string) =>
	pipe(
		Effect.tryPromise({
			catch: cause => AuthError.make({cause, message: 'Cannot copy the trace ID'}),
			try: () => navigator.clipboard.writeText(text)
		}),
		Effect.tapError(failure =>
			Effect.sync(() => toast.add({description: failure.message, title: 'Cannot copy the trace ID', type: 'error'}))
		),
		Effect.andThen(Effect.sleep('1500 millis'))
	)
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

// "412 ms", "2.8 s", "28 s", "48 min" or "1.2 h": short enough to keep to its column.
export function durationOf(ms: number) {
	// Each bound sits where rounding would reach the next unit, so 59.6 s reads 1 min, not 60 s.
	if (ms < 999.5) return `${Number.round(ms, 0)} ms`
	if (ms < 9950) return `${Number.round(ms / 1000, 1)} s`
	if (ms < 59_500) return `${Number.round(ms / 1000, 0)} s`
	if (ms < 3_570_000) return `${Number.round(ms / 60_000, 0)} min`
	return `${Number.round(ms / 3_600_000, 1)} h`
}
