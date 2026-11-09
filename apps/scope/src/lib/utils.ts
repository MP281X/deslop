import {Array, Clock, Effect, Number, Option, Order, Record, Schema, Stream, String, Struct, pipe} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'

import {withoutDeniedData} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Operation} from '#services/telemetry/schema.ts'
import type {Overview} from '#services/telemetry/schema.ts'

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
	| {readonly _tag: 'Source'; readonly app: string}
	| {readonly _tag: 'Span'; readonly selection: {operation: OperationKey; spanId: string; traceId: string}}
	| {readonly _tag: 'Trace'; readonly selection: {operation: OperationKey; traceId: string}}

export type Search = typeof Search.Type
export const Search = Schema.Struct({
	app: Schema.optionalKey(Schema.String),
	operation: Schema.optionalKey(Schema.String),
	pane: Schema.optionalKey(Pane),
	side: Schema.optionalKey(Operation.fields.runtime),
	source: Schema.optionalKey(Schema.String),
	span: Schema.optionalKey(Schema.String),
	trace: Schema.optionalKey(Schema.String)
})

export function navigationOf(search: Search) {
	return {
		path: search.pane ?? 'Operations',
		selection: Option.getOrUndefined(
			Option.map(
				Option.fromUndefinedOr(search.side),
				runtime =>
					({
						operation: {app: search.app ?? '', name: search.operation ?? '', runtime},
						...Option.match(Option.fromUndefinedOr(search.trace), {onNone: () => ({}), onSome: traceId => ({traceId})}),
						...Option.match(Option.fromUndefinedOr(search.span), {onNone: () => ({}), onSome: spanId => ({spanId})})
					}) satisfies Selection
			)
		)
	}
}

// The URL a selection produces in the given pane; a pick keeps the pane it was made in.
function select(selection: Selection, pane?: Pane) {
	return {
		app: selection.operation.app,
		operation: selection.operation.name,
		...Option.match(Option.fromUndefinedOr(pane), {onNone: () => ({}), onSome: current => ({pane: current})}),
		side: selection.operation.runtime,
		...Option.match(Option.fromUndefinedOr(selection.traceId), {onNone: () => ({}), onSome: trace => ({trace})}),
		...Option.match(Option.fromUndefinedOr(selection.spanId), {onNone: () => ({}), onSome: span => ({span})})
	} satisfies Search
}

// The chosen app is a view rather than a selection: choosing a row keeps it.
function sourceOf(search: Search, next: Search) {
	return Option.match(Option.fromUndefinedOr(search.source), {
		onNone: () => next,
		onSome: source => ({...next, source})
	})
}

// The bar chooses one app at a time and keeps a selection it contains; choosing the chosen app again changes nothing.
function sourceSearch(search: Search, app: string) {
	if (search.source === app) return search
	if (search.app !== app) {
		return {...Struct.omit(search, ['app', 'operation', 'pane', 'side', 'span', 'trace']), source: app}
	}
	return {...search, source: app}
}

export function nextSearch(search: Search, event: NavigationEvent) {
	if (event._tag === 'Source') return sourceSearch(search, event.app)
	if (event._tag === 'Operation') return sourceOf(search, select({operation: event.operation}, 'Traces'))
	if (event._tag === 'Trace') return sourceOf(search, select(event.selection, 'Trace'))
	if (event._tag === 'Span') return sourceOf(search, select(event.selection, 'Span'))
	return Option.match(
		Option.flatMap(Option.fromUndefinedOr(search.pane), current => Record.get(UP, current)),
		{onNone: () => Struct.omit(search, ['pane']), onSome: up => ({...search, pane: up})}
	) satisfies Search
}

// The app a plain open lands on: the one whose newest failed trace is newest, else the first tab.
export function openingApp(overview: Overview) {
	const failed = Array.flatMap(overview.apps, app =>
		Array.flatMap(app.operations, operation =>
			Array.getSomes(
				Array.map(operation.traces, trace =>
					Option.map(Option.fromUndefinedOr(trace.failure), () => ({app: app.name, time: BigInt(trace.time)}))
				)
			)
		)
	)
	return Option.orElse(
		Option.map(
			Array.match(failed, {
				onEmpty: () => Option.none<{app: string; time: bigint}>(),
				onNonEmpty: entries =>
					Option.some(
						Array.max(
							entries,
							Order.mapInput(Order.BigInt, entry => entry.time)
						)
					)
			}),
			entry => entry.app
		),
		() => Option.map(Array.head(overview.apps), app => app.name)
	)
}

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

export function ageOf(time: string, now: number) {
	return Option.match(Number.parse(pipe(time, String.slice(0, -6))), {
		onNone: () => '—',
		onSome: timestamp => {
			const seconds = Number.max(0, (now - timestamp) / 1000)
			if (seconds < 10) return 'now'
			if (seconds < 60) return `${Number.round(seconds, 0)}s`
			if (seconds < 3600) return `${Number.round(seconds / 60, 0)}m`
			if (seconds < 86_400) return `${Number.round(seconds / 3600, 0)}h`
			return `${Number.round(seconds / 86_400, 0)}d`
		}
	})
}

export function durationOf(ms: number) {
	// Each bound sits where rounding would reach the next unit, so 59.6 s reads 1 min, not 60 s.
	if (ms < 999.5) return `${Number.round(ms, 0)} ms`
	if (ms < 9950) return `${Number.round(ms / 1000, 1)} s`
	if (ms < 59_500) return `${Number.round(ms / 1000, 0)} s`
	if (ms < 3_570_000) return `${Number.round(ms / 60_000, 0)} min`
	return `${Number.round(ms / 3_600_000, 1)} h`
}
