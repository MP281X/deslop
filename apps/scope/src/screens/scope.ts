import {Command, Component, Router, Subscription} from '@effect/ui'
import type {Mount, View} from '@effect/ui'

import {Array, Boolean, DateTime, Function, Option, Predicate, Schema, String, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import type {RowData, ToolbarAction} from '@deslop/components/model'
import {chooseToolbar} from '@deslop/components/model'
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

const SIDES: Record<Runtime, string> = {ci: 'CI', mobile: 'iOS', server: 'Server', unknown: '', web: 'Web'}
type HistoryMode = typeof HistoryMode.Type
const HistoryMode = Schema.Literals(['push', 'replace'])
type Step = Component.Step<Model, Message, never>

function operationId(key: OperationKey) {
	return `operation:${key.app}:${key.runtime}:${key.name}`
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
			const text = Boolean.match(iphone, {
				onFalse: Function.constant('Signing in…'),
				onTrue: Function.constant('Sign in to Scope')
			})
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

function problemDot(failed: boolean, reason: string) {
	if (failed) return {problem: {reason, status: 'error' as const}}
	return {}
}

function operationRows(model: Model, selection: ReturnType<typeof selectionFor>) {
	return pipe(
		AsyncResult.value(model.overview),
		Option.map(overview => operationsOf(overview, selection.source)),
		Option.getOrElse(Array.empty),
		Array.map(entry => {
			const key = {app: entry.app.name, name: entry.operation.name, runtime: entry.operation.runtime}
			const side = SIDES[entry.operation.runtime]
			const count = compactCountOf(entry.operation.count)
			const countWithFailures = Boolean.match(entry.operation.failures > 0, {
				onFalse: () => count,
				onTrue: () => `${compactCountOf(entry.operation.failures)}/${count}`
			})
			const failure = pipe(
				entry.operation.traces,
				Array.findFirst(trace => Option.isSome(trace.failure)),
				Option.flatMap(trace => trace.failure)
			)
			const reason = Option.match(failure, {
				onNone: () => `${compactCountOf(entry.operation.failures)} failed`,
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
					...problemDot(entry.operation.failures > 0, reason),
					title: entry.operation.name,
					trailing: `${countWithFailures} · ${durationOf(entry.operation.p50Ms)}`
				} satisfies RowData,
				key
			}
		})
	)
}

function traceRow(model: Model, trace: OperationTrace) {
	const reason = Option.map(trace.failure, failure => `Failed in ${failure.span}`)
	return {
		id: `trace:${trace.id}`,
		line: clockOf(trace.start, 'second'),
		...problemDot(Option.isSome(reason), Option.getOrElse(reason, Function.constant(''))),
		title: traceLabel(trace),
		trailing: `${ageOf(trace.start, model.now)} · ${durationOf(trace.duration)}`
	} satisfies RowData
}

function detailOf(model: Model, selection: ReturnType<typeof selectionFor>, iphone: boolean) {
	const active = Option.getOrUndefined(selection.activeTrace)
	if (active === undefined) {
		if (AsyncResult.isInitial(model.overview)) return {state: 'loading' as const}
		return {state: 'empty' as const, text: 'Select an operation'}
	}
	const read = traceReadOf(model)
	const problem = Option.getOrUndefined(problemOf(read, model, iphone))
	if (problem !== undefined) return {problem, state: 'problem' as const}
	const trace = Option.getOrUndefined(AsyncResult.value(read))
	if (trace === undefined) return {state: 'loading' as const}
	const root = Array.findFirst(trace.spans, span => span.depth === 0)
	const started = pipe(
		active.summary,
		Option.map(summary => summary.start),
		Option.orElse(() => Option.map(root, span => span.start))
	)
	const focus = focusOf(trace, selection.pickedSpan)
	return {
		age: Option.match(started, {onNone: Function.constant(''), onSome: start => ageOf(start, model.now)}),
		chart: waterfall(
			trace,
			Option.map(focus, span => span.spanId),
			model.chartWidth
		),
		duration: durationOf(trace.durationMs),
		span: Option.map(focus, spanDetail),
		started: Option.map(started, start => clockOf(start, 'second')),
		state: 'ready' as const,
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
		return Array.append(actions, {
			id: 'retry',
			label: 'Out of date · Retry',
			symbol: 'exclamationmark.circle'
		} satisfies ToolbarAction)
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
	parts: (p, model) => {
		const selected = selectionFor(model)
		const operations = operationRows(model, selected)
		const active = Option.map(selected.activeKey, operationId)
		const trace = Option.map(selected.activeTrace, current => `trace:${current.id}`)
		const opened = levelOf(model.route.search, p.props.iphone) > 0
		const traces = Option.match(selected.activeOperation, {
			onNone: Array.empty,
			onSome: value => value.operation.traces
		})
		const actions = controls(model, selected)
		const backActions: readonly ToolbarAction[] = Boolean.match(
			p.props.iphone && levelOf(model.route.search, p.props.iphone) > 1,
			{
				onFalse: Array.empty,
				onTrue: () => [{id: 'back', label: 'Back', symbol: 'chevron.left'} satisfies ToolbarAction]
			}
		)
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
				} satisfies ToolbarAction
			]
		})
		const problem = Option.getOrUndefined(problemOf(model.overview, model, p.props.iphone))
		const placeActionsInDetail = opened && problem === undefined
		return {
			activeTrace: Option.getOrUndefined(trace),
			defaultId: Option.getOrUndefined(active),
			detail: detailOf(model, selected, p.props.iphone),
			detailToolbar: [
				...backActions,
				...traceActions,
				...Boolean.match(placeActionsInDetail, {onFalse: Array.empty, onTrue: () => actions})
			],
			loading: AsyncResult.isInitial(model.overview),
			openLink: p.part((el, event: string, url: string) => el.on(event, Message.OpenLink({url}))),
			operations,
			problem,
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
			retry: p.part((el, event: string) => el.on(event, Message.Retry())),
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
			signIn: p.part((el, event: string) => el.on(event, Message.SignIn())),
			toolbar: {
				actions: Boolean.match(placeActionsInDetail, {onFalse: () => actions, onTrue: Array.empty}),
				choose: p.part(chooseToolbar<Message>(Message.Action))
			},
			traces: Array.map(traces, item => traceRow(model, item)),
			watch: p.part((el, mount: Mount.Issued<Message, never, unknown, never>) => el.onMount(mount))
		}
	},
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
	update: {
		Action: ($, message) => {
			if (message.id === 'retry') return retry($, false)
			if (message.id === 'back' || message.id === 'dismissed') {
				return back($, $.props.iphone, message.id === 'dismissed')
			}
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
					Option.match({onNone: () => $.model, onSome: value => navigate($, searchForRange($.model, value))})
				)
			}
			return pipe(
				selectionFor($.model).activeOperation,
				Option.flatMap(active =>
					Array.findFirst(active.operation.traces, current => message.id === `trace:${current.id}`)
				),
				Option.match({onNone: () => $.model, onSome: item => selectTrace($, $.props.iphone, item.id, Option.none())})
			)
		},
		Back: $ => back($, $.props.iphone),
		Clock: ($, message) => $.evolve({now: message.now}),
		OpenLink: ($, message) => $.run(Command.asNoop(OpenLink.make({url: message.url}))),
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
			return completeRead(
				$.evolve({
					knownSources: Option.match(AsyncResult.value(message.result), {
						onNone: () => $.model.knownSources,
						onSome: current => Array.map(current.apps, app => app.name)
					}),
					opened: Boolean.match(Option.isSome($.model.route.search.source), {
						onFalse: () => Option.orElse($.model.opened, () => selection.source),
						onTrue: () => $.model.opened
					}),
					overview: message.result
				}),
				message.result,
				$.props.iphone
			)
		},
		Resize: ($, message) => {
			if (message.width === $.model.chartWidth) return $.model
			return $.evolve({chartWidth: message.width})
		},
		Retry: $ => retry($, false),
		Route: ($, message) => {
			const routeUrl = ScopeRoute.print(message.route)
			const priorLevel = levelOf($.model.route.search, $.props.iphone)
			const level = levelOf(message.route.search, $.props.iphone)
			const history = $.model.history
			const known = Array.findFirstIndex(history, previous => ScopeRoute.print(previous) === routeUrl)
			const next = $.evolve({
				history: Option.match(known, {onNone: () => [message.route], onSome: () => history}),
				historyIndex: Option.getOrElse(known, Function.constant(0)),
				overview: Boolean.match(rangeOf($.model.route.search) === rangeOf(message.route.search), {
					onFalse: () => AsyncResult.initial(),
					onTrue: () => $.model.overview
				}),
				route: message.route
			})
			if (priorLevel === 0 && level > 0) return next.viewTransition(['design-detail-in'])
			if (priorLevel > 0 && level === 0) return next.viewTransition(['design-detail-out'])
			return next
		},
		SignIn: authenticate,
		SignInDone: ($, message) => {
			const next = $.evolve({signInProblem: message.problem})
			if (message.signedIn) return retry(next, true)
			return next
		},
		Span: ($, message) =>
			Option.match(pickedTraceOf($.model), {
				onNone: () => $.model,
				onSome: trace => selectTrace($, $.props.iphone, trace, Option.some(message.id))
			}),
		Trace: ($, message) => selectTrace($, $.props.iphone, message.id, Option.none()),
		TraceRead: ($, message) => {
			if (!Option.contains(pickedTraceOf($.model), message.id)) return $.model
			return completeRead($.evolve({trace: {id: message.id, result: message.result}}), message.result, $.props.iphone)
		}
	}
})

export type Screen = Component.Headless.Parts<typeof ScopeScreen>

export function scopeApp<V extends View.Elements>(
	define: Component.Define<V>,
	iphone: boolean,
	workspace: (h: View.WithTags<never, unknown, V>, screen: Screen) => View.Content<never>
) {
	return define({
		message: Schema.Never,
		model: Schema.Null,
		name: 'App',
		props: Schema.Struct({route: ScopeRoute})
	}).make({
		init: Function.constNull,
		update: Function.constNull,
		view: h => ScopeScreen(h, {props: {...h.props, iphone}, view: screen => workspace(h, screen)})
	})
}

export function scopeLayout<Content>(screen: Screen, detail: () => Content) {
	return {
		defaultId: screen.defaultId,
		detail: Boolean.match(screen.problem === undefined, {onFalse: Function.constUndefined, onTrue: detail}),
		detailToolbar: screen.detailToolbar,
		loading: screen.loading,
		selection: screen.selection,
		toolbar: screen.toolbar
	}
}
