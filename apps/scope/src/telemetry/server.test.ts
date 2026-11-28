import {NodeCrypto} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {Array, Boolean, Duration, Effect, Function, Layer, Option, Schema, Stream, String, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'

import {Telemetry} from './server.ts'

import {TracesRequest} from '#ingestion/contract.ts'
import {Ingestion} from '#ingestion/server.ts'

// Each test builds its own database, so no case sees another's rows or clock.
const layer = pipe(
	Ingestion.layer,
	Layer.provideMerge(Telemetry.layer),
	Layer.provide(Layer.merge(SqliteClient.layer({filename: ':memory:'}), Reactivity.layer)),
	Layer.provide(NodeCrypto.layer)
)

it.layer(layer)(test =>
	test.effect(
		'keeps the newest five successful runs alongside slow runs within the cap',
		Effect.fnUntraced(function* () {
			const ingestion = yield* Ingestion
			const telemetry = yield* Telemetry
			yield* ingestion.ingestTraces(
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
				}),
				'identified'
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
)

it.layer(layer)(test =>
	test.effect(
		'counts merged app operations with nearest-rank latency and keeps slow traces plus newest failures',
		Effect.fnUntraced(function* () {
			const ingestion = yield* Ingestion
			const telemetry = yield* Telemetry
			yield* ingestion.ingestTraces(
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
				}),
				'identified'
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
)
