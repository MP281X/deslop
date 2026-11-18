import {NodeCrypto} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {Array, Boolean, Duration, Effect, Function, Layer, Option, Schema, Stream, String, Struct, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'
import {TestClock} from 'effect/testing'

import {FindTracesParams, TelemetryError, TraceId, TracesRequest} from '#services/telemetry/schema.ts'
import {Telemetry} from '#services/telemetry/service.ts'

const TRACES = Schema.decodeSync(TracesRequest)({
	resourceSpans: [
		{
			resource: {attributes: [{key: 'service.name', value: {stringValue: '@deslop/stash-server'}}]},
			scopeSpans: [
				{
					spans: [
						{
							attributes: [{key: 'db.query.text', value: {stringValue: 'SELECT 42'}}],
							endTimeUnixNano: '10000000',
							name: 'Notes.capture',
							spanId: '1111111111111111',
							startTimeUnixNano: '0',
							traceId: '1234567890abcdef1234567890abcdef'
						}
					]
				}
			]
		}
	]
})

const ID = TraceId.make('1234567890abcdef1234567890abcdef')

const telemetryLayer = pipe(
	Telemetry.layer,
	Layer.provide(Layer.merge(SqliteClient.layer({filename: ':memory:'}), Reactivity.layer)),
	Layer.provide(NodeCrypto.layer)
)

function ciExport(spans: readonly unknown[]) {
	return Schema.decodeUnknownEffect(TracesRequest)({
		resourceSpans: [
			{
				resource: {
					attributes: [
						{key: 'service.name', value: {stringValue: 'read-proof'}},
						{key: 'scope.runtime', value: {stringValue: 'ci'}}
					]
				},
				scopeSpans: [{spans}]
			}
		]
	})
}

it.layer(telemetryLayer)(test => {
	test.effect(
		'keeps trace facts current through late roots, replacements, retries and late CI starts',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			const id = TraceId.make('fffffffffffffffffffffffffffffff1')
			const child = {
				endTimeUnixNano: '30000000',
				name: 'child',
				parentSpanId: '1111111111111111',
				spanId: '2222222222222222',
				startTimeUnixNano: '20000000',
				status: {code: 2},
				traceId: id
			}
			const root = {
				endTimeUnixNano: '100000000',
				name: 'root',
				spanId: '1111111111111111',
				startTimeUnixNano: '0',
				status: {code: 2},
				traceId: id
			}
			yield* telemetry.ingestTraces(yield* ciExport([child]))
			yield* telemetry.ingestTraces(yield* ciExport([root]))
			assert.deepStrictEqual(
				Array.map(
					(yield* telemetry.findTraces(yield* Schema.decodeEffect(FindTracesParams)({app: 'read-proof'}))).traces,
					trace => [trace.operation, trace.spans, Duration.toMillis(trace.ms), trace.failure]
				),
				[['root', 2, 100, Option.some('child')]]
			)
			const replacement = {...child, endTimeUnixNano: '170000000', status: {code: 1}}
			yield* telemetry.ingestTraces(yield* ciExport([replacement]))
			yield* telemetry.ingestTraces(yield* ciExport([replacement]))
			yield* telemetry.ingestTraces(
				yield* ciExport([{...Struct.omit(root, ['endTimeUnixNano']), name: 'late start', status: {code: 1}}])
			)
			assert.deepStrictEqual(
				Array.map(
					(yield* telemetry.findTraces(yield* Schema.decodeEffect(FindTracesParams)({app: 'read-proof'}))).traces,
					trace => [trace.operation, trace.spans, Duration.toMillis(trace.ms), trace.failure]
				),
				[['root', 2, 170, Option.some('root')]]
			)
			assert.strictEqual(Duration.toMillis((yield* telemetry.trace(id)).durationMs), 170)
		})
	)
	test.effect(
		'keeps the newest five successful runs alongside slow runs within the cap',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			yield* telemetry.ingestTraces(
				yield* Schema.decodeEffect(TracesRequest)({
					resourceSpans: [
						{
							resource: {attributes: [{key: 'service.name', value: {stringValue: 'recent-server'}}]},
							scopeSpans: [
								{
									spans: Array.map(Array.range(0, 39), index => ({
										endTimeUnixNano: '40000000',
										name: 'run',
										spanId: '1111111111111111',
										startTimeUnixNano: `${index * 1_000_000}`,
										traceId: String.padStart(32, '0')((index + 1).toString(16))
									}))
								}
							]
						}
					]
				})
			)
			assert.deepStrictEqual(
				Array.map(
					Option.getOrThrow(
						Array.head(
							Option.getOrThrow(
								Array.findFirst(
									Option.getOrThrow(yield* Stream.runHead(telemetry.watch('24h'))).apps,
									app => app.name === 'recent'
								)
							).operations
						)
					).traces,
					trace => Duration.toMillis(trace.duration)
				),
				[...Array.reverse(Array.range(26, 40)), 5, 4, 3, 2, 1]
			)
		})
	)
	test.effect(
		'counts merged app operations with nearest-rank latency and keeps slow traces plus newest failures',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			yield* telemetry.ingestTraces(
				yield* Schema.decodeEffect(TracesRequest)({
					resourceSpans: Array.map([0, 1], group => ({
						resource: {
							attributes: [
								{
									key: 'service.name',
									value: {
										stringValue: Boolean.match(group === 0, {
											onFalse: Function.constant('example'),
											onTrue: Function.constant('@deslop/example-server')
										})
									}
								},
								{key: 'scope.runtime', value: {stringValue: 'server'}}
							]
						},
						scopeSpans: [
							{
								spans: Array.map(Array.range(group * 20, group * 20 + 19), index => ({
									endTimeUnixNano: '40000000',
									name: 'example',
									spanId: '1111111111111111',
									startTimeUnixNano: `${index * 1_000_000}`,
									status: {
										code: Boolean.match(index >= 28, {onFalse: Function.constant(1), onTrue: Function.constant(2)})
									},
									traceId: String.padStart(32, '0')((index + 1).toString(16))
								}))
							}
						]
					}))
				})
			)
			const operation = Option.getOrThrow(
				Array.head(
					Option.getOrThrow(
						Array.findFirst(
							Option.getOrThrow(yield* Stream.runHead(telemetry.watch('24h'))).apps,
							item => item.name === 'example'
						)
					).operations
				)
			)
			assert.deepStrictEqual(
				[operation.count, operation.failures, Duration.toMillis(operation.p50Ms), Duration.toMillis(operation.p95Ms)],
				[40, 12, 20, 38]
			)
			assert.deepStrictEqual(
				Array.map(operation.traces, trace => Duration.toMillis(trace.duration)),
				[40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
			)
			assert.strictEqual(
				Array.countBy(operation.traces, trace => Option.isSome(trace.failure)),
				10
			)
		})
	)
	test.effect(
		'keeps retried spans once, restores interned statements, and searches words',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			yield* telemetry.ingestTraces(TRACES)
			yield* telemetry.ingestTraces(TRACES)
			const trace = yield* telemetry.trace(ID)
			assert.lengthOf(trace.spans, 1)
			assert.strictEqual(trace.spans[0]?.attributes['db.query.text'], 'SELECT 42')
			assert.strictEqual(
				(yield* telemetry.findTraces(yield* Schema.decodeEffect(FindTracesParams)({text: 'capture'}))).total,
				1
			)
		})
	)
	test.effect(
		'expires traces thirty days after receipt',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			yield* telemetry.ingestTraces(TRACES)
			yield* TestClock.adjust('719 hours')
			assert.lengthOf((yield* telemetry.trace(ID)).spans, 1)
			yield* TestClock.adjust('2 hours')
			assert.instanceOf(yield* Effect.flip(telemetry.trace(ID)), TelemetryError)
		})
	)
})
