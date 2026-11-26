import {Command, UiSchema} from '@effect/ui'

import {DateTime, Effect, Function, Option, Schema, Stream, pipe} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'
import type {Atom} from 'effect/reactivity'

import {signInUrl} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis, TimeFrame} from '@deslop/runtime/shared/time'

import {OperationKey, Search, overviewAtom, selectionOf, traceAtom} from '#lib/telemetry.ts'
import {AppName, Overview, SpanId, TraceId, TraceTree} from '#services/telemetry/schema.ts'

const OverviewRead = AsyncResult.Schema({error: Schema.Unknown, success: Overview})
const TraceRead = AsyncResult.Schema({error: Schema.Unknown, success: TraceTree})

export type Model = typeof Model.Type
export const Model = Schema.Struct({
	knownSources: Schema.Array(AppName),
	narrow: Schema.Boolean,
	now: DateTimeUtcFromFiniteMillis,
	opened: Schema.Option(AppName),
	overview: OverviewRead,
	search: Search,
	show: Schema.Literals(['list', 'detail']),
	sidebarHidden: Schema.Boolean,
	trace: Schema.optionalKey(Schema.Struct({id: TraceId, result: TraceRead}))
})

export type Message = typeof Message.Type
export const Message = UiSchema.TaggedEnum({
	Clock: {now: DateTimeUtcFromFiniteMillis},
	History: {search: Search},
	Operation: {operation: OperationKey},
	Overview: {range: TimeFrame, result: OverviewRead},
	Posture: {narrow: Schema.Boolean},
	Range: {range: TimeFrame},
	Retry: {},
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
		...model.search,
		source: Option.orElse(model.search.source, () => model.opened)
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

type SearchParams = typeof SearchParams.Type
const SearchParams = Schema.fromURLSearchParams(Search)

export function readSearch() {
	return Option.getOrElse(Schema.decodeOption(SearchParams)(new URLSearchParams(location.search)), () =>
		Schema.decodeSync(Search)({})
	)
}

export function showOf(search: Search): Model['show'] {
	if (Option.isSome(search.pane) || Option.isSome(search.operation) || Option.isSome(search.trace)) return 'detail'
	return 'list'
}

export function initialModel(search: Search): Model {
	return {
		knownSources: [],
		narrow: matchMedia(NARROW).matches,
		now: DateTime.nowUnsafe(),
		opened: Option.none(),
		overview: AsyncResult.initial(),
		search,
		show: showOf(search),
		sidebarHidden: false
	}
}

export function observe<A, M>(atom: Atom.Atom<A>, message: (value: A) => M) {
	return pipe(
		AtomRegistry.AtomRegistry,
		Effect.map(registry => pipe(registry, AtomRegistry.toStream(atom), Stream.map(message))),
		Stream.unwrap
	)
}

export const WriteSearch = Command.make('Scope/WriteSearch', {args: {search: Search}}, args =>
	pipe(
		Schema.encodeEffect(SearchParams)(args.search),
		Effect.map(params => {
			const query = params.toString()
			const next = query && `?${query}`
			if (next !== location.search) history.pushState(undefined, '', `${location.pathname}${next}${location.hash}`)
		}),
		Effect.ignore({log: 'Warn', message: 'Scope could not write the selection to the URL'})
	)
)

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
