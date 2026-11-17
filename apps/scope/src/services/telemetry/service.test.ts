import {NodeCrypto} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {Array, Boolean, Duration, Effect, Function, Layer, Option, Schema, Stream, String, pipe} from 'effect'

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

it.layer(telemetryLayer)(test => {
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
