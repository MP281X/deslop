import {Command, Router, Subscription} from '@effect/ui'
import type {Component} from '@effect/ui'
import {Html, HtmlSubscription} from '@effect/ui/html'

import {Array, Boolean, DateTime, Effect, Function, Option, Schema, Stream, pipe} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {blockingFailure, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {AppShell} from '@deslop/ui/app-shell'

import {rangeStart} from '#contracts'
import type {SpanId, TraceId} from '#contracts'

import {ScopeRoute} from '#web/routes.ts'
import {
	Message,
	Model,
	NARROW,
	Retry,
	SignIn,
	initialModel,
	pickedTraceOf,
	rangeOf,
	selectionFor,
	showOf
} from '#web/telemetry/model.ts'
import {DetailPane, ListPane, ReadFailure, ScopeControls} from '#web/telemetry/panes.ts'
import {nowAtom, overviewAtom, select, shownSearch, sourceSearch, traceAtom} from '#web/telemetry/selection.ts'
import type {Search} from '#web/telemetry/selection.ts'

function openedSearch(model: Model) {
	return shownSearch(model.route.search, selectionFor(model), Option.isSome(AsyncResult.value(model.overview)))
}

function changeRoute(model: Model, route: Model['route'], show = showOf(route.search)) {
	return {
		overview: Boolean.match(rangeOf(model.route.search) === rangeOf(route.search), {
			onFalse: () => AsyncResult.initial(),
			onTrue: () => model.overview
		}),
		route,
		show
	}
}

function navigate($: Component.Step<Model, Message, never>, search: Search, show = showOf(search)) {
	return $.evolve(changeRoute($.model, {...$.model.route, search}, show)).run(
		Command.asNoop(Router.patchSearch(ScopeRoute, $.model.route, search, {history: 'push'}))
	)
}

function selectTrace($: Component.Step<Model, Message, never>, trace: TraceId, span: Option.Option<SpanId>) {
	return Option.match(selectionFor($.model).activeKey, {
		onNone: () => $.evolve({}),
		onSome: operation => {
			const pane = Boolean.match(Option.isSome(span), {
				onFalse: Function.constant('Trace' as const),
				onTrue: Function.constant('Span' as const)
			})
			return navigate($, select($.model.route.search, {operation, spanId: span, traceId: Option.some(trace)}, pane))
		}
	})
}

function shouldSignIn<A>(result: AsyncResult.AsyncResult<A, unknown>) {
	return AsyncResult.isFailure(result) && needsSignInCause(result.cause)
}

export const Scope = Html.component({
	message: Message,
	model: Model,
	name: 'Scope',
	props: Schema.Struct({route: ScopeRoute})
}).make({
	init: $ => initialModel($.props.route),
	subscriptions: context => [
		Subscription.make('Scope/Overview', rangeOf(context.model.route.search), range =>
			Stream.unwrap(
				Effect.map(AtomRegistry.AtomRegistry, registry =>
					pipe(
						registry,
						AtomRegistry.toStream(overviewAtom(range)),
						Stream.map(result => Message.Overview({range, result}))
					)
				)
			)
		),
		pipe(
			pickedTraceOf(context.model),
			Option.map(id =>
				Subscription.make('Scope/Trace', id, current =>
					Stream.unwrap(
						Effect.map(AtomRegistry.AtomRegistry, registry =>
							pipe(
								registry,
								AtomRegistry.toStream(traceAtom(current)),
								Stream.map(result => Message.TraceRead({id: current, result}))
							)
						)
					)
				)
			),
			Option.getOrUndefined
		),
		Subscription.make(
			'Scope/Clock',
			Stream.unwrap(
				Effect.map(AtomRegistry.AtomRegistry, registry =>
					pipe(
						registry,
						AtomRegistry.toStream(nowAtom),
						Stream.map(now => Message.Clock({now}))
					)
				)
			)
		),
		Router.subscription(ScopeRoute, context.model.route, route => Message.Route({route})),
		HtmlSubscription.onMediaQuery(NARROW, narrow => Message.Posture({narrow}))
	],
	update: {
		Clock: ($, message) => $.evolve({now: message.now}),
		Operation: ($, message) =>
			navigate(
				$,
				select(
					$.model.route.search,
					{operation: message.operation, spanId: Option.none(), traceId: Option.none()},
					'Traces'
				)
			),
		Overview: ($, message) => {
			if (message.range !== rangeOf($.model.route.search)) return $.evolve({})
			const value = AsyncResult.value(message.result)
			const selection = selectionFor({...$.model, overview: message.result})
			const change = $.evolve({
				knownSources: Option.match(value, {
					onNone: () => $.model.knownSources,
					onSome: current => Array.map(current.apps, app => app.name)
				}),
				opened: Boolean.match(Option.isNone($.model.route.search.source) && Option.isNone($.model.opened), {
					onFalse: () => $.model.opened,
					onTrue: () => selection.source
				}),
				overview: message.result
			})
			if (shouldSignIn(message.result)) return change.run(Command.asNoop(SignIn.make({})))
			return change
		},
		Posture: ($, message) => $.evolve({narrow: message.narrow}),
		Range: ($, message) => {
			const cutoff = rangeStart(message.range, $.model.now)
			const current = openedSearch($.model)
			const keepTrace = Option.exists(
				selectionFor($.model).activeTrace,
				trace => !Option.exists(trace.summary, summary => DateTime.isLessThan(summary.start, cutoff))
			)
			const range = Option.some(message.range)
			return navigate(
				$,
				Boolean.match(keepTrace, {
					onFalse: () => ({...current, range, span: Option.none(), trace: Option.none()}),
					onTrue: () => ({...current, range})
				}),
				$.model.show
			)
		},
		Retry: $ =>
			$.run(Command.asNoop(Retry.make({range: rangeOf($.model.route.search), trace: pickedTraceOf($.model)}))),
		Route: ($, message) => {
			if (ScopeRoute.print(message.route) === ScopeRoute.print($.model.route)) return $.evolve({})
			return $.evolve(changeRoute($.model, message.route))
		},
		Sidebar: $ => {
			if (!$.model.narrow) return $.evolve({sidebarHidden: !$.model.sidebarHidden})
			if ($.model.show === 'list') return $.evolve({show: 'detail'})
			return $.evolve({show: 'list'})
		},
		Source: ($, message) => navigate($, sourceSearch(openedSearch($.model), message.app), 'list'),
		Span: ($, message) =>
			Option.match(pickedTraceOf($.model), {
				onNone: () => $.evolve({}),
				onSome: id => selectTrace($, id, Option.some(message.id))
			}),
		Trace: ($, message) => selectTrace($, message.id, Option.none()),
		TraceRead: ($, message) => {
			if (!Option.contains(pickedTraceOf($.model), message.id)) return $.evolve({})
			const change = $.evolve({trace: {id: message.id, result: message.result}})
			if (shouldSignIn(message.result)) return change.run(Command.asNoop(SignIn.make({})))
			return change
		}
	},
	view: (h, model) =>
		h.main.class('scope').children(
			h.h1.class('sr-only').children('Scope'),
			Option.match(blockingFailure(model.overview), {
				onNone: () => {
					const selection = selectionFor(model)
					const controls = ScopeControls(h, model, selection)
					return AppShell(h, {
						actions: controls.actions,
						content: h.div
							.class('fold')
							.attr('data-show', model.show)
							.attr('data-list-hidden', `${!model.narrow && model.sidebarHidden}`)
							.children(ListPane(h, model, selection), DetailPane(h, model, selection), controls.panels),
						sidebar: controls.sidebar
					})
				},
				onSome: cause => h.div.class('scope-page-failure').children(ReadFailure(h, cause))
			})
		)
})
