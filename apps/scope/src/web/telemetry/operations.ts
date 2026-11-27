import {Command, Component, Router, Subscription} from '@effect/ui'
import {Html} from '@effect/ui/html'

import {Array, Boolean, DateTime, Function, Layer, Option, Schema, pipe} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {blockingFailure, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {ActionShell} from '@deslop/ui/app-shell'
import {PressFeedback} from '@deslop/ui/control'
import {Split, panelUpdates, singlePane, watchPanes} from '@deslop/ui/split'
import {ReadFailure, observe} from '@deslop/ui/state'
import {historyBack, usedHistoryMotion} from '@deslop/ui/viewport'

import {rangeStart} from '#contracts'
import type {SpanId, TraceId} from '#contracts'

import {ScopeRoute} from '#web/routes.ts'
import {hasParentBehind, parentSearch} from '#web/telemetry/history.ts'
import {
	Message,
	Model,
	Retry,
	SignIn,
	initialModel,
	levelOf,
	pickedTraceOf,
	rangeOf,
	selectionFor,
	showOf
} from '#web/telemetry/model.ts'
import {DetailPane, ListPane, ScopeControls} from '#web/telemetry/panes.ts'
import {nowAtom, overviewAtom, select, shownSearch, sourceSearch, traceAtom} from '#web/telemetry/selection.ts'
import type {Search} from '#web/telemetry/selection.ts'

type Step = Component.Step<Model, Message, never>

function openedSearch(model: Model) {
	return shownSearch(model.route.search, selectionFor(model), Option.isSome(AsyncResult.value(model.overview)))
}

type NavigationMode = typeof NavigationMode.Type
const NavigationMode = Schema.Literals(['push', 'replace'])

function navigate($: Step, search: Search, history: NavigationMode = 'replace') {
	if (ScopeRoute.print({...$.model.route, search}) === ScopeRoute.print($.model.route)) {
		return $.evolve({panel: undefined})
	}
	return $.run(Command.asNoop(Router.patchSearch(ScopeRoute, $.model.route, search, {history})))
}

function selectTrace($: Step, trace: TraceId, span: Option.Option<SpanId>) {
	const operation = Option.getOrUndefined(selectionFor($.model).activeKey)
	if (operation === undefined) return $.evolve({panel: undefined})
	const spanOpen = Option.isSome(span)
	const deeper = spanOpen && levelOf($.model.route.search) < 2
	const pane = Boolean.match(spanOpen, {
		onFalse: Function.constant('Trace' as const),
		onTrue: Function.constant('Span' as const)
	})
	return navigate(
		$,
		select($.model.route.search, {operation, spanId: span, traceId: Option.some(trace)}, pane),
		Boolean.match(deeper, {onFalse: Function.constant('replace'), onTrue: Function.constant('push')})
	)
}

function completeRead<A>(change: Step, result: AsyncResult.AsyncResult<A, unknown>) {
	if (AsyncResult.isFailure(result) && needsSignInCause(result.cause)) {
		return change.run(Command.asNoop(SignIn.make({})))
	}
	return change
}

const ScopeDef = Html.component({
	message: Message,
	model: Model,
	name: 'Scope',
	props: Schema.Struct({route: ScopeRoute})
})

export const Scope = pipe(
	ScopeDef.make({
		init: $ => initialModel($.props.route),
		subscriptions: context => {
			const trace = Option.getOrUndefined(pickedTraceOf(context.model))
			return [
				Subscription.make('Scope/Overview', rangeOf(context.model.route.search), range =>
					observe(overviewAtom(range), result => Message.Overview({range, result}))
				),
				trace !== undefined &&
					Subscription.make('Scope/Trace', trace, id =>
						observe(traceAtom(id), result => Message.TraceRead({id, result}))
					),
				Subscription.make(
					'Scope/Clock',
					observe(nowAtom, now => Message.Clock({now}))
				),
				Router.subscription(ScopeRoute, context.model.route, route => Message.Route({route})),
				...watchPanes(() => Message.Posture({narrow: singlePane()}))
			]
		},
		update: {
			Clock: ($, message) => $.evolve({now: message.now}),
			Operation: ($, message) =>
				navigate(
					$,
					select(
						$.model.route.search,
						{operation: message.operation, spanId: Option.none(), traceId: Option.none()},
						'Traces'
					),
					Boolean.match(levelOf($.model.route.search) === 0, {
						onFalse: Function.constant('replace'),
						onTrue: Function.constant('push')
					})
				),
			Overview: ($, message) => {
				if (message.range !== rangeOf($.model.route.search)) return $.model
				const value = AsyncResult.value(message.result)
				const selection = selectionFor({...$.model, overview: message.result})
				return completeRead(
					$.evolve({
						knownSources: Option.match(value, {
							onNone: () => $.model.knownSources,
							onSome: current => Array.map(current.apps, app => app.name)
						}),
						opened: Boolean.match(Option.isNone($.model.route.search.source), {
							onFalse: () => $.model.opened,
							onTrue: () => Option.orElse($.model.opened, () => selection.source)
						}),
						overview: message.result
					}),
					message.result
				)
			},
			...panelUpdates<Model, Message>(),
			Range: ($, message) => {
				const cutoff = rangeStart(message.range, $.model.now)
				const current = openedSearch($.model)
				const keepTrace = Option.exists(
					selectionFor($.model).activeTrace,
					trace => !Option.exists(trace.summary, summary => DateTime.isLessThan(summary.start, cutoff))
				)
				const range = Option.some(message.range)
				if (keepTrace) return navigate($, {...current, range})
				return navigate($, {
					...current,
					pane: Option.map(current.pane, Function.constant('Traces' as const)),
					range,
					span: Option.none(),
					trace: Option.none()
				})
			},
			Retry: $ =>
				$.run(Command.asNoop(Retry.make({range: rangeOf($.model.route.search), trace: pickedTraceOf($.model)}))),
			Route: ($, message) => {
				const level = levelOf(message.route.search)
				const priorLevel = levelOf($.model.route.search)
				const next = $.evolve({
					overview: Boolean.match(rangeOf($.model.route.search) === rangeOf(message.route.search), {
						onFalse: () => AsyncResult.initial(),
						onTrue: () => $.model.overview
					}),
					panel: undefined,
					route: message.route,
					sidebarHidden: level !== 0 && $.model.sidebarHidden
				})
				if (usedHistoryMotion()) return next
				if ($.model.narrow && level !== priorLevel) {
					if (level > priorLevel) return next.viewTransition(['axis-open'])
					return next.viewTransition(['axis-back'])
				}
				if (!$.model.narrow && level !== priorLevel) return next.viewTransition(['axis-layout'])
				return next
			},
			Sidebar: $ => {
				if (!$.model.narrow) {
					return $.evolve({panel: undefined, sidebarHidden: !$.model.sidebarHidden}).viewTransition(['axis-layout'])
				}
				if (showOf($.model.route.search) === 'list') {
					const operation = Option.getOrUndefined(selectionFor($.model).activeKey)
					if (operation === undefined) return $.model
					return navigate(
						$,
						select($.model.route.search, {operation, spanId: Option.none(), traceId: Option.none()}, 'Traces'),
						'push'
					)
				}
				const parent = parentSearch($.model.route.search)
				if (hasParentBehind($.model, parent)) return $.run(historyBack)
				return navigate($, parent)
			},
			Source: ($, message) => navigate($, sourceSearch(openedSearch($.model), message.app)),
			Span: ($, message) => {
				const id = Option.getOrUndefined(pickedTraceOf($.model))
				if (id === undefined) return $.model
				return selectTrace($, id, Option.some(message.id))
			},
			Trace: ($, message) => selectTrace($, message.id, Option.none()),
			TraceRead: ($, message) => {
				if (!Option.contains(pickedTraceOf($.model), message.id)) return $.model
				return completeRead($.evolve({trace: {id: message.id, result: message.result}}), message.result)
			}
		},
		view: (h, model) => {
			const selection = selectionFor(model)
			const show = showOf(model.route.search)
			const failure = Option.getOrUndefined(blockingFailure(model.overview))
			const frame = h.main.class('scope axis-controls').onMount(PressFeedback({}))
			if (failure !== undefined) return frame.children(ReadFailure(h, failure, 'Couldn’t load', Message.Retry()))
			return frame.children(
				ActionShell(h, {
					...ScopeControls(h, model, selection),
					content: Split(h, {
						detail: {
							content: DetailPane(h, model, selection),
							key: Option.getOrElse(pickedTraceOf(model), Function.constant('trace')),
							label: 'Trace'
						},
						list: {content: ListPane(h, model, selection), label: 'Operations'},
						listHidden: !model.narrow && model.sidebarHidden,
						narrow: model.narrow,
						show
					})
				})
			)
		}
	}),
	Component.provide(Layer.provideMerge(Retry.layer, AtomRegistry.layerOptions({defaultIdleTTL: 400})))
)
