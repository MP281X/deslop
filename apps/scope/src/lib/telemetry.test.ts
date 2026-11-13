import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Option, Schema, String, pipe} from 'effect'

import {navigationOf, nextSearch, Search, selectionOf} from '#lib/telemetry.ts'
import type {NavigationEvent} from '#lib/telemetry.ts'
import {AppName, SpanId, TraceId} from '#services/telemetry/schema.ts'
import type {Overview} from '#services/telemetry/schema.ts'

const OPERATION = {app: AppName.make('deploy'), name: 'Inventory.snapshot', runtime: 'server' as const}
const SECOND = TraceId.make(String.repeat(32)('a'))
const THIRD = TraceId.make(String.repeat(32)('b'))
const CHILD = SpanId.make(String.repeat(16)('c'))

function follow(events: NavigationEvent[], search: Search = Schema.decodeSync(Search)({})) {
	return Array.reduce(events, search, nextSearch)
}

function failureTrace(start: number, failed: boolean) {
	return {
		duration: Duration.millis(1),
		failure: Option.liftPredicate({error: Option.none(), span: 'run'}, () => failed),
		id: SECOND,
		label: Option.none(),
		start: DateTime.makeUnsafe(start)
	}
}

it('backs out one inspector level at a time without losing the selected operation, trace or span', () => {
	assert.strictEqual(navigationOf(Schema.decodeSync(Search)({})).path, 'Operations')
	const span = follow([
		{_tag: 'Operation', operation: OPERATION},
		{_tag: 'Trace', selection: {operation: OPERATION, traceId: SECOND}},
		{_tag: 'Span', selection: {operation: OPERATION, spanId: CHILD, traceId: SECOND}}
	])
	assert.strictEqual(navigationOf(span).path, 'Span')
	const backs = pipe({_tag: 'Back'} as const, Array.replicate(4), Array.scan(span, nextSearch))
	assert.deepStrictEqual(
		pipe(
			backs,
			Array.drop(1),
			Array.map(search => navigationOf(search).path)
		),
		['Trace', 'Traces', 'Operations', 'Operations']
	)
	for (const search of backs) {
		assert.deepStrictEqual(Option.getOrThrow(navigationOf(search).selection), {
			operation: OPERATION,
			spanId: Option.some(CHILD),
			traceId: Option.some(SECOND)
		})
	}
})

it('a new operation or trace cannot inherit the previous span selection', () => {
	const trace = follow([
		{_tag: 'Span', selection: {operation: OPERATION, spanId: CHILD, traceId: SECOND}},
		{_tag: 'Trace', selection: {operation: OPERATION, traceId: THIRD}}
	])
	assert.deepStrictEqual(Option.getOrThrow(navigationOf(trace).selection), {
		operation: OPERATION,
		spanId: Option.none(),
		traceId: Option.some(THIRD)
	})
	assert.deepStrictEqual(
		Option.getOrThrow(
			navigationOf(nextSearch(trace, {_tag: 'Operation', operation: {...OPERATION, name: 'Metrics.current'}})).selection
		),
		{operation: {...OPERATION, name: 'Metrics.current'}, spanId: Option.none(), traceId: Option.none()}
	)
})

it('a new frame keeps a trace it still holds and clears one outside it', () => {
	const selected = follow(
		[
			{_tag: 'Operation', operation: OPERATION},
			{_tag: 'Trace', selection: {operation: OPERATION, traceId: SECOND}},
			{_tag: 'Span', selection: {operation: OPERATION, spanId: CHILD, traceId: SECOND}}
		],
		Schema.decodeSync(Search)({range: '1h', source: 'deploy'})
	)
	assert.deepStrictEqual(nextSearch(selected, {_tag: 'Range', keepTrace: true, range: '24h'}), {
		...selected,
		range: Option.some('24h')
	})
	assert.deepStrictEqual(
		Schema.encodeSync(Search)(nextSearch(selected, {_tag: 'Range', keepTrace: false, range: '10m'})),
		{operation: 'Inventory.snapshot', pane: 'Span', range: '10m', side: 'server', source: 'deploy'}
	)
})

it('chooses one app at a time and leaves the chosen tab alone', () => {
	const chosen = nextSearch(Schema.decodeSync(Search)({}), {_tag: 'Source', app: AppName.make('deploy')})
	assert.deepStrictEqual(Schema.encodeSync(Search)(chosen), {source: 'deploy'})
	assert.deepStrictEqual(nextSearch(chosen, {_tag: 'Source', app: AppName.make('deploy')}), chosen)
	const selected = follow([{_tag: 'Operation', operation: OPERATION}], Schema.decodeSync(Search)({source: 'deploy'}))
	assert.deepStrictEqual(nextSearch(selected, {_tag: 'Source', app: AppName.make('deploy')}), selected)
	assert.deepStrictEqual(
		Schema.encodeSync(Search)(nextSearch(selected, {_tag: 'Source', app: AppName.make('stash')})),
		{source: 'stash'}
	)
	assert.deepStrictEqual(
		Schema.encodeSync(Search)(
			nextSearch({...selected, source: Option.none()}, {_tag: 'Source', app: AppName.make('stash')})
		),
		{source: 'stash'}
	)
})

it('opens the app with the newest failed trace, else the first tab', () => {
	const overview: Overview = {
		apps: Array.map(
			[
				{failed: false, name: AppName.make('stash'), operation: 'notes.search', runtime: 'web' as const, start: 100},
				{
					failed: true,
					name: AppName.make('deploy'),
					operation: 'Inventory.snapshot',
					runtime: 'server' as const,
					start: 300
				},
				{failed: true, name: AppName.make('gateway'), operation: 'Request', runtime: 'server' as const, start: 500}
			],
			app => ({
				ci: Option.none(),
				name: app.name,
				operations: [
					{
						count: 1,
						failures: 0,
						name: app.operation,
						p50Ms: Duration.millis(1),
						p95Ms: Duration.millis(1),
						runtime: app.runtime,
						traces: [failureTrace(app.start, app.failed)]
					}
				]
			})
		)
	}
	assert.strictEqual(
		Option.getOrThrow(selectionOf(Option.some(overview), Schema.decodeSync(Search)({}), false).source),
		'gateway'
	)
	const quiet: Overview = {
		apps: Array.map(overview.apps, app => ({
			...app,
			operations: Array.map(app.operations, operation => ({
				...operation,
				traces: Array.map(operation.traces, trace => ({...trace, failure: Option.none()}))
			}))
		}))
	}
	assert.strictEqual(
		Option.getOrThrow(selectionOf(Option.some(quiet), Schema.decodeSync(Search)({}), false).source),
		'stash'
	)
	assert.isTrue(Option.isNone(selectionOf(Option.some({apps: []}), Schema.decodeSync(Search)({}), false).source))
})

it('selects the app, operation, trace and span the URL names, defaulting a desktop layout', () => {
	const overview: Overview = {
		apps: [
			{
				ci: Option.none(),
				name: AppName.make('deploy'),
				operations: [
					{
						count: 1,
						failures: 1,
						name: 'deploy.fail',
						p50Ms: Duration.millis(1),
						p95Ms: Duration.millis(1),
						runtime: 'server',
						traces: [failureTrace(200, true)]
					},
					{
						count: 1,
						failures: 0,
						name: 'deploy.idle',
						p50Ms: Duration.millis(2),
						p95Ms: Duration.millis(2),
						runtime: 'server',
						traces: [failureTrace(300, false), {...failureTrace(100, false), id: THIRD}]
					}
				]
			},
			{
				ci: Option.none(),
				name: AppName.make('stash'),
				operations: [
					{
						count: 1,
						failures: 0,
						name: 'notes.search',
						p50Ms: Duration.millis(1),
						p95Ms: Duration.millis(1),
						runtime: 'web',
						traces: [failureTrace(400, false)]
					}
				]
			}
		]
	}
	const desktop = selectionOf(Option.some(overview), Schema.decodeSync(Search)({}), false)
	assert.strictEqual(Option.getOrThrow(desktop.source), 'deploy')
	assert.strictEqual(Option.getOrThrow(desktop.activeKey).name, 'deploy.fail')
	assert.isTrue(Option.isNone(desktop.pickedSpan))
	const phone = selectionOf(Option.some(overview), Schema.decodeSync(Search)({}), true)
	assert.strictEqual(Option.getOrThrow(phone.source), 'deploy')
	assert.isTrue(Option.isNone(phone.activeOperation))
	const picked = selectionOf(
		Option.some(overview),
		Schema.decodeSync(Search)({
			operation: 'deploy.idle',
			pane: 'Span',
			side: 'server',
			source: 'deploy',
			span: CHILD,
			trace: THIRD
		}),
		true
	)
	assert.strictEqual(Option.getOrThrow(picked.activeOperation).operation.name, 'deploy.idle')
	assert.strictEqual(Option.getOrThrow(picked.activeTrace).id, THIRD)
	assert.strictEqual(Option.getOrThrow(picked.pickedSpan), CHILD)
	assert.strictEqual(
		Option.getOrThrow(
			selectionOf(
				Option.some(overview),
				Schema.decodeSync(Search)({operation: 'deploy.fail', side: 'server', source: 'stash'}),
				false
			).activeOperation
		).app.name,
		'stash'
	)
})

it('keeps the bar’s app filter through a selection and Back', () => {
	const selected = follow(
		[
			{_tag: 'Operation', operation: OPERATION},
			{_tag: 'Trace', selection: {operation: OPERATION, traceId: SECOND}},
			{_tag: 'Span', selection: {operation: OPERATION, spanId: CHILD, traceId: SECOND}},
			{_tag: 'Back'}
		],
		Schema.decodeSync(Search)({source: 'deploy'})
	)
	assert.strictEqual(Option.getOrThrow(selected.source), 'deploy')
	assert.strictEqual(navigationOf(selected).path, 'Trace')
})
