import {Command, Subscription} from '@effect/ui'
import {Html, HtmlSubscription} from '@effect/ui/html'

import {Array, Boolean, DateTime, Option, Stream, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {blockingFailure, needsSignInCause} from '@deslop/runtime/client/live-stream'

import {NavigationEvent, nextSearch, nowAtom, overviewAtom, shownSearch, traceAtom} from '#lib/telemetry.ts'
import type {Search} from '#lib/telemetry.ts'
import {
	Message,
	Model,
	NARROW,
	Retry,
	SignIn,
	WriteSearch,
	initialModel,
	observe,
	pickedTraceOf,
	rangeOf,
	readSearch,
	selectionFor,
	showOf
} from '#routes/(home)/-model.ts'
import {DetailPane, ListPane, ReadFailure, Sidebar} from '#routes/(home)/-panes.ts'
import {rangeStart} from '#services/telemetry/schema.ts'

function navigate(model: Model, event: NavigationEvent) {
	return nextSearch(
		shownSearch(model.search, selectionFor(model), Option.isSome(AsyncResult.value(model.overview))),
		event
	)
}

function changeSearch(model: Model, search: Search, show = showOf(search)) {
	return {
		overview: Boolean.match(rangeOf(model.search) === rangeOf(search), {
			onFalse: () => AsyncResult.initial(),
			onTrue: () => model.overview
		}),
		search,
		show
	}
}

function shouldSignIn<A>(result: AsyncResult.AsyncResult<A, unknown>) {
	return AsyncResult.isFailure(result) && needsSignInCause(result.cause)
}

export const Scope = Html.component({message: Message, model: Model, name: 'Scope'}).make({
	init: () => initialModel(readSearch()),
	subscriptions: context => [
		Subscription.make('Scope/Overview', rangeOf(context.model.search), range =>
			observe(overviewAtom(range), result => Message.Overview({range, result}))
		),
		pipe(
			pickedTraceOf(context.model),
			Option.map(id =>
				Subscription.make('Scope/Trace', id, current =>
					observe(traceAtom(current), result => Message.TraceRead({id: current, result}))
				)
			),
			Option.getOrUndefined
		),
		Subscription.make(
			'Scope/Clock',
			observe(nowAtom, now => Message.Clock({now}))
		),
		Subscription.make(
			'Scope/History',
			Stream.suspend(() =>
				Stream.map(Stream.fromEventListener(window, 'popstate'), () => Message.History({search: readSearch()}))
			)
		),
		HtmlSubscription.onMediaQuery(NARROW, narrow => Message.Posture({narrow}))
	],
	update: {
		Clock: ($, message) => $.evolve({now: message.now}),
		History: ($, message) => $.evolve(changeSearch($.model, message.search)),
		Operation: ($, message) => {
			const search = navigate($.model, NavigationEvent.cases.Operation.make({operation: message.operation}))
			return $.evolve(changeSearch($.model, search)).run(Command.asNoop(WriteSearch.make({search})))
		},
		Overview: ($, message) => {
			if (message.range !== rangeOf($.model.search)) return $.evolve({})
			const value = AsyncResult.value(message.result)
			const selection = selectionFor({...$.model, overview: message.result})
			const change = $.evolve({
				knownSources: Option.match(value, {
					onNone: () => $.model.knownSources,
					onSome: current => Array.map(current.apps, app => app.name)
				}),
				opened: Boolean.match(Option.isNone($.model.search.source) && Option.isNone($.model.opened), {
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
			const search = navigate(
				$.model,
				NavigationEvent.cases.Range.make({
					keepTrace: Option.exists(
						selectionFor($.model).activeTrace,
						trace => !Option.exists(trace.summary, summary => DateTime.isLessThan(summary.start, cutoff))
					),
					range: message.range
				})
			)
			return $.evolve(changeSearch($.model, search, $.model.show)).run(Command.asNoop(WriteSearch.make({search})))
		},
		Retry: $ => $.run(Command.asNoop(Retry.make({range: rangeOf($.model.search), trace: pickedTraceOf($.model)}))),
		Sidebar: $ => {
			if (!$.model.narrow) return $.evolve({sidebarHidden: !$.model.sidebarHidden})
			if ($.model.show === 'list') return $.evolve({show: 'detail'})
			return $.evolve({show: 'list'})
		},
		Source: ($, message) => {
			const search = navigate($.model, NavigationEvent.cases.Source.make({app: message.app}))
			return $.evolve(changeSearch($.model, search, 'list')).run(Command.asNoop(WriteSearch.make({search})))
		},
		Span: ($, message) => {
			const selection = selectionFor($.model)
			return Option.match(Option.all({operation: selection.activeKey, trace: selection.activeTrace}), {
				onNone: () => $.evolve({}),
				onSome: picked => {
					const search = navigate(
						$.model,
						NavigationEvent.cases.Span.make({
							selection: {operation: picked.operation, spanId: message.id, traceId: picked.trace.id}
						})
					)
					return $.evolve(changeSearch($.model, search)).run(Command.asNoop(WriteSearch.make({search})))
				}
			})
		},
		Trace: ($, message) =>
			Option.match(selectionFor($.model).activeKey, {
				onNone: () => $.evolve({}),
				onSome: operation => {
					const search = navigate(
						$.model,
						NavigationEvent.cases.Trace.make({selection: {operation, traceId: message.id}})
					)
					return $.evolve(changeSearch($.model, search)).run(Command.asNoop(WriteSearch.make({search})))
				}
			}),
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
					return [
						h.div
							.class('fold')
							.attr('data-show', model.show)
							.attr('data-list-hidden', `${!model.narrow && model.sidebarHidden}`)
							.children(ListPane(h, model, selection), DetailPane(h, model, selection)),
						Sidebar(h, model)
					]
				},
				onSome: cause => h.div.class('scope-page-failure').children(ReadFailure(h, cause))
			})
		)
})
