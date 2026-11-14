import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Option, Schema, String, pipe} from 'effect'

import {
	latencyOf,
	newestReleases,
	overviewOf,
	supersededBy,
	touchedTraces,
	traceTree
} from '#services/telemetry/lib/utils.ts'
import {
	AppName,
	OperationTrace,
	ReleaseVersion,
	ServiceName,
	Span,
	SpanId,
	SpanLink,
	TraceId
} from '#services/telemetry/schema.ts'

const A = '00000000000000000000000000000001'
const B = '00000000000000000000000000000002'
const SERVICE = ServiceName.make('stash-server')
const NOW = DateTime.makeUnsafe(1000)
const SPANS = Schema.decodeSync(Schema.Array(Span.json))([
	{
		attributes: {},
		duration: 100,
		name: 'capture',
		runtime: 'server',
		service: SERVICE,
		spanId: '0000000000000001',
		start: 10,
		status: 'ok',
		traceId: A
	},
	{
		attributes: {},
		duration: 10,
		name: 'read',
		parentSpanId: '0000000000000001',
		runtime: 'server',
		service: SERVICE,
		spanId: '0000000000000002',
		start: 20,
		status: 'failed',
		traceId: A
	},
	{
		attributes: {},
		duration: 200,
		name: 'share',
		runtime: 'web',
		service: SERVICE,
		spanId: '0000000000000003',
		start: 0,
		status: 'ok',
		traceId: B
	},
	{
		attributes: {},
		duration: 20,
		name: 'send',
		parentSpanId: '0000000000000003',
		runtime: 'web',
		service: SERVICE,
		spanId: '0000000000000004',
		start: 5,
		status: 'ok',
		traceId: B
	}
])

const TRACES = Array.map(
	[
		{app: 'stash', duration: 10, failed: false, id: A, name: 'capture', start: 30},
		{app: 'stash', duration: 100, failed: false, id: B, name: 'capture', start: 20},
		{app: 'gateway', duration: 20, failed: true, id: '00000000000000000000000000000003', name: 'connect', start: 10}
	],
	input => ({
		app: AppName.make(input.app),
		failed: input.failed,
		name: input.name,
		runtime: 'server' as const,
		trace: Schema.decodeSync(OperationTrace)({duration: input.duration, id: input.id, start: input.start})
	})
)
const RETAINED = [
	{ci: false, count: 2, failures: 0, service: ServiceName.make('stash')},
	{ci: false, count: 1, failures: 1, service: ServiceName.make('gateway')}
]

function stashOf(overview: ReturnType<typeof overviewOf>) {
	return Option.getOrThrow(Array.findFirst(overview.apps, app => app.name === 'stash'))
}

it('rejudges arriving span replacements together with the retained trace', () => {
	const replacement = Schema.decodeSync(Span.json)({
		attributes: {},
		duration: 150,
		name: 'read',
		parentSpanId: '0000000000000001',
		runtime: 'server',
		service: SERVICE,
		spanId: '0000000000000002',
		start: 20,
		status: 'ok',
		traceId: A
	})
	assert.deepStrictEqual(
		Array.map(touchedTraces([replacement], Array.take(SPANS, 2), NOW), trace => [
			trace.root,
			trace.broken,
			Duration.toMillis(trace.duration)
		]),
		[[SpanId.make('0000000000000001'), Option.none(), 160]]
	)
})

it('roots a trace when its late parent arrives', () => {
	assert.deepStrictEqual(
		Array.map(touchedTraces(Array.take(SPANS, 1), pipe(SPANS, Array.drop(1), Array.take(1)), NOW), trace => [
			trace.root,
			trace.rooted,
			trace.broken
		]),
		[[SpanId.make('0000000000000001'), true, Option.some(SpanId.make('0000000000000002'))]]
	)
})

it('supersedes only numeric releases older than the newest release of their own service', () => {
	const senders = [
		{service: SERVICE, version: Option.some(ReleaseVersion.make('1.9'))},
		{service: SERVICE, version: Option.some(ReleaseVersion.make('1.10'))},
		{service: SERVICE, version: Option.some(ReleaseVersion.make('local'))},
		{service: SERVICE, version: Option.none<ReleaseVersion>()}
	]
	const newest = newestReleases(senders, {[SERVICE]: ReleaseVersion.make('1.8')})
	assert.deepStrictEqual(newest, {[SERVICE]: '1.10'})
	assert.deepStrictEqual(Array.map(senders, supersededBy(newest)), [true, false, false, false])
	assert.isFalse(
		supersededBy(newest)({service: ServiceName.make('other'), version: Option.some(ReleaseVersion.make('1.0'))})
	)
})

it('computes nearest-rank latency percentiles from unordered durations', () => {
	const latency = latencyOf(Array.map([100, 2, 4, 1, 3], Duration.millis))
	assert.deepStrictEqual(
		[Duration.toMillis(latency.p50Ms), Duration.toMillis(latency.p95Ms), Duration.toMillis(latency.maxMs)],
		[3, 100, 100]
	)
})

it('keeps a recent fast failure among the slowest traces', () => {
	const traces = Array.map(
		[
			{duration: 1, failed: true, start: 100},
			...Array.map([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21], duration => ({
				duration,
				failed: false,
				start: 0
			}))
		],
		input => ({
			app: AppName.make('stash'),
			failed: input.failed,
			name: 'capture',
			runtime: 'server' as const,
			trace: Schema.decodeSync(OperationTrace)({
				duration: input.duration,
				id: String.padStart(32, '0')(input.duration.toString(16)),
				start: input.start
			})
		})
	)
	assert.deepStrictEqual(
		Array.map(stashOf(overviewOf(traces, RETAINED)).operations[0]?.traces ?? [], trace =>
			Duration.toMillis(trace.duration)
		),
		[21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 1]
	)
})

it('attaches a linked trace beneath the span that started it', () => {
	const links = Schema.decodeSync(Schema.Array(SpanLink.json))([
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
			stashOf(
				overviewOf(
					[
						{...Option.getOrThrow(Array.get(TRACES, 0)), name: 'recent'},
						{...Option.getOrThrow(Array.get(TRACES, 1)), failed: true, name: 'broken'}
					],
					RETAINED
				)
			).operations,
			operation => operation.name
		),
		['broken', 'recent']
	)
})
