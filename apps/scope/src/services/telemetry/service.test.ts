import {NodeCrypto} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {Effect, Layer, Schema, pipe} from 'effect'

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
