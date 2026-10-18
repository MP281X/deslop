import {assert, it} from '@effect/vitest'

import {Array} from 'effect'

import {attributes, treeBranches} from '#services/telemetry/lib/utils.ts'
import {Resource, TraceSpan} from '#services/telemetry/schema.ts'

it('unwraps typed Effect annotations without losing integer precision or nested arrays', () => {
	assert.deepStrictEqual(
		attributes(
			Resource.make({
				attributes: [
					{key: 'id', value: {intValue: '9007199254740993'}},
					{key: 'amount', value: {doubleValue: 89.9}},
					{
						key: 'values',
						value: {arrayValue: {values: [{boolValue: false}, {arrayValue: {values: [{stringValue: 'nested'}]}}]}}
					}
				]
			})
		),
		{amount: 89.9, id: '9007199254740993', values: [false, ['nested']]}
	)
})

it('continues ancestor branches only until their final sibling', () => {
	const spans = Array.map(
		[
			{depth: 0, id: '1', parent: ''},
			{depth: 1, id: '2', parent: '1'},
			{depth: 2, id: '3', parent: '2'},
			{depth: 1, id: '4', parent: '1'}
		],
		node =>
			TraceSpan.make({
				depth: node.depth,
				durationMs: 1,
				id: node.id,
				logs: [],
				name: node.id,
				offsetMs: 0,
				parentSpanId: node.parent,
				payload: {},
				resource: {},
				resourceSchemaUrl: '',
				runtime: 'server',
				scope: {},
				scopeSchemaUrl: '',
				service: 'api',
				signal: 'trace',
				spanId: node.id,
				status: 0,
				time: '1',
				traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
			})
	)
	assert.deepStrictEqual(
		Array.map(spans, span => treeBranches(spans, span)),
		[[], [true], [true, false], [false]]
	)
})
