import type {Html} from '@effect/ui/html'

import {Array, Boolean, Cause, Function, Option, Record, String, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {isDenied} from '@deslop/runtime/shared/auth'
import {ageOf, clockOf, compactCountOf, countOf, durationOf} from '@deslop/runtime/shared/format'
import {TimeFrame} from '@deslop/runtime/shared/time'
import {Button} from '@deslop/ui/control'
import {Glass} from '@deslop/ui/glass'

import {focusOf, operationsOf, traceLabel} from '#lib/telemetry.ts'
import {Message, rangeOf, traceReadOf} from '#routes/(home)/-model.ts'
import type {Model, selectionFor} from '#routes/(home)/-model.ts'
import {SpanDetail} from '#routes/(home)/-span.ts'
import {Waterfall} from '#routes/(home)/-waterfall.ts'
import type {OperationTrace, Overview, Runtime, TraceTree} from '#services/telemetry/schema.ts'

const SIDES: Record<Runtime, string> = {ci: 'CI', mobile: 'iOS', server: 'Server', unknown: '', web: 'Web'}

function state(h: Html.H<Message>, text: string, busy = false) {
	return h.p.class('scope-state axis-muted').attr('role', 'status').attr('aria-busy', `${busy}`).children(text)
}

export function ReadFailure(h: Html.H<Message>, cause: Cause.Cause<unknown>) {
	if (isDenied(Cause.squash(cause))) return state(h, 'Access denied')
	return h.div
		.class('scope-state')
		.attr('role', 'alert')
		.children(
			Button(h)
				.class('scope-chip')
				.on('click', Message.Retry())
				.children(h.span.class('axis-dot').attr('aria-hidden', 'true'), 'Couldn’t load · Retry')
		)
}

function chevron(h: Html.H<Message>) {
	return h.span.class('scope-chevron').attr('aria-hidden', 'true')
}

function popoverChoice(h: Html.H<Message>, id: string, label: string, value: string, disabled = false) {
	return Button(h, {disabled})
		.class('scope-chip')
		.attr('popovertarget', id)
		.attr('aria-label', `${label}: ${value}`)
		.children(h.span.class('truncate').children(value), chevron(h))
}

function sourceLabel(name: string) {
	return pipe(name, String.split('/'), Array.lastNonEmpty)
}

function Filters(h: Html.H<Message>, model: Model, selection: ReturnType<typeof selectionFor>) {
	const source = Option.orElse(selection.source, () => model.search.source)
	const range = rangeOf(model.search)
	return h.div.class('scope-filters').children(
		Glass(h)
			.class('glass scope-filter-glass')
			.children(
				popoverChoice(
					h,
					'scope-sources',
					'App',
					Option.match(source, {onNone: Function.constant('App'), onSome: sourceLabel}),
					Array.isReadonlyArrayEmpty(model.knownSources)
				),
				popoverChoice(h, 'scope-ranges', 'Range', range)
			),
		h.div
			.id('scope-sources')
			.attr('popover', 'auto')
			.class('scope-popover scope-filter-popover')
			.attr('aria-label', 'Apps')
			.children(
				Array.map(model.knownSources, name =>
					Button(h)
						.key(name)
						.class('axis-row scope-filter-row')
						.attr('aria-current', `${Option.contains(source, name)}`)
						.attr('popovertarget', 'scope-sources')
						.attr('popovertargetaction', 'hide')
						.on('click', Message.Source({app: name}))
						.children(h.span.class('axis-title').children(name))
				)
			),
		h.div
			.id('scope-ranges')
			.attr('popover', 'auto')
			.class('scope-popover scope-filter-popover')
			.attr('aria-label', 'Ranges')
			.children(
				Array.map(TimeFrame.literals, frame =>
					Button(h)
						.key(frame)
						.class('axis-row scope-filter-row')
						.attr('aria-current', `${range === frame}`)
						.attr('popovertarget', 'scope-ranges')
						.attr('popovertargetaction', 'hide')
						.on('click', Message.Range({range: frame}))
						.children(h.span.class('axis-title').children(frame))
				)
			)
	)
}

function operationRows(h: Html.H<Message>, selection: ReturnType<typeof selectionFor>, overview: Overview) {
	const rows = operationsOf(overview, selection.source)
	if (Array.isReadonlyArrayEmpty(rows)) return state(h, 'No operations')
	const names = Array.groupBy(rows, row => row.operation.name)
	return Array.map(rows, row => {
		const key = {app: row.app.name, name: row.operation.name, runtime: row.operation.runtime}
		const active = Option.exists(
			selection.activeKey,
			current => current.app === key.app && current.name === key.name && current.runtime === key.runtime
		)
		const failed = row.operation.failures > 0
		const side = SIDES[row.operation.runtime]
		const reason = pipe(
			Array.findFirst(row.operation.traces, trace => Option.isSome(trace.failure)),
			Option.flatMap(trace => trace.failure),
			Option.map(failure => Option.getOrElse(failure.error, () => `Failed in ${failure.span}`)),
			Option.getOrElse(() =>
				Boolean.match(failed, {onFalse: () => side, onTrue: () => `${countOf(row.operation.failures)} failed`})
			)
		)
		const duration = durationOf(row.operation.p50Ms)
		const duplicate = pipe(
			names,
			Record.get(row.operation.name),
			Option.exists(items => items.length > 1)
		)
		const count = compactCountOf(row.operation.count)
		const runs = Boolean.match(failed, {
			onFalse: () => count,
			onTrue: () => `${compactCountOf(row.operation.failures)}/${count}`
		})
		const name = Boolean.match(duplicate, {
			onFalse: () => row.operation.name,
			onTrue: () => `${row.operation.name}, ${side}`
		})
		const summary = `${countOf(row.operation.failures)} failed of ${countOf(row.operation.count)} · ${duration} typical`
		return Button(h)
			.key(`${key.app}:${key.runtime}:${key.name}`)
			.class('axis-row scope-operation')
			.attr('aria-current', `${active}`)
			.attr('aria-label', `${name} · ${summary}`)
			.attr('title', Boolean.match(failed, {onFalse: () => row.operation.name, onTrue: () => reason}))
			.on('click', Message.Operation({operation: key}))
			.children(
				h.span
					.class('min-w-0')
					.children(
						h.span
							.class('axis-title block')
							.children(failed && h.span.class('axis-dot').attr('aria-hidden', 'true'), row.operation.name),
						h.span.class('axis-muted block').children(reason)
					),
				h.span.class('axis-value').attr('title', summary).children(`${runs} · ${duration}`)
			)
	})
}

export function ListPane(h: Html.H<Message>, model: Model, selection: ReturnType<typeof selectionFor>) {
	return h.section
		.class('fold-list scope-list')
		.attr('aria-label', 'Operations')
		.children(
			h.div
				.class('scope-operations')
				.children(
					Option.match(AsyncResult.value(model.overview), {
						onNone: () => state(h, 'Loading operations…', true),
						onSome: overview => operationRows(h, selection, overview)
					})
				),
			Filters(h, model, selection)
		)
}

function traceRow(h: Html.H<Message>, model: Model, trace: OperationTrace, active: boolean) {
	const reason = Option.getOrUndefined(Option.map(trace.failure, failure => `Failed in ${failure.span}`))
	const title = traceLabel(trace)
	const age = ageOf(trace.start, model.now)
	return Button(h)
		.key(trace.id)
		.class('axis-row')
		.attr('aria-current', `${active}`)
		.attr('title', reason ?? clockOf(trace.start, 'second'))
		.attr('popovertarget', 'scope-traces')
		.attr('popovertargetaction', 'hide')
		.on('click', Message.Trace({id: trace.id}))
		.children(
			h.span
				.class('min-w-0')
				.children(
					h.span
						.class('axis-title block')
						.children(Option.isSome(trace.failure) && h.span.class('axis-dot').attr('aria-hidden', 'true'), title),
					h.span.class('axis-muted block').children(reason ?? clockOf(trace.start, 'second'))
				),
			h.span.class('axis-value').children(`${age} · ${durationOf(trace.duration)}`)
		)
}

function TraceChoice(h: Html.H<Message>, model: Model, selection: ReturnType<typeof selectionFor>, title: string) {
	const traces = Option.match(selection.activeOperation, {onNone: () => [], onSome: active => active.operation.traces})
	if (Array.isReadonlyArrayEmpty(traces)) return h.div.class('axis-title').children(title)
	return h.div.class('min-w-0').children(
		Button(h)
			.class('scope-trace-choice axis-title')
			.attr('popovertarget', 'scope-traces')
			.attr('aria-label', `Choose trace for ${title}`)
			.children(h.span.class('truncate').children(title), chevron(h)),
		h.div
			.id('scope-traces')
			.attr('popover', 'auto')
			.class('scope-popover scope-trace-popover')
			.attr('aria-label', 'Traces')
			.children(
				Array.map(traces, trace =>
					traceRow(
						h,
						model,
						trace,
						Option.exists(selection.activeTrace, active => active.id === trace.id)
					)
				)
			)
	)
}

function TraceContent(h: Html.H<Message>, trace: TraceTree, selection: ReturnType<typeof selectionFor>) {
	if (Array.isReadonlyArrayEmpty(trace.spans)) return state(h, 'No spans')
	const focus = focusOf(trace, selection.pickedSpan)
	return h.div.class('scope-trace-content').children(
		Waterfall(
			h,
			trace,
			Option.map(focus, span => span.spanId)
		),
		Option.match(focus, {onNone: Function.constUndefined, onSome: span => SpanDetail(h, span)})
	)
}

function TraceView(h: Html.H<Message>, model: Model, selection: ReturnType<typeof selectionFor>) {
	if (Option.isNone(selection.activeTrace)) {
		if (AsyncResult.isInitial(model.overview)) return state(h, 'Loading trace…', true)
		return state(h, 'Select an operation')
	}
	const read = traceReadOf(model)
	const trace = AsyncResult.value(read)
	const listed = Option.flatMap(selection.activeTrace, current => current.summary)
	const root = Option.flatMap(trace, current => Array.findFirst(current.spans, span => span.depth === 0))
	const started = pipe(
		listed,
		Option.map(current => current.start),
		Option.orElse(() => Option.map(root, span => span.start)),
		Option.getOrUndefined
	)
	const duration = pipe(
		trace,
		Option.map(current => current.durationMs),
		Option.orElse(() => Option.map(listed, current => current.duration)),
		Option.getOrUndefined
	)
	const title = pipe(
		selection.activeKey,
		Option.map(key => key.name),
		Option.getOrElse(Function.constant('Trace'))
	)
	return [
		h.div
			.class('scope-trace-summary')
			.children(
				h.div
					.class('min-w-0')
					.children(
						TraceChoice(h, model, selection, title),
						started !== undefined &&
							h.p.class('axis-muted').attr('title', clockOf(started, 'second')).children(ageOf(started, model.now))
					),
				duration !== undefined && h.span.class('axis-value').children(durationOf(duration))
			),
		Option.match(blockingFailure(read), {
			onNone: () =>
				Option.match(trace, {
					onNone: () => state(h, 'Loading trace…', true),
					onSome: current => TraceContent(h, current, selection)
				}),
			onSome: cause => ReadFailure(h, cause)
		})
	]
}

export function DetailPane(h: Html.H<Message>, model: Model, selection: ReturnType<typeof selectionFor>) {
	return h.section
		.class('fold-detail scope-detail')
		.attr('aria-label', 'Trace')
		.children(TraceView(h, model, selection))
}

function isStale<A>(result: AsyncResult.AsyncResult<A, unknown>) {
	return AsyncResult.isFailure(result) && Option.isSome(result.previousSuccess)
}

export function Sidebar(h: Html.H<Message>, model: Model) {
	const expanded = Boolean.match(model.narrow, {
		onFalse: () => !model.sidebarHidden,
		onTrue: () => model.show === 'list'
	})
	const stale = isStale(model.overview) || isStale(traceReadOf(model))
	return h.div.class('scope-tools').children(
		Glass(h)
			.class('glass')
			.children(
				Button(h, {pressed: expanded})
					.class('scope-sidebar')
					.attr('aria-label', 'Operations sidebar')
					.on('click', Message.Sidebar())
					.children(h.span.class('scope-sidebar-icon').attr('aria-hidden', 'true'))
			),
		stale &&
			Glass(h)
				.class('glass')
				.children(
					Button(h)
						.class('scope-sidebar')
						.attr('aria-label', 'Out of date · Retry')
						.attr('title', 'Out of date · Retry')
						.on('click', Message.Retry())
						.children(h.span.class('axis-dot m-0').attr('aria-hidden', 'true'))
				)
	)
}
