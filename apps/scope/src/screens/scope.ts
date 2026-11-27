import {Command, Component, Router, Subscription} from '@effect/ui'
import type {Mount, View} from '@effect/ui'

import {Array, Boolean, DateTime, Function, Option, Predicate, Schema, String, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import type {RowData, ToolbarAction} from '@deslop/design/model'
import {blockingFailure, isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {ageOf, clockOf, compactCountOf, durationOf} from '@deslop/runtime/shared/format'
import {TimeFrame} from '@deslop/runtime/shared/time'

import {rangeStart} from '#contracts'
import type {OperationTrace, Runtime, SpanId, TraceId} from '#contracts'

import {
	Message,
	Model,
	initialModel,
	levelOf,
	pickedTraceOf,
	rangeOf,
	selectionFor,
	traceReadOf
} from '#screens/model.ts'
import {Authenticate, OpenLink, Retry, observe} from '#screens/reads.ts'
import {ScopeRoute} from '#screens/routes.ts'
import {focusOf, operationsOf, select, shownSearch, sourceSearch, traceLabel} from '#screens/selection.ts'
import type {OperationKey, Search} from '#screens/selection.ts'
import {spanDetail} from '#screens/span.ts'
import {waterfall} from '#screens/waterfall.ts'

type Step = Component.Step<Model, Message, never>
const SIDES: Record<Runtime, string> = {ci: 'CI', mobile: 'iOS', server: 'Server', unknown: '', web: 'Web'}
const operationId = (key: OperationKey) => `operation:${key.app}:${key.runtime}:${key.name}`

function openedSearch(model: Model) {
	return shownSearch(model.route.search, selectionFor(model), Option.isSome(AsyncResult.value(model.overview)))
}

function navigate($: Step, search: Search, history: 'push' | 'replace' = 'replace') {
	const route = {...$.model.route, search}
	if (ScopeRoute.print(route) === ScopeRoute.print($.model.route)) return $.model
	const index = $.model.historyIndex
	const nextHistory = Boolean.match(history === 'push', {
		onFalse: () =>
			Array.map($.model.history, (entry, position) => {
				if (position === index) return route
				return entry
			}),
		onTrue: () => Array.append(Array.take($.model.history, index + 1), route)
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
		Boolean.match(Option.isSome(span), {onFalse: () => 'Trace' as const, onTrue: () => 'Span' as const})
	)
	const deeper = levelOf(search, iphone) > levelOf($.model.route.search, iphone)
	if (deeper) return navigate($, search, 'push')
	return navigate($, search)
}

function parentSearch(search: Search, iphone: boolean, dismissed: boolean): Search {
	if (!dismissed) {
		if (Option.isSome(search.span)) return {...search, pane: Option.some('Trace'), span: Option.none()}
		if (iphone && Option.contains(search.pane, 'Trace')) {
			return {...search, pane: Option.some('Traces'), trace: Option.none()}
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
	const matches = Option.exists(Array.get($.model.history, $.model.historyIndex - 1), previous => {
		if (rangeOf(previous.search) !== rangeOf(parent) || levelOf(previous.search, iphone) !== level) return false
		const selection = selectionFor({...$.model, route: previous})
		if (!Option.contains(parent.source, Option.getOrUndefined(selection.source))) return false
		if (level === 0) return true
		return (
			Option.exists(
				selection.activeKey,
				key => Option.contains(parent.operation, key.name) && Option.contains(parent.side, key.runtime)
			) &&
			(Option.isNone(parent.trace) || Option.contains(pickedTraceOf({...$.model, route: previous}), parent.trace.value))
		)
	})
	if (matches) return $.run(Command.asNoop(Router.Back.make({})))
	return navigate($, parent)
}

function retry($: Step, newSession: boolean) {
	return $.run(
		Command.asNoop(Retry.make({newSession, range: rangeOf($.model.route.search), trace: pickedTraceOf($.model)}))
	)
}

function stale<A>(result: AsyncResult.AsyncResult<A, unknown>) {
	return AsyncResult.isFailure(result) && Option.isSome(result.previousSuccess)
}

function problemOf<A>(result: AsyncResult.AsyncResult<A, unknown>, model: Model, iphone: boolean) {
	return Option.map(blockingFailure(result), cause => {
		if (needsSignInCause(cause)) {
			const text = Boolean.match(iphone, {onFalse: () => 'Signing in…', onTrue: () => 'Sign in to Scope'})
			return {action: 'sign-in' as const, text: model.signInProblem ?? text}
		}
		if (isDeniedCause(cause)) return {action: undefined, text: 'Access denied'}
		return {action: 'retry' as const, text: 'Couldn’t load'}
	})
}

function authenticate($: Step) {
	return $.evolve({signInProblem: undefined}).run(
		pipe(
			Authenticate.make({}),
			Command.match({
				onFailure: error => Message.SignInDone({problem: error.message, signedIn: false}),
				onSuccess: signedIn => Message.SignInDone({problem: undefined, signedIn})
			})
		)
	)
}

function completeRead<A>(change: Step, result: AsyncResult.AsyncResult<A, unknown>, iphone: boolean) {
	if (!iphone && AsyncResult.isFailure(result) && needsSignInCause(result.cause)) return authenticate(change)
	return change
}

function problemDot(failed: boolean, reason: string): Pick<RowData, 'problem'> {
	if (failed) return {problem: {reason, status: 'error'}}
	return {}
}

function operationRows(model: Model, selection: ReturnType<typeof selectionFor>) {
	return pipe(
		AsyncResult.value(model.overview),
		Option.map(overview => operationsOf(overview, selection.source)),
		Option.getOrElse(Array.empty),
		Array.map(({app, operation}) => {
			const key = {app: app.name, name: operation.name, runtime: operation.runtime}
			const side = SIDES[operation.runtime]
			const count = compactCountOf(operation.count)
			const countWithFailures = Boolean.match(operation.failures > 0, {
				onFalse: () => count,
				onTrue: () => `${compactCountOf(operation.failures)}/${count}`
			})
			const failure = pipe(
				operation.traces,
				Array.findFirst(trace => Option.isSome(trace.failure)),
				Option.flatMap(trace => trace.failure)
			)
			const reason = Option.match(failure, {
				onNone: () => `${compactCountOf(operation.failures)} failed`,
				onSome: error => `Failed in ${error.span}`
			})
			return {
				hint: Option.match(failure, {
					onNone: () => reason,
					onSome: error =>
						Option.match(error.error, {onNone: () => reason, onSome: message => `${reason} · ${message}`})
				}),
				item: {
					id: operationId(key),
					line: side,
					...problemDot(operation.failures > 0, reason),
					title: operation.name,
					trailing: `${countWithFailures} · ${durationOf(operation.p50Ms)}`
				} satisfies RowData,
				key
			}
		})
	)
}

function traceRow(model: Model, trace: OperationTrace): RowData {
	const reason = Option.map(trace.failure, failure => `Failed in ${failure.span}`)
	return {
		id: `trace:${trace.id}`,
		line: clockOf(trace.start, 'second'),
		...problemDot(
			Option.isSome(reason),
			Option.getOrElse(reason, () => '')
		),
		title: traceLabel(trace),
		trailing: `${ageOf(trace.start, model.now)} · ${durationOf(trace.duration)}`
	}
}

function detailOf(model: Model, selection: ReturnType<typeof selectionFor>, iphone: boolean) {
	const active = Option.getOrUndefined(selection.activeTrace)
	if (active === undefined) {
		if (AsyncResult.isInitial(model.overview)) return {state: 'loading' as const}
		return {state: 'empty' as const, text: 'Select an operation'}
	}
	const read = traceReadOf(model)
	const problem = Option.getOrUndefined(problemOf(read, model, iphone))
	if (problem !== undefined) return {state: 'problem' as const, problem}
	const trace = Option.getOrUndefined(AsyncResult.value(read))
	if (trace === undefined) return {state: 'loading' as const}
	const root = Array.findFirst(trace.spans, span => span.depth === 0)
	const started = Option.orElse(
		Option.map(active.summary, summary => summary.start),
		() => Option.map(root, span => span.start)
	)
	const focus = focusOf(trace, selection.pickedSpan)
	return {
		state: 'ready' as const,
		age: Option.match(started, {onNone: Function.constant(''), onSome: start => ageOf(start, model.now)}),
		chart: waterfall(
			trace,
			Option.map(focus, span => span.spanId),
			model.chartWidth
		),
		duration: durationOf(trace.durationMs),
		span: Option.map(focus, spanDetail),
		started: Option.map(started, start => clockOf(start, 'second')),
		title: Option.match(active.summary, {onNone: () => String.slice(0, 8)(active.id), onSome: traceLabel})
	}
}

function searchForRange(model: Model, range: TimeFrame) {
	const cutoff = rangeStart(range, model.now)
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

function controls(model: Model, selection: ReturnType<typeof selectionFor>) {
	const source = Option.orElse(selection.source, () => model.route.search.source)
	const range = rangeOf(model.route.search)
	const sources = Array.map(model.knownSources, name => ({
		checked: Option.contains(source, name),
		id: `app:${name}`,
		label: name
	}))
	const actions: ToolbarAction[] = [
		{
			disabled: Array.isReadonlyArrayEmpty(sources),
			id: 'apps',
			label: Option.match(source, {onNone: Function.constant('Apps'), onSome: name => `App: ${name}`}),
			menu: sources,
			symbol: 'square.stack'
		},
		{
			id: 'ranges',
			label: `Range: ${range}`,
			menu: Array.map(TimeFrame.literals, frame => ({checked: range === frame, id: `range:${frame}`, label: frame})),
			symbol: 'clock'
		}
	]
	if (stale(model.overview) || stale(traceReadOf(model))) {
		return Array.append(actions, {id: 'retry', label: 'Out of date · Retry', symbol: 'exclamationmark.circle'})
	}
	return actions
}

const ScopeScreen = Component.define({
	message: Message,
	model: Model,
	name: 'Scope',
	props: Schema.Struct({iphone: Schema.Boolean, route: ScopeRoute})
}).make({
	init: $ => initialModel($.props.route),
	subscriptions: $ => {
		const trace = Option.getOrUndefined(pickedTraceOf($.model))
		return [
			Subscription.make('Scope/Overview', rangeOf($.model.route.search), range =>
				observe(
					source => source.overview(range),
					result => Message.Overview({range, result})
				)
			),
			trace !== undefined &&
				Subscription.make('Scope/Trace', trace, id =>
					observe(
						source => source.trace(id),
						result => Message.TraceRead({id, result})
					)
				),
			Subscription.make(
				'Scope/Clock',
				observe(
					source => source.now,
					now => Message.Clock({now})
				)
			),
			Router.subscription(ScopeRoute, $.model.route, route => Message.Route({route}))
		]
	},
	parts: (p, model) => {
		const iphone = p.props.iphone
		const selected = selectionFor(model)
		const operations = operationRows(model, selected)
		const active = Option.map(selected.activeKey, operationId)
		const trace = Option.map(selected.activeTrace, current => `trace:${current.id}`)
		const opened = levelOf(model.route.search, iphone) > 0
		const traces = Option.match(selected.activeOperation, {
			onNone: Array.empty,
			onSome: value => value.operation.traces
		})
		const actions = controls(model, selected)
		const backActions: readonly ToolbarAction[] = Boolean.match(iphone && levelOf(model.route.search, iphone) > 1, {
			onFalse: Array.empty,
			onTrue: () => [{id: 'back', label: 'Back', symbol: 'chevron.left'}]
		})
		const traceActions: readonly ToolbarAction[] = Boolean.match(Array.isReadonlyArrayNonEmpty(traces), {
			onFalse: Array.empty,
			onTrue: () => [
				{
					id: 'traces',
					label: 'Traces',
					menu: Array.map(traces, item => ({
						checked: Option.contains(trace, `trace:${item.id}`),
						id: `trace:${item.id}`,
						label: `${traceLabel(item)} · ${ageOf(item.start, model.now)} · ${durationOf(item.duration)}${Option.match(
							item.failure,
							{onNone: Function.constant(''), onSome: failure => ` · Failed in ${failure.span}`}
						)}`
					})),
					symbol: 'chevron.down'
				}
			]
		})
		const problem = Option.getOrUndefined(problemOf(model.overview, model, iphone))
		const placeActionsInDetail = opened && problem === undefined
		return {
			activeTrace: Option.getOrUndefined(trace),
			defaultId: Option.getOrUndefined(active),
			detail: detailOf(model, selected, iphone),
			detailToolbar: [
				...backActions,
				...traceActions,
				...Boolean.match(placeActionsInDetail, {onFalse: Array.empty, onTrue: () => actions})
			],
			loading: AsyncResult.isInitial(model.overview),
			operations,
			problem,
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
					onTrue: () => Option.getOrElse(active, () => 'trace')
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
			selectSpan: p.part((el, event: string, id: SpanId) => el.on(event, Message.Span({id}))),
			openLink: p.part((el, event: string, url: string) => el.on(event, Message.OpenLink({url}))),
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
			watch: p.part((el, mount: Mount.Issued<Message, never, unknown, never>) => el.onMount(mount)),
			retry: p.part((el, event: string) => el.on(event, Message.Retry())),
			signIn: p.part((el, event: string) => el.on(event, Message.SignIn())),
			toolbar: {
				actions: Boolean.match(placeActionsInDetail, {onFalse: () => actions, onTrue: Array.empty}),
				choose: p.part((el, event: string, identify: (payload: unknown) => string | undefined) =>
					el.on(event, payload => {
						const id = identify(payload)
						if (id !== undefined) return Message.Action({id})
						return undefined
					})
				)
			},
			traces: Array.map(traces, item => traceRow(model, item))
		}
	},
	update: {
		Action: ($, {id}) => {
			if (id === 'retry') return retry($, false)
			if (id === 'back' || id === 'dismissed') return back($, $.props.iphone, id === 'dismissed')
			if (String.startsWith('app:')(id)) {
				const name = Array.findFirst($.model.knownSources, app => id === `app:${app}`)
				return Option.match(name, {
					onNone: () => $.model,
					onSome: app => navigate($, sourceSearch(openedSearch($.model), app))
				})
			}
			if (String.startsWith('range:')(id)) {
				const range = Array.findFirst(TimeFrame.literals, frame => id === `range:${frame}`)
				return Option.match(range, {
					onNone: () => $.model,
					onSome: value => navigate($, searchForRange($.model, value))
				})
			}
			const selected = selectionFor($.model)
			const trace = Option.flatMap(selected.activeOperation, active =>
				Array.findFirst(active.operation.traces, current => id === `trace:${current.id}`)
			)
			return Option.match(trace, {
				onNone: () => $.model,
				onSome: item => selectTrace($, $.props.iphone, item.id, Option.none())
			})
		},
		Back: $ => back($, $.props.iphone),
		Clock: ($, {now}) => $.evolve({now}),
		OpenLink: ($, {url}) => $.run(Command.asNoop(OpenLink.make({url}))),
		Operation: ($, {operation}) => {
			const search = select($.model.route.search, {operation, spanId: Option.none(), traceId: Option.none()}, 'Traces')
			if (levelOf($.model.route.search) === 0) return navigate($, search, 'push')
			return navigate($, search)
		},
		Overview: ($, {range, result}) => {
			if (range !== rangeOf($.model.route.search)) return $.model
			const value = AsyncResult.value(result)
			const selection = selectionFor({...$.model, overview: result})
			return completeRead(
				$.evolve({
					knownSources: Option.match(value, {
						onNone: () => $.model.knownSources,
						onSome: current => Array.map(current.apps, app => app.name)
					}),
					opened: Boolean.match(Option.isSome($.model.route.search.source), {
						onFalse: () => Option.orElse($.model.opened, () => selection.source),
						onTrue: () => $.model.opened
					}),
					overview: result
				}),
				result,
				$.props.iphone
			)
		},
		Resize: ($, {width}) => {
			if (width === $.model.chartWidth) return $.model
			return $.evolve({chartWidth: width})
		},
		Retry: $ => retry($, false),
		Route: ($, {route}) => {
			const routeUrl = ScopeRoute.print(route)
			const priorLevel = levelOf($.model.route.search, $.props.iphone)
			const level = levelOf(route.search, $.props.iphone)
			const history = $.model.history
			const known = Array.findFirstIndex(history, previous => ScopeRoute.print(previous) === routeUrl)
			const next = $.evolve({
				history: Option.match(known, {onNone: () => [route], onSome: () => history}),
				historyIndex: Option.getOrElse(known, () => 0),
				overview: Boolean.match(rangeOf($.model.route.search) === rangeOf(route.search), {
					onFalse: () => AsyncResult.initial(),
					onTrue: () => $.model.overview
				}),
				route
			})
			if (priorLevel === 0 && level > 0) return next.viewTransition(['design-detail-in'])
			if (priorLevel > 0 && level === 0) return next.viewTransition(['design-detail-out'])
			return next
		},
		SignIn: authenticate,
		SignInDone: ($, {problem, signedIn}) => {
			const next = $.evolve({signInProblem: problem})
			if (signedIn) return retry(next, true)
			return next
		},
		Span: ($, {id}) =>
			Option.match(pickedTraceOf($.model), {
				onNone: () => $.model,
				onSome: trace => selectTrace($, $.props.iphone, trace, Option.some(id))
			}),
		Trace: ($, {id}) => selectTrace($, $.props.iphone, id, Option.none()),
		TraceRead: ($, {id, result}) => {
			if (!Option.contains(pickedTraceOf($.model), id)) return $.model
			return completeRead($.evolve({trace: {id, result}}), result, $.props.iphone)
		}
	}
})

export type Screen = Component.Headless.Parts<typeof ScopeScreen>

export function ScopeView<M, R>(
	h: View.HelperBase<M, unknown>,
	props: {readonly iphone: boolean; readonly route: ScopeRoute},
	view: (screen: Screen) => View.Content<M, R>
) {
	return ScopeScreen(h, {props, view})
}
