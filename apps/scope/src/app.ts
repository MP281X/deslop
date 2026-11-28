import {Command, Component, Router, Subscription, UiSchema} from '@effect/ui'
import type {Mount} from '@effect/ui'

import {Array, Boolean, DateTime, Function, Option, Predicate, Schema, String, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {chooseToolbar} from '@deslop/components/model'
import type {ToolbarAction} from '@deslop/components/model'
import {OpenUrl, Refresh, shellApp, slide} from '@deslop/runtime/client/shell'
import type {AppScreen} from '@deslop/runtime/client/shell'
import {DateTimeUtcFromFiniteMillis, TimeFrame} from '@deslop/runtime/shared/time'

import {ScopeRoute, failureOf, levelOf, rangeOf, readScope} from '#reads'
import type {Search} from '#reads'

import {
	OperationKey,
	activeOperationId,
	controls,
	operationRows,
	select,
	selectionOf,
	shownSearch,
	sourceSearch
} from '#operations/screen.ts'
import {AppName, Overview, SpanId, TraceId, TraceTree, rangeStart} from '#telemetry/contract.ts'
import {detailOf, traceMenu, traceRow} from '#traces/screen.ts'

const OverviewRead = AsyncResult.Schema({error: Schema.Unknown, success: Overview})
const TraceRead = AsyncResult.Schema({error: Schema.Unknown, success: TraceTree})

type Model = typeof Model.Type
const Model = Schema.Struct({
	chartWidth: Schema.Finite,
	history: Schema.Array(ScopeRoute),
	historyIndex: Schema.Int,
	knownSources: Schema.Array(AppName),
	opened: Schema.Option(AppName),
	overview: OverviewRead,
	route: ScopeRoute,
	trace: Schema.optionalKey(Schema.Struct({id: TraceId, result: TraceRead}))
})

type Message = typeof Message.Type
const Message = UiSchema.TaggedEnum({
	Action: {id: Schema.String},
	Back: {},
	OpenLink: {url: Schema.String},
	Operation: {operation: OperationKey},
	Overview: {range: TimeFrame, result: OverviewRead},
	Resize: {width: Schema.Finite},
	Route: {route: ScopeRoute},
	Span: {id: SpanId},
	Trace: {id: TraceId},
	TraceRead: {id: TraceId, result: TraceRead}
})

type HistoryMode = typeof HistoryMode.Type
const HistoryMode = Schema.Literals(['push', 'replace'])
type Step = Component.Step<Model, Message, never>

function selectionFor(model: Model) {
	return selectionOf(AsyncResult.value(model.overview), {
		...model.route.search,
		source: Option.orElse(model.route.search.source, () => model.opened)
	})
}

function pickedTraceOf(model: Model) {
	return Option.map(selectionFor(model).activeTrace, trace => trace.id)
}

function traceReadOf(model: Model) {
	const id = pickedTraceOf(model)
	if (model.trace !== undefined && Option.contains(id, model.trace.id)) return model.trace.result
	return AsyncResult.initial()
}

function openedSearch(model: Model) {
	return shownSearch(model.route.search, selectionFor(model), Option.isSome(AsyncResult.value(model.overview)))
}

function navigate($: Step, search: Search, history: HistoryMode = 'replace') {
	const route = {...$.model.route, search}
	if (ScopeRoute.print(route) === ScopeRoute.print($.model.route)) return $.model
	const index = $.model.historyIndex
	const nextHistory = Boolean.match(history === 'push', {
		onFalse: () =>
			Array.map($.model.history, (entry, position) => {
				if (position === index) return route
				return entry
			}),
		onTrue: () => pipe($.model.history, Array.take(index + 1), Array.append(route))
	})
	return $.evolve({history: nextHistory}).run(
		Command.asNoop(Router.patchSearch(ScopeRoute, $.model.route, search, {history}))
	)
}

function selectTrace($: Step, iphone: boolean, trace: TraceId, span: Option.Option<SpanId>) {
	const operation = Option.getOrUndefined(selectionFor($.model).activeKey)
	if (operation === undefined) return $.model
	const search = select(
		$.model.route.search,
		{operation, spanId: span, traceId: Option.some(trace)},
		Boolean.match(Option.isSome(span), {
			onFalse: Function.constant('Trace' as const),
			onTrue: Function.constant('Span' as const)
		})
	)
	if (levelOf(search, iphone) > levelOf($.model.route.search, iphone)) return navigate($, search, 'push')
	return navigate($, search)
}

function parentSearch(search: Search, iphone: boolean, dismissed: boolean) {
	if (!dismissed) {
		if (Option.isSome(search.span)) return {...search, pane: Option.some('Trace' as const), span: Option.none()}
		if (iphone && Option.contains(search.pane, 'Trace')) {
			return {...search, pane: Option.some('Traces' as const), trace: Option.none()}
		}
	}
	return {
		...search,
		operation: Option.none(),
		pane: Option.none(),
		side: Option.none(),
		span: Option.none(),
		trace: Option.none()
	}
}

function back($: Step, iphone: boolean, dismissed = false) {
	const parent = parentSearch($.model.route.search, iphone, dismissed)
	const level = levelOf(parent, iphone)
	const matches = pipe(
		$.model.history,
		Array.get($.model.historyIndex - 1),
		Option.exists(previous => {
			if (rangeOf(previous.search) !== rangeOf(parent) || levelOf(previous.search, iphone) !== level) return false
			const selection = selectionFor({...$.model, route: previous})
			if (!Option.contains(parent.source, Option.getOrUndefined(selection.source))) return false
			if (level === 0) return true
			return (
				Option.exists(
					selection.activeKey,
					key => Option.contains(parent.operation, key.name) && Option.contains(parent.side, key.runtime)
				) &&
				Option.match(parent.trace, {
					onNone: Function.constTrue,
					onSome: trace => Option.contains(pickedTraceOf({...$.model, route: previous}), trace)
				})
			)
		})
	)
	if (matches) return $.run(Command.asNoop(Router.Back.make({})))
	return navigate($, parent)
}

function stale<A>(result: AsyncResult.AsyncResult<A, unknown>) {
	return AsyncResult.isFailure(result) && Option.isSome(result.previousSuccess)
}

function searchForRange(model: Model, range: TimeFrame, now: DateTime.Utc) {
	const cutoff = rangeStart(range, now)
	const current = openedSearch(model)
	const keepTrace = Option.exists(
		selectionFor(model).activeTrace,
		trace => !Option.exists(trace.summary, summary => DateTime.isLessThan(summary.start, cutoff))
	)
	if (keepTrace) return {...current, range: Option.some(range)}
	return {
		...current,
		pane: Option.map(current.pane, Function.constant('Traces' as const)),
		range: Option.some(range),
		span: Option.none(),
		trace: Option.none()
	}
}

// One screen per host: the iPhone shows an operation's traces, a trace and a span on pages of their own.
function screenFor(iphone: boolean) {
	return Component.define({
		message: Message,
		model: Model,
		name: 'Scope',
		props: Schema.Struct({now: DateTimeUtcFromFiniteMillis, route: ScopeRoute})
	}).make({
		init: $ => ({
			chartWidth: 0,
			history: [$.props.route],
			historyIndex: 0,
			knownSources: [],
			opened: Option.none(),
			overview: AsyncResult.initial(),
			route: $.props.route
		}),
		parts: (p, model) => {
			const selected = selectionFor(model)
			const operations = operationRows(AsyncResult.value(model.overview), selected.source)
			const active = activeOperationId(selected.activeKey)
			const trace = Option.map(selected.activeTrace, current => `trace:${current.id}`)
			const opened = levelOf(model.route.search, iphone) > 0
			const traces = Option.match(selected.activeOperation, {
				onNone: Array.empty,
				onSome: value => value.operation.traces
			})
			const read = traceReadOf(model)
			const actions = controls({
				knownSources: model.knownSources,
				range: rangeOf(model.route.search),
				source: Option.orElse(selected.source, () => model.route.search.source),
				stale: stale(model.overview) || stale(read)
			})
			const backActions: readonly ToolbarAction[] = Boolean.match(iphone && levelOf(model.route.search, iphone) > 1, {
				onFalse: Array.empty,
				onTrue: () => [{id: 'back', label: 'Back', symbol: 'chevron.left'} satisfies ToolbarAction]
			})
			const failure = failureOf(model.overview)
			const placeActionsInDetail = opened && Option.isNone(failure)
			return {
				activeTrace: Option.getOrUndefined(trace),
				defaultId: Option.getOrUndefined(active),
				detail: detailOf({
					activeTrace: selected.activeTrace,
					chartWidth: model.chartWidth,
					failure: failureOf(read),
					loading: AsyncResult.isInitial(model.overview),
					now: p.props.now,
					pickedSpan: selected.pickedSpan,
					read
				}),
				detailToolbar: [
					...backActions,
					...traceMenu(traces, trace, p.props.now),
					...Boolean.match(placeActionsInDetail, {onFalse: Array.empty, onTrue: () => actions})
				],
				failure,
				loading: AsyncResult.isInitial(model.overview),
				openLink: p.part((el, event: string, url: string) => el.on(event, Message.OpenLink({url}))),
				operations,
				reads: [model.overview, read],
				resize: p.part((el, event: string) =>
					el.on(event, payload => {
						if (
							Predicate.hasProperty(payload, 'layout') &&
							Predicate.hasProperty(payload.layout, 'width') &&
							Predicate.isNumber(payload.layout.width)
						) {
							return Message.Resize({width: payload.layout.width})
						}
						return undefined
					})
				),
				routeMissing: false,
				selectSpan: p.part((el, event: string, id: SpanId) => el.on(event, Message.Span({id}))),
				selection: {
					back: p.part((el, event: string) =>
						el.on(
							event,
							Boolean.match(event === 'dismissed', {
								onFalse: Message.Back,
								onTrue: () => Message.Action({id: 'dismissed'})
							})
						)
					),
					id: Boolean.match(opened, {
						onFalse: Function.constUndefined,
						onTrue: () => Option.getOrElse(active, Function.constant('trace'))
					}),
					select: p.part((el, event: string, id: string) =>
						el.on(event, () => {
							if (String.startsWith('trace:')(id)) {
								return pipe(
									Array.findFirst(traces, item => `trace:${item.id}` === id),
									Option.map(item => Message.Trace({id: item.id})),
									Option.getOrUndefined
								)
							}
							return pipe(
								Array.findFirst(operations, row => row.item.id === id),
								Option.map(row => Message.Operation({operation: row.key})),
								Option.getOrUndefined
							)
						})
					)
				},
				toolbar: {
					actions: Boolean.match(placeActionsInDetail, {onFalse: () => actions, onTrue: Array.empty}),
					choose: p.part(chooseToolbar<Message>(Message.Action))
				},
				traces: Array.map(traces, item => traceRow(item, p.props.now)),
				watch: p.part((el, mount: Mount.Issued<Message, never, unknown, never>) => el.onMount(mount))
			}
		},
		subscriptions: $ => {
			const trace = Option.getOrUndefined(pickedTraceOf($.model))
			return [
				Subscription.make('Scope/Overview', rangeOf($.model.route.search), range =>
					readScope(
						reads => reads.overview(range),
						result => Message.Overview({range, result})
					)
				),
				trace !== undefined &&
					Subscription.make('Scope/Trace', trace, id =>
						readScope(
							reads => reads.trace(id),
							result => Message.TraceRead({id, result})
						)
					),
				Router.subscription(ScopeRoute, $.model.route, route => Message.Route({route}))
			]
		},
		update: {
			Action: ($, message) => {
				if (message.id === 'retry') return $.run(Command.asNoop(Refresh.make({authenticated: false})))
				if (message.id === 'back' || message.id === 'dismissed') return back($, iphone, message.id === 'dismissed')
				if (String.startsWith('app:')(message.id)) {
					return pipe(
						$.model.knownSources,
						Array.findFirst(app => message.id === `app:${app}`),
						Option.match({onNone: () => $.model, onSome: app => navigate($, sourceSearch(openedSearch($.model), app))})
					)
				}
				if (String.startsWith('range:')(message.id)) {
					return pipe(
						TimeFrame.literals,
						Array.findFirst(frame => message.id === `range:${frame}`),
						Option.match({
							onNone: () => $.model,
							onSome: value => navigate($, searchForRange($.model, value, $.props.now))
						})
					)
				}
				return pipe(
					selectionFor($.model).activeOperation,
					Option.flatMap(active =>
						Array.findFirst(active.operation.traces, current => message.id === `trace:${current.id}`)
					),
					Option.match({onNone: () => $.model, onSome: item => selectTrace($, iphone, item.id, Option.none())})
				)
			},
			Back: $ => back($, iphone),
			OpenLink: ($, message) => $.run(Command.asNoop(OpenUrl.make({url: message.url}))),
			Operation: ($, message) => {
				const search = select(
					$.model.route.search,
					{operation: message.operation, spanId: Option.none(), traceId: Option.none()},
					'Traces'
				)
				if (levelOf($.model.route.search) === 0) return navigate($, search, 'push')
				return navigate($, search)
			},
			Overview: ($, message) => {
				if (message.range !== rangeOf($.model.route.search)) return $.model
				const selection = selectionFor({...$.model, overview: message.result})
				return $.evolve({
					knownSources: Option.match(AsyncResult.value(message.result), {
						onNone: () => $.model.knownSources,
						onSome: current => Array.map(current.apps, app => app.name)
					}),
					opened: Boolean.match(Option.isSome($.model.route.search.source), {
						onFalse: () => Option.orElse($.model.opened, () => selection.source),
						onTrue: () => $.model.opened
					}),
					overview: message.result
				})
			},
			Resize: ($, message) => {
				if (message.width === $.model.chartWidth) return $.model
				return $.evolve({chartWidth: message.width})
			},
			Route: ($, message) => {
				const routeUrl = ScopeRoute.print(message.route)
				const history = $.model.history
				const known = Array.findFirstIndex(history, previous => ScopeRoute.print(previous) === routeUrl)

				return slide(
					$.evolve({
						history: Option.match(known, {onNone: () => [message.route], onSome: () => history}),
						historyIndex: Option.getOrElse(known, Function.constant(0)),
						overview: Boolean.match(rangeOf($.model.route.search) === rangeOf(message.route.search), {
							onFalse: () => AsyncResult.initial(),
							onTrue: () => $.model.overview
						}),
						route: message.route
					}),
					route => levelOf(route.search, iphone) > 0,
					$.model.route,
					message.route
				)
			},
			Span: ($, message) =>
				Option.match(pickedTraceOf($.model), {
					onNone: () => $.model,
					onSome: trace => selectTrace($, iphone, trace, Option.some(message.id))
				}),
			Trace: ($, message) => selectTrace($, iphone, message.id, Option.none()),
			TraceRead: ($, message) => {
				if (!Option.contains(pickedTraceOf($.model), message.id)) return $.model
				return $.evolve({trace: {id: message.id, result: message.result}})
			}
		}
	})
}

export type ScopeScreen = AppScreen<Component.Headless.Parts<ReturnType<typeof screenFor>>>

export function scopeApp(iphone: boolean) {
	return shellApp({
		every: '30 seconds',
		missing: 'Not found',
		name: 'Scope',
		props: Schema.Struct({route: ScopeRoute}),
		screen: screenFor(iphone)
	})
}

// The page measures the waterfall's width, which sizes its bars.
export function resized(width: number) {
	return Message.Resize({width})
}
