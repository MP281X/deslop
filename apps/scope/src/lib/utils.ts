import {Clock, Effect, Number, Option, Record, Schema, Stream, String, pipe} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'

import {withoutDeniedData} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Operation} from '#services/telemetry/schema.ts'

// The pane Back returns to; from Traces it is the operations, which the URL leaves unnamed.
const UP: Record<string, Pane> = {Span: 'Trace', Trace: 'Traces'}

type Pane = typeof Pane.Type
const Pane = Schema.Literals(['Traces', 'Trace', 'Span'])

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
export type NavigationEvent =
	| {readonly _tag: 'Back'}
	| {readonly _tag: 'Operation'; readonly operation: OperationKey}
	| {readonly _tag: 'Span'; readonly selection: {operation: OperationKey; spanId: string; traceId: string}}
	| {readonly _tag: 'Trace'; readonly selection: {operation: OperationKey; traceId: string}}

// The view lives in the URL, so a reload, the browser's Back or a shared link reopens the same operation, trace and span.
const params = {
	app: Atom.searchParam('app'),
	operation: Atom.searchParam('operation'),
	pane: Atom.searchParam('pane', {schema: Pane}),
	side: Atom.searchParam('side', {schema: Operation.fields.runtime}),
	span: Atom.searchParam('span'),
	trace: Atom.searchParam('trace')
}

// Back keeps the selection and moves up one level; a new operation or trace drops the selection below it.
export const navigationAtom = Atom.writable(
	get => {
		const operation = Option.map(get(params.side), runtime => ({
			app: get(params.app),
			name: get(params.operation),
			runtime
		}))
		const trace = Option.liftPredicate(get(params.trace), String.isNonEmpty)
		const span = Option.liftPredicate(get(params.span), String.isNonEmpty)
		return {
			path: Option.getOrElse(get(params.pane), () => 'Operations' as const),
			selection: Option.getOrUndefined(
				Option.map(
					operation,
					key =>
						({
							operation: key,
							...Option.match(trace, {onNone: () => ({}), onSome: traceId => ({traceId})}),
							...Option.match(span, {onNone: () => ({}), onSome: spanId => ({spanId})})
						}) satisfies Selection
				)
			)
		}
	},
	(ctx, event: NavigationEvent) => {
		function select(selection: Selection, pane: Pane) {
			ctx.set(params.app, selection.operation.app)
			ctx.set(params.operation, selection.operation.name)
			ctx.set(params.side, Option.some(selection.operation.runtime))
			ctx.set(params.trace, selection.traceId ?? '')
			ctx.set(params.span, selection.spanId ?? '')
			ctx.set(params.pane, Option.some(pane))
		}
		if (event._tag === 'Operation') return select({operation: event.operation}, 'Traces')
		if (event._tag === 'Trace') return select(event.selection, 'Trace')
		if (event._tag === 'Span') return select(event.selection, 'Span')
		ctx.set(
			params.pane,
			Option.flatMap(ctx.get(params.pane), pane => Record.get(UP, pane))
		)
	}
)

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
