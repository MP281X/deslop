import {assert, it} from '@effect/vitest'

import {Array, Boolean, Option, String} from 'effect'

import {navigationOf, nextSearch, openingApp} from '#lib/utils.ts'
import type {NavigationEvent, Search} from '#lib/utils.ts'
import type {Overview} from '#services/telemetry/schema.ts'

const OPERATION = {app: 'deploy', name: 'Inventory.snapshot', runtime: 'server' as const}

function follow(events: NavigationEvent[], search: Search = {}) {
	return Array.reduce(events, search, nextSearch)
}

function failureTrace(time: string, failed: boolean) {
	return {
		durationMs: 1,
		id: String.repeat(32)('a'),
		time,
		...Boolean.match(failed, {onFalse: () => ({}), onTrue: () => ({failure: {message: '', span: 'run'}})})
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
	const backs = Array.scan(Array.replicate({_tag: 'Back'} as const, 4), span, nextSearch)
	assert.deepStrictEqual(
		Array.map(Array.drop(backs, 1), search => navigationOf(search).path),
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

it('chooses one app at a time and leaves the chosen tab alone', () => {
	const chosen = nextSearch({}, {_tag: 'Source', app: 'deploy'})
	assert.deepStrictEqual(chosen, {source: 'deploy'})
	assert.deepStrictEqual(nextSearch(chosen, {_tag: 'Source', app: 'deploy'}), chosen)
	const selected = follow([{_tag: 'Operation', operation: OPERATION}], {source: 'deploy'})
	assert.deepStrictEqual(nextSearch(selected, {_tag: 'Source', app: 'deploy'}), selected)
	assert.deepStrictEqual(nextSearch(selected, {_tag: 'Source', app: 'stash'}), {source: 'stash'})
	assert.deepStrictEqual(nextSearch({...selected, source: undefined}, {_tag: 'Source', app: 'stash'}), {
		source: 'stash'
	})
})

it('opens the app with the newest failed trace, else the first tab', () => {
	const overview: Overview = {
		apps: [
			{
				name: 'stash',
				operations: [
					{count: 1, failures: 0, name: 'notes.search', p50Ms: 1, runtime: 'web', traces: [failureTrace('100', false)]}
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
						runtime: 'server',
						traces: [failureTrace('300', true)]
					}
				]
			},
			{
				name: 'gateway',
				operations: [
					{count: 1, failures: 1, name: 'Request', p50Ms: 1, runtime: 'server', traces: [failureTrace('500', true)]}
				]
			}
		]
	}
	assert.deepStrictEqual(openingApp(overview), Option.some('gateway'))
	const quiet: Overview = {
		apps: Array.map(overview.apps, app => ({
			...app,
			operations: Array.map(app.operations, operation => ({
				...operation,
				traces: Array.map(operation.traces, trace => failureTrace(trace.time, false))
			}))
		}))
	}
	assert.deepStrictEqual(openingApp(quiet), Option.some('stash'))
	assert.deepStrictEqual(openingApp({apps: []}), Option.none())
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
