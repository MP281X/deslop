import {assert, it} from '@effect/vitest'

import {Array, Boolean, DateTime, Duration, Function, Option, Schema} from 'effect'

import {overviewOf, traceTree} from '#services/telemetry/lib/utils.ts'
import {AppName, OperationTrace, ServiceName, Span, SpanId, SpanLink, TraceId} from '#services/telemetry/schema.ts'

const A = '00000000000000000000000000000001'
const B = '00000000000000000000000000000002'
const SERVICE = ServiceName.make('stash-server')
// A stored span as its query answers it; each test names only what it is about.
const OPEN_SPAN = Schema.encodeSync(Span)({
	attributes: {},
	duration: Option.none(),
	error: Option.none(),
	exception: Option.none(),
	name: '',
	parentSpanId: Option.none(),
	run: Option.none(),
	runtime: 'server',
	service: SERVICE,
	spanId: SpanId.make('0000000000000001'),
	start: DateTime.makeUnsafe(0),
	status: 'ok',
	traceId: TraceId.make(A),
	version: Option.none()
})
function spanOf(fields: Partial<typeof Span.Encoded>) {
	return Schema.decodeSync(Span)({...OPEN_SPAN, ...fields})
}

const SPANS = [
	spanOf({duration: 100, name: 'capture', start: 10}),
	spanOf({
		duration: 10,
		name: 'read',
		parentSpanId: '0000000000000001',
		spanId: '0000000000000002',
		start: 20,
		status: 'failed'
	}),
	spanOf({duration: 200, name: 'share', runtime: 'web', spanId: '0000000000000003', start: 0, traceId: B}),
	spanOf({
		duration: 20,
		name: 'send',
		parentSpanId: '0000000000000003',
		runtime: 'web',
		spanId: '0000000000000004',
		start: 5,
		traceId: B
	})
]

const TRACES = Array.map(
	[
		{app: 'stash', duration: 10, failed: false, id: A, name: 'capture', start: 30},
		{app: 'stash', duration: 100, failed: false, id: B, name: 'capture', start: 20},
		{app: 'gateway', duration: 20, failed: true, id: '00000000000000000000000000000003', name: 'connect', start: 10}
	],
	input => ({
		app: AppName.make(input.app),
		count: 1,
		failures: Boolean.match(input.failed, {onFalse: Function.constant(0), onTrue: Function.constant(1)}),
		latest: DateTime.makeUnsafe(input.start),
		name: input.name,
		p50Ms: Duration.millis(input.duration),
		p95Ms: Duration.millis(input.duration),
		runtime: 'server' as const,
		traces: [Schema.decodeSync(OperationTrace)({duration: input.duration, id: input.id, start: input.start})] as const
	})
)
const RETAINED = [
	{ci: false, count: 2, failures: 0, service: ServiceName.make('stash')},
	{ci: false, count: 1, failures: 1, service: ServiceName.make('gateway')}
]

it('attaches a linked trace beneath the span that started it', () => {
	const links = Schema.decodeSync(Schema.Array(SpanLink))([
		{linkedSpanId: '0000000000000004', linkedTraceId: B, spanId: '0000000000000001', traceId: A}
	])
	assert.deepStrictEqual(
		Array.map(traceTree(TraceId.make(A), SPANS, [], links).spans, span => [span.name, span.depth]),
		[
			['share', 0],
			['send', 1],
			['capture', 2],
			['read', 3]
		]
	)
})

it('counts operations in the selected range while keeping retained app tabs', () => {
	assert.sameDeepMembers(
		Array.map(overviewOf(Array.take(TRACES, 1), RETAINED).apps, app => [
			app.name,
			Array.map(app.operations, operation => [operation.name, operation.count])
		]),
		[
			['gateway', []],
			['stash', [['capture', 1]]]
		]
	)
})

it('orders failing operations before newer successful operations', () => {
	assert.deepStrictEqual(
		Array.map(
			Option.getOrThrow(
				Array.findFirst(
					overviewOf(
						[
							{...Option.getOrThrow(Array.get(TRACES, 0)), name: 'recent'},
							{...Option.getOrThrow(Array.get(TRACES, 1)), failures: 1, name: 'broken'}
						],
						RETAINED
					).apps,
					app => app.name === 'stash'
				)
			).operations,
			operation => operation.name
		),
		['broken', 'recent']
	)
})
