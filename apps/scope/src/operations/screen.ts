import {Array, Boolean, DateTime, Function, Option, Order, Schema, pipe} from 'effect'

import type {RowData, ToolbarAction} from '@deslop/components/model'
import {compactCountOf, durationOf} from '@deslop/runtime/shared/format'
import {TimeFrame} from '@deslop/runtime/shared/time'

import type {Search} from '#reads'

import {AppName, Operation, Runtime} from '#telemetry/contract.ts'
import type {OperationTrace, Overview} from '#telemetry/contract.ts'

const SIDES: Record<Runtime, string> = {ci: 'CI', mobile: 'iOS', server: 'Server', unknown: '', web: 'Web'}

export type OperationKey = typeof OperationKey.Type
export const OperationKey = Schema.Struct({app: AppName, name: Operation.fields.name, runtime: Runtime})
export type Selection = {operation: OperationKey; spanId: Search['span']; traceId: Search['trace']}

function selectionIn(search: Search) {
	return Option.map(
		Option.all({app: search.source, name: search.operation, runtime: search.side}),
		operation => ({operation, spanId: search.span, traceId: search.trace}) satisfies Selection
	)
}

// The URL a selection produces in the given pane; a pick keeps the pane it was made in and the page's time frame.
export function select(search: Search, selection: Selection, pane: Option.Option.Value<Search['pane']>) {
	return {
		operation: Option.some(selection.operation.name),
		pane: Option.some(pane),
		range: search.range,
		side: Option.some(selection.operation.runtime),
		source: Option.some(selection.operation.app),
		span: selection.spanId,
		trace: selection.traceId
	} satisfies Search
}

// The bar chooses one app at a time and clears the selection it no longer contains; choosing the chosen app again changes nothing.
export function sourceSearch(search: Search, app: AppName) {
	if (Option.contains(search.source, app)) return search
	return {
		...search,
		operation: Option.none(),
		pane: Option.none(),
		side: Option.none(),
		source: Option.some(app),
		span: Option.none(),
		trace: Option.none()
	}
}

// The app a plain open lands on: the one whose newest failed trace is newest, else the first tab.
function openingApp(overview: Overview) {
	return pipe(
		Array.flatMap(overview.apps, app =>
			Array.flatMap(app.operations, operation =>
				Array.getSomes(
					Array.map(operation.traces, trace => Option.map(trace.failure, () => ({app: app.name, start: trace.start})))
				)
			)
		),
		Array.match({
			onEmpty: () => Option.none<{app: AppName; start: DateTime.Utc}>(),
			onNonEmpty: entries =>
				Option.some(
					Array.max(
						entries,
						Order.mapInput(DateTime.Order, entry => entry.start)
					)
				)
		}),
		Option.map(entry => entry.app),
		Option.orElse(() => Option.map(Array.head(overview.apps), app => app.name))
	)
}

export type ActiveOperation = {app: Overview['apps'][number]; operation: Operation}

// One app's operations, in the overview's order: failing first, then most recently seen.
function operationsOf(overview: Overview, source: Option.Option<AppName>) {
	return pipe(
		overview.apps,
		Array.filter((app: Overview['apps'][number]) => Option.contains(source, app.name)),
		Array.flatMap((app: Overview['apps'][number]) => Array.map(app.operations, operation => ({app, operation})))
	)
}

function findOperation(overview: Overview, key: OperationKey) {
	return pipe(
		overview.apps,
		Array.findFirst(app => app.name === key.app),
		Option.flatMap(app =>
			pipe(
				app.operations,
				Array.findFirst(operation => operation.runtime === key.runtime && operation.name === key.name),
				Option.map(operation => ({app, operation}))
			)
		)
	)
}

// A quiet frame is not a missing trace: retain explicit URL ids for the detail reader; defaults apply only without a trace id.
export function selectionOf(overview: Option.Option<Overview>, search: Search) {
	const selection = selectionIn(search)
	const requested = Option.flatMap(selection, selected => selected.traceId)
	const source = pipe(
		search.source,
		Option.filter(
			name =>
				Option.isSome(requested) ||
				Option.exists(overview, current => Array.some(current.apps, app => app.name === name))
		),
		Option.orElse(() => Option.flatMap(overview, openingApp))
	)
	const activeOperation = pipe(
		Option.map(selection, selected => selected.operation),
		Option.flatMap(key => Option.flatMap(overview, current => findOperation(current, key))),
		Option.filter(active => Option.contains(source, active.app.name)),
		Option.orElse(() =>
			Boolean.match(Option.isSome(requested), {
				onFalse: () => Option.flatMap(overview, current => Array.head(operationsOf(current, source))),
				onTrue: () => Option.none<ActiveOperation>()
			})
		)
	)
	const activeKey = pipe(
		activeOperation,
		Option.map(active => ({app: active.app.name, name: active.operation.name, runtime: active.operation.runtime})),
		Option.orElse(() =>
			pipe(
				selection,
				Option.filter(selected => Option.isSome(selected.traceId)),
				Option.map(selected => selected.operation)
			)
		)
	)
	const listed = Option.flatMap(activeOperation, active =>
		Option.match(requested, {
			onNone: () => Array.head(active.operation.traces),
			onSome: id => Array.findFirst(active.operation.traces, trace => trace.id === id)
		})
	)
	const activeTrace = pipe(
		requested,
		Option.orElse(() => Option.map(listed, trace => trace.id)),
		Option.map(id => ({id, summary: listed}))
	)
	const pickedSpan = pipe(
		selection,
		Option.filter(selected => Option.exists(activeTrace, trace => Option.contains(selected.traceId, trace.id))),
		Option.flatMap(selected => selected.spanId)
	)
	return {activeKey, activeOperation, activeTrace, pickedSpan, source}
}

// Without a direct trace, drop vanished operation selections; explicit trace URLs keep their ids and context.
export function shownSearch(
	search: Search,
	selection: {
		activeOperation: Option.Option<ActiveOperation>
		activeTrace: Option.Option<Pick<OperationTrace, 'id'>>
		source: Option.Option<AppName>
	},
	loaded: boolean
) {
	const chosen = Option.match(selection.source, {onNone: () => search, onSome: app => sourceSearch(search, app)})
	if (!loaded) return chosen
	const staleOperation =
		Option.isSome(chosen.operation) &&
		!Option.exists(
			selection.activeOperation,
			active =>
				Option.contains(chosen.source, active.app.name) &&
				Option.contains(chosen.operation, active.operation.name) &&
				Option.contains(chosen.side, active.operation.runtime)
		)
	if (staleOperation && Option.isNone(chosen.trace)) {
		return {...chosen, operation: Option.none(), side: Option.none(), span: Option.none(), trace: Option.none()}
	}
	if (
		Option.isSome(chosen.trace) &&
		!Option.exists(selection.activeTrace, trace => Option.contains(chosen.trace, trace.id))
	) {
		return {...chosen, span: Option.none(), trace: Option.none()}
	}
	return chosen
}

function operationId(key: OperationKey) {
	return `operation:${key.app}:${key.runtime}:${key.name}`
}

export function problemDot(failed: boolean, reason: string) {
	if (failed) return {problem: {reason, status: 'error' as const}}
	return {}
}

// One row per operation of the chosen app, with the id its selection carries and the failure a hover names.
export function operationRows(overview: Option.Option<Overview>, source: Option.Option<AppName>) {
	return pipe(
		overview,
		Option.map(value => operationsOf(value, source)),
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

export function activeOperationId(key: Option.Option<OperationKey>) {
	return Option.map(key, operationId)
}

// The bar's app and range menus, and the retry a stale read offers.
export function controls(options: {
	knownSources: readonly AppName[]
	range: TimeFrame
	source: Option.Option<AppName>
	stale: boolean
}) {
	const sources = Array.map(options.knownSources, name => ({
		checked: Option.contains(options.source, name),
		id: `app:${name}`,
		label: name
	}))
	const actions: ToolbarAction[] = [
		{
			disabled: Array.isReadonlyArrayEmpty(sources),
			id: 'apps',
			label: Option.match(options.source, {onNone: Function.constant('Apps'), onSome: name => `App: ${name}`}),
			menu: sources,
			symbol: 'square.stack'
		},
		{
			id: 'ranges',
			label: `Range: ${options.range}`,
			menu: Array.map(TimeFrame.literals, frame => ({
				checked: options.range === frame,
				id: `range:${frame}`,
				label: frame
			})),
			symbol: 'clock'
		}
	]
	if (options.stale) {
		return Array.append(actions, {
			id: 'retry',
			label: 'Out of date · Retry',
			symbol: 'exclamationmark.circle'
		} satisfies ToolbarAction)
	}
	return actions
}
