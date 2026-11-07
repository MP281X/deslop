import {assert, it} from '@effect/vitest'

import {Array} from 'effect'

import {navigationOf, nextSearch} from '#lib/utils.ts'
import type {NavigationEvent, Search} from '#lib/utils.ts'

const OPERATION = {app: 'deploy', name: 'Inventory.snapshot', runtime: 'server' as const}

function follow(events: NavigationEvent[], search: Search = {}) {
	return Array.reduce(events, search, nextSearch)
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
