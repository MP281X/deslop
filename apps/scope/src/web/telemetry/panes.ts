import type {View} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Array, Boolean, Function, Option, Record, String, pipe} from 'effect'
import type {Cause} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {needsSignInCause} from '@deslop/runtime/client/live-stream'
import {ageOf, clockOf, compactCountOf, countOf, durationOf} from '@deslop/runtime/shared/format'
import {TimeFrame} from '@deslop/runtime/shared/time'
import {CheckedChoice} from '@deslop/ui/app-shell'
import type {ShellAction} from '@deslop/ui/app-shell'
import {Loading, Notice, Row, RowContent} from '@deslop/ui/axis'
import {Button} from '@deslop/ui/control'
import {Glass, GlassPanel} from '@deslop/ui/glass'
import {isNative} from '@deslop/ui/native'
import {ReadFailure, ReadState} from '@deslop/ui/state'
import {SymbolIcon} from '@deslop/ui/symbol'

import type {OperationTrace, Overview, Runtime, TraceTree} from '#contracts'

import {Message, rangeOf, showOf, traceReadOf} from '#web/telemetry/model.ts'
import type {Model, selectionFor} from '#web/telemetry/model.ts'
import {focusOf, operationsOf, traceLabel} from '#web/telemetry/selection.ts'
import {SpanDetail} from '#web/telemetry/span.ts'
import {Waterfall} from '#web/telemetry/waterfall.ts'

const SIDES: Record<Runtime, string> = {ci: 'CI', mobile: 'iOS', server: 'Server', unknown: '', web: 'Web'}

export type H = Html.H<Message>
type Panel = NonNullable<Model['panel']>

function menu(h: H, model: Model, panel: Panel, label: string, items: View.Input<Message>) {
	return GlassPanel(h, `scope-${panel}`, label, items)
		.attr('role', 'menu')
		.popover('auto', model.panel === panel)
		.on('toggle', event => {
			if (!event.open) return Message.PanelClosed({panel})
			return undefined
		})
}

function isStale<A>(result: AsyncResult.AsyncResult<A, unknown>) {
	return AsyncResult.isFailure(result) && Option.isSome(result.previousSuccess)
}

function tracesOf(selection: ReturnType<typeof selectionFor>) {
	return Option.match(selection.activeOperation, {onNone: () => [], onSome: active => active.operation.traces})
}

function backAction() {
	return {id: 'back', message: Message.Back(), symbol: 'chevron.left', title: 'Back'} satisfies ShellAction<Message>
}

function nativeDetailActions(model: Model, selection: ReturnType<typeof selectionFor>) {
	if (!isNative || showOf(model.route.search) === 'list') return []
	const actions = Boolean.match(model.narrow, {onFalse: () => [backAction()], onTrue: () => []})
	const traces = tracesOf(selection)
	if (Option.isSome(model.route.search.span) || Array.isReadonlyArrayEmpty(traces)) return actions
	return Array.append(actions, {
		id: 'traces',
		menu: [
			{
				items: Array.map(traces, trace => ({
					checked: Option.exists(selection.activeTrace, active => active.id === trace.id),
					id: `trace-${trace.id}`,
					message: Message.Trace({id: trace.id}),
					title: traceLabel(trace)
				})),
				title: ''
			}
		],
		message: Message.Panel({panel: 'traces'}),
		symbol: 'chevron.down',
		title: 'Traces'
	} satisfies ShellAction<Message>)
}

export function ScopeControls(h: H, model: Model, selection: ReturnType<typeof selectionFor>) {
	const source = Option.orElse(selection.source, () => model.route.search.source)
	const app = Option.match(source, {onNone: Function.constant('Apps'), onSome: name => `App: ${name}`})
	const sources = Array.map(model.knownSources, name => ({
		checked: Option.contains(source, name),
		id: `source-${name}`,
		message: Message.Source({app: name}),
		title: name
	}))
	const range = rangeOf(model.route.search)
	const ranges = Array.map(TimeFrame.literals, frame => ({
		checked: range === frame,
		id: `range-${frame}`,
		message: Message.Range({range: frame}),
		title: frame
	}))
	const sidebar = Boolean.match(model.narrow && showOf(model.route.search) === 'detail', {
		onFalse: () =>
			({
				disabled: model.narrow && Option.isNone(selection.activeKey),
				id: 'sidebar',
				message: Message.Sidebar(),
				pressed: !model.sidebarHidden || model.narrow,
				symbol: 'sidebar.left',
				title: 'Sidebar'
			}) satisfies ShellAction<Message>,
		onTrue: backAction
	})
	const stale = isStale(model.overview) || isStale(traceReadOf(model))
	const actions: readonly ShellAction<Message>[] = [
		...nativeDetailActions(model, selection),
		{
			disabled: Array.isReadonlyArrayEmpty(sources),
			id: 'sources',
			menu: [{items: sources, title: ''}],
			message: Message.Panel({panel: 'sources'}),
			symbol: 'square.stack',
			title: app
		},
		{
			id: 'ranges',
			menu: [{items: ranges, title: ''}],
			message: Message.Panel({panel: 'ranges'}),
			symbol: 'clock',
			title: `Range: ${range}`
		},
		...Array.filter(
			[
				{id: 'retry', message: Message.Retry(), symbol: 'exclamationmark.circle', title: 'Out of date · Retry'}
			] as const,
			() => stale
		)
	]
	return {
		actions,
		overlays: !isNative && [
			menu(
				h,
				model,
				'sources',
				'Apps',
				Array.map(sources, item => CheckedChoice(h, item))
			),
			menu(
				h,
				model,
				'ranges',
				'Ranges',
				Array.map(ranges, item => CheckedChoice(h, item))
			)
		],
		sidebar
	}
}

export function ScopeFailure(h: H, model: Model, cause: Cause.Cause<unknown>) {
	if (isNative && needsSignInCause(cause)) {
		return Notice(h, model.signInProblem ?? 'Sign in to Scope', Message.SignIn(), 'Sign in')
	}
	return ReadFailure(h, cause, 'Couldn’t load', Message.Retry())
}

function operationRows(h: H, model: Model, selection: ReturnType<typeof selectionFor>, overview: Overview) {
	const rows = operationsOf(overview, selection.source)
	if (Array.isReadonlyArrayEmpty(rows)) return Notice(h, 'No operations')
	const names = Array.groupBy(rows, row => row.operation.name)
	return Array.map(rows, row => {
		const key = {app: row.app.name, name: row.operation.name, runtime: row.operation.runtime}
		const active =
			!model.narrow &&
			!model.sidebarHidden &&
			Option.exists(
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
		return Row(h, {
			className: 'scope-operation',
			current: active,
			id: `${key.app}:${key.runtime}:${key.name}`,
			line: reason,
			open: Message.Operation({operation: key}),
			problem: failed,
			title: row.operation.name,
			value: `${runs} · ${duration}`
		}).attrs({
			'aria-label': `${name} · ${summary}`,
			title: Boolean.match(failed, {onFalse: () => row.operation.name, onTrue: () => reason})
		})
	})
}

export function ListPane(h: H, model: Model, selection: ReturnType<typeof selectionFor>) {
	return h.div
		.class('scope-list')
		.children(
			ReadState(model.overview, {
				failed: cause => ScopeFailure(h, model, cause),
				loading: () => Loading(h, 'Loading operations', h.div.class('scope-skeleton-list').attr('aria-hidden', 'true')),
				ready: overview => operationRows(h, model, selection, overview)
			})
		)
}

function traceRow(h: H, model: Model, trace: OperationTrace, checked: boolean) {
	const reason = Option.map(trace.failure, failure => `Failed in ${failure.span}`)
	return Button(h)
		.key(trace.id)
		.class('axis-row axis-item scope-trace-option')
		.attrs({'aria-checked': `${checked}`, role: 'menuitemradio'})
		.on('click', Message.Trace({id: trace.id}))
		.children(
			RowContent(h, {
				line: Option.getOrElse(reason, () => clockOf(trace.start, 'second')),
				problem: Option.isSome(reason),
				title: traceLabel(trace),
				value: `${ageOf(trace.start, model.now)} · ${durationOf(trace.duration)}`
			}),
			checked && SymbolIcon(h, 'checkmark')
		)
}

function traceChoice(h: H, model: Model, selection: ReturnType<typeof selectionFor>, title: string) {
	const traces = tracesOf(selection)
	if (isNative || Array.isReadonlyArrayEmpty(traces)) return h.div.class('scope-trace-label axis-title').children(title)
	return h.div.class('min-w-0').children(
		Glass(h, 'scope-trace-control').children(
			Button(h)
				.class('scope-trace-choice')
				.attrs({'aria-expanded': `${model.panel === 'traces'}`, 'aria-haspopup': 'menu'})
				.on('click', Message.Panel({panel: 'traces'}))
				.children(h.span.children(title), SymbolIcon(h, 'chevron.down'))
		),
		menu(
			h,
			model,
			'traces',
			'Traces',
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

function traceContent(h: H, trace: TraceTree, selection: ReturnType<typeof selectionFor>) {
	if (Array.isReadonlyArrayEmpty(trace.spans)) return Notice(h, 'No spans')
	const focus = focusOf(trace, selection.pickedSpan)
	return h.div.class('scope-trace-content').children(
		Waterfall(
			h,
			trace,
			Option.map(focus, span => span.spanId)
		),
		pipe(
			focus,
			Option.map(span => SpanDetail(h, span)),
			Option.getOrUndefined
		)
	)
}

function traceView(h: H, model: Model, selection: ReturnType<typeof selectionFor>) {
	const active = Option.getOrUndefined(selection.activeTrace)
	const skeleton = h.div.class('scope-skeleton-trace').attr('aria-hidden', 'true')
	if (active === undefined) {
		if (AsyncResult.isInitial(model.overview)) return Loading(h, 'Loading trace', skeleton)
		return Notice(h, 'Select an operation')
	}

	return ReadState(traceReadOf(model), {
		failed: cause => ScopeFailure(h, model, cause),
		loading: () => Loading(h, 'Loading trace', skeleton),
		ready: trace => {
			const root = Array.findFirst(trace.spans, span => span.depth === 0)
			const started = Option.getOrUndefined(
				pipe(
					active.summary,
					Option.map(summary => summary.start),
					Option.orElse(() => Option.map(root, span => span.start))
				)
			)
			const title = pipe(
				active.summary,
				Option.map(traceLabel),
				Option.getOrElse(() => String.slice(0, 8)(active.id))
			)
			return [
				h.div
					.class('scope-trace-summary')
					.children(
						traceChoice(h, model, selection, title),
						started !== undefined &&
							h.p.class('axis-muted').attr('title', clockOf(started, 'second')).children(ageOf(started, model.now)),
						h.span.class('axis-value').children(durationOf(trace.durationMs))
					),
				traceContent(h, trace, selection)
			]
		}
	})
}

export function DetailPane(h: H, model: Model, selection: ReturnType<typeof selectionFor>) {
	return h.div.class('scope-detail').children(traceView(h, model, selection))
}
