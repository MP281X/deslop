import {Command, UiSchema} from '@effect/ui'

import {DateTime, Effect, Function, Option, Schema} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {signInUrl} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis, TimeFrame} from '@deslop/runtime/shared/time'

import {AppName, Overview, SpanId, TraceId, TraceTree} from '#contracts'

import {ScopeRoute} from '#web/routes.ts'
import {OperationKey, overviewAtom, selectionOf, traceAtom} from '#web/telemetry/selection.ts'
import type {Search} from '#web/telemetry/selection.ts'

const OverviewRead = AsyncResult.Schema({error: Schema.Unknown, success: Overview})
const TraceRead = AsyncResult.Schema({error: Schema.Unknown, success: TraceTree})

export type Model = typeof Model.Type
export const Model = Schema.Struct({
	knownSources: Schema.Array(AppName),
	narrow: Schema.Boolean,
	now: DateTimeUtcFromFiniteMillis,
	opened: Schema.Option(AppName),
	overview: OverviewRead,
	route: ScopeRoute,
	show: Schema.Literals(['list', 'detail']),
	sidebarHidden: Schema.Boolean,
	trace: Schema.optionalKey(Schema.Struct({id: TraceId, result: TraceRead}))
})

export type Message = typeof Message.Type
export const Message = UiSchema.TaggedEnum({
	Clock: {now: DateTimeUtcFromFiniteMillis},
	Operation: {operation: OperationKey},
	Overview: {range: TimeFrame, result: OverviewRead},
	Posture: {narrow: Schema.Boolean},
	Range: {range: TimeFrame},
	Retry: {},
	Route: {route: ScopeRoute},
	Sidebar: {},
	Source: {app: AppName},
	Span: {id: SpanId},
	Trace: {id: TraceId},
	TraceRead: {id: TraceId, result: TraceRead}
})

export const NARROW = '(width < 640px) or ((vertical-viewport-segments: 2) and (not (horizontal-viewport-segments: 2)))'

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

export function showOf(search: Search): Model['show'] {
	if (Option.isSome(search.pane) || Option.isSome(search.operation) || Option.isSome(search.trace)) return 'detail'
	return 'list'
}

export function initialModel(route: Model['route']): Model {
	return {
		knownSources: [],
		narrow: matchMedia(NARROW).matches,
		now: DateTime.nowUnsafe(),
		opened: Option.none(),
		overview: AsyncResult.initial(),
		route,
		show: showOf(route.search),
		sidebarHidden: false
	}
}

export class Retry extends Command.Service<Retry>()('Scope/Retry', {
	args: {range: TimeFrame, trace: Schema.Option(TraceId)},
	success: Schema.Void
}) {
	static readonly layer = this.toLayer(
		Effect.map(AtomRegistry.AtomRegistry, registry => args => {
			const overview = overviewAtom(args.range)
			return Effect.sync(() => {
				if (AsyncResult.isFailure(registry.get(overview))) registry.refresh(overview)
				Option.match(args.trace, {
					onNone: Function.constVoid,
					onSome: id => {
						const atom = traceAtom(id)
						if (AsyncResult.isFailure(registry.get(atom))) registry.refresh(atom)
					}
				})
			})
		})
	)
}

export const SignIn = Command.make('Scope/SignIn', {args: {}}, () =>
	Effect.sync(() => location.replace(signInUrl(location.href)))
)
