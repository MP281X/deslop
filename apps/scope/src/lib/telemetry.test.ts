import {assert, it} from '@effect/vitest'

import {Array, Boolean, Duration, Option, String, Struct, pipe} from 'effect'

import {navigationOf, nextSearch, selectionOf} from '#lib/telemetry.ts'
import type {NavigationEvent, Search} from '#lib/telemetry.ts'
import type {Overview} from '#services/telemetry/schema.ts'

const OPERATION = {app: 'deploy', name: 'Inventory.snapshot', runtime: 'server' as const}

function follow(events: NavigationEvent[], search: Search = {}) {
	return Array.reduce(events, search, nextSearch)
}

function failureTrace(start: number, failed: boolean) {
	return {
		duration: Duration.millis(1),
		id: String.repeat(32)('a'),
		start,
		...Boolean.match(failed, {onFalse: () => ({}), onTrue: () => ({failure: {span: 'run'}})})
	}
}

it('backs out one inspector level at a time without losing the selected operation, trace or span', () => {
	assert.strictEqual(navigationOf({}).path, 'Operations')
	const span = follow([
		{_tag: 'Operation', operation: OPERATION},
		{_tag: 'Trace', selection: {operation: OPERATION, traceId: 'second'}},
		{_tag: 'Span', selection: {operation: OPERATION, spanId: 'child', traceId: 'second'}}
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
		assert.deepStrictEqual(navigationOf(search).selection, {operation: OPERATION, spanId: 'child', traceId: 'second'})
	}
})

it('a new operation or trace cannot inherit the previous span selection', () => {
	const trace = follow([
		{_tag: 'Span', selection: {operation: OPERATION, spanId: 'child', traceId: 'second'}},
		{_tag: 'Trace', selection: {operation: OPERATION, traceId: 'third'}}
	])
	assert.deepStrictEqual(navigationOf(trace).selection, {operation: OPERATION, traceId: 'third'})
	assert.deepStrictEqual(
		navigationOf(nextSearch(trace, {_tag: 'Operation', operation: {...OPERATION, name: 'Metrics.current'}})).selection,
		{operation: {...OPERATION, name: 'Metrics.current'}}
	)
})

it('a new frame keeps a trace it still holds and clears one outside it', () => {
	const selected = follow(
		[
			{_tag: 'Operation', operation: OPERATION},
			{_tag: 'Trace', selection: {operation: OPERATION, traceId: 'second'}},
			{_tag: 'Span', selection: {operation: OPERATION, spanId: 'child', traceId: 'second'}}
		],
		{range: '1h', source: 'deploy'}
	)
	assert.deepStrictEqual(nextSearch(selected, {_tag: 'Range', keepTrace: true, range: '24h'}), {
		...selected,
		range: '24h'
	})
	assert.deepStrictEqual(nextSearch(selected, {_tag: 'Range', keepTrace: false, range: '10m'}), {
		operation: 'Inventory.snapshot',
		pane: 'Span',
		range: '10m',
		side: 'server',
		source: 'deploy'
	} satisfies Search)
})

it('chooses one app at a time and leaves the chosen tab alone', () => {
	const chosen = nextSearch({}, {_tag: 'Source', app: 'deploy'})
	assert.deepStrictEqual(chosen, {source: 'deploy'})
	assert.deepStrictEqual(nextSearch(chosen, {_tag: 'Source', app: 'deploy'}), chosen)
	const selected = follow([{_tag: 'Operation', operation: OPERATION}], {source: 'deploy'})
	assert.deepStrictEqual(nextSearch(selected, {_tag: 'Source', app: 'deploy'}), selected)
	assert.deepStrictEqual(nextSearch(selected, {_tag: 'Source', app: 'stash'}), {source: 'stash'})
	assert.deepStrictEqual(nextSearch(Struct.omit(selected, ['source']), {_tag: 'Source', app: 'stash'}), {
		source: 'stash'
	})
})

it('opens the app with the newest failed trace, else the first tab', () => {
	const overview: Overview = {
		apps: [
			{
				name: 'stash',
				operations: [
					{
						count: 1,
						failures: 0,
						name: 'notes.search',
						p50Ms: 1,
						p95Ms: 1,
						runtime: 'web',
						traces: [failureTrace(100, false)]
					}
				]
			},
			{
				name: 'deploy',
				operations: [
					{
						count: 1,
						failures: 1,
						name: 'Inventory.snapshot',
						p50Ms: 1,
						p95Ms: 1,
						runtime: 'server',
						traces: [failureTrace(300, true)]
					}
				]
			},
			{
				name: 'gateway',
				operations: [
					{
						count: 1,
						failures: 1,
						name: 'Request',
						p50Ms: 1,
						p95Ms: 1,
						runtime: 'server',
						traces: [failureTrace(500, true)]
					}
				]
			}
		]
	}
	assert.strictEqual(selectionOf(Option.some(overview), {}, false).source, 'gateway')
	const quiet: Overview = {
		apps: Array.map(overview.apps, app => ({
			...app,
			operations: Array.map(app.operations, operation => ({
				...operation,
				traces: Array.map(operation.traces, trace => failureTrace(trace.start, false))
			}))
		}))
	}
	assert.strictEqual(selectionOf(Option.some(quiet), {}, false).source, 'stash')
	assert.isUndefined(selectionOf(Option.some({apps: []}), {}, false).source)
})

it('selects the app, operation, trace and span the URL names, defaulting a desktop layout', () => {
	const traceId = String.repeat(32)('a')
	const otherId = String.repeat(32)('b')
	const overview: Overview = {
		apps: [
			{
				name: 'deploy',
				// In the overview's order: failing first, then most recently seen.
				operations: [
					{
						count: 1,
						failures: 1,
						name: 'deploy.fail',
						p50Ms: 1,
						p95Ms: 1,
						runtime: 'server',
						traces: [failureTrace(200, true)]
					},
					{
						count: 1,
						failures: 0,
						name: 'deploy.idle',
						p50Ms: 2,
						p95Ms: 2,
						runtime: 'server',
						traces: [
							{...failureTrace(300, false), id: traceId},
							{...failureTrace(100, false), id: otherId}
						]
					}
				]
			},
			{
				name: 'stash',
				operations: [
					{
						count: 1,
						failures: 0,
						name: 'notes.search',
						p50Ms: 1,
						p95Ms: 1,
						runtime: 'web',
						traces: [failureTrace(400, false)]
					}
				]
			}
		]
	}
	const desktop = selectionOf(Option.some(overview), {}, false)
	assert.strictEqual(desktop.source, 'deploy')
	assert.strictEqual(Option.getOrThrow(desktop.activeKey).name, 'deploy.fail')
	assert.isUndefined(desktop.pickedSpan)
	const phone = selectionOf(Option.some(overview), {}, true)
	assert.strictEqual(phone.source, 'deploy')
	assert.isTrue(Option.isNone(phone.activeOperation))
	const picked = selectionOf(
		Option.some(overview),
		{operation: 'deploy.idle', pane: 'Span', side: 'server', source: 'deploy', span: 'child', trace: otherId},
		true
	)
	assert.strictEqual(Option.getOrThrow(picked.activeOperation).operation.name, 'deploy.idle')
	assert.strictEqual(Option.getOrThrow(picked.activeTrace).id, otherId)
	assert.strictEqual(picked.pickedSpan, 'child')
	assert.strictEqual(
		Option.getOrThrow(
			selectionOf(Option.some(overview), {operation: 'deploy.fail', side: 'server', source: 'stash'}, false)
				.activeOperation
		).app.name,
		'stash'
	)
})

it('keeps the bar’s app filter through a selection and Back', () => {
	const selected = follow(
		[
			{_tag: 'Operation', operation: OPERATION},
			{_tag: 'Trace', selection: {operation: OPERATION, traceId: 'second'}},
			{_tag: 'Span', selection: {operation: OPERATION, spanId: 'child', traceId: 'second'}},
			{_tag: 'Back'}
		],
		{source: 'deploy'}
	)
	assert.strictEqual(selected.source, 'deploy')
	assert.strictEqual(navigationOf(selected).path, 'Trace')
})
