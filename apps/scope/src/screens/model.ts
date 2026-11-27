import {UiSchema} from '@effect/ui'

import {DateTime, Function, Option, Schema} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {DateTimeUtcFromFiniteMillis, TimeFrame} from '@deslop/runtime/shared/time'

import {AppName, Overview, SpanId, TraceId, TraceTree} from '#contracts'

import {ScopeRoute} from '#screens/routes.ts'
import {OperationKey, selectionOf} from '#screens/selection.ts'
import type {Search} from '#screens/selection.ts'

const OverviewRead = AsyncResult.Schema({error: Schema.Unknown, success: Overview})
const TraceRead = AsyncResult.Schema({error: Schema.Unknown, success: TraceTree})

export type Model = typeof Model.Type
export const Model = Schema.Struct({
	chartWidth: Schema.Finite,
	history: Schema.Array(ScopeRoute),
	historyIndex: Schema.Int,
	knownSources: Schema.Array(AppName),
	now: DateTimeUtcFromFiniteMillis,
	opened: Schema.Option(AppName),
	overview: OverviewRead,
	route: ScopeRoute,
	signInProblem: Schema.UndefinedOr(Schema.String),
	trace: Schema.optionalKey(Schema.Struct({id: TraceId, result: TraceRead}))
})

export type Message = typeof Message.Type
export const Message = UiSchema.TaggedEnum({
	Action: {id: Schema.String},
	Back: {},
	Clock: {now: DateTimeUtcFromFiniteMillis},
	OpenLink: {url: Schema.String},
	Operation: {operation: OperationKey},
	Overview: {range: TimeFrame, result: OverviewRead},
	Resize: {width: Schema.Finite},
	Retry: {},
	Route: {route: ScopeRoute},
	SignIn: {},
	SignInDone: {problem: Schema.UndefinedOr(Schema.String), signedIn: Schema.Boolean},
	Span: {id: SpanId},
	Trace: {id: TraceId},
	TraceRead: {id: TraceId, result: TraceRead}
})

export function rangeOf(search: Search) {
	return Option.getOrElse(search.range, Function.constant('24h' as const))
}

export function selectionFor(model: Model) {
	return selectionOf(AsyncResult.value(model.overview), {
		...model.route.search,
		source: Option.orElse(model.route.search.source, () => model.opened)
	})
}

export function pickedTraceOf(model: Model) {
	return Option.map(selectionFor(model).activeTrace, trace => trace.id)
}

export function traceReadOf(model: Model) {
	const id = pickedTraceOf(model)
	if (model.trace !== undefined && Option.contains(id, model.trace.id)) return model.trace.result
	return AsyncResult.initial()
}

export function levelOf(search: Search, iphone = false) {
	if (Option.isSome(search.span)) {
		if (iphone) return 3
		return 2
	}
	if (iphone && Option.contains(search.pane, 'Trace')) return 2
	if (Option.isSome(search.pane) || Option.isSome(search.operation) || Option.isSome(search.trace)) return 1
	return 0
}

export function initialModel(route: Model['route']): Model {
	return {
		chartWidth: 0,
		history: [route],
		historyIndex: 0,
		knownSources: [],
		now: DateTime.nowUnsafe(),
		opened: Option.none(),
		overview: AsyncResult.initial(),
		route,
		signInProblem: undefined
	}
}
