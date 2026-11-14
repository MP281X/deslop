import {NodeCrypto} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {Effect, Layer, Schema, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'
import {TestClock} from 'effect/testing'

import {TelemetryError, TraceId, TracesRequest} from '#services/telemetry/schema.ts'
import {Telemetry} from '#services/telemetry/service.ts'

const TRACES = Schema.decodeSync(TracesRequest)({
	resourceSpans: [
		{
			resource: {attributes: [{key: 'service.name', value: {stringValue: '@deslop/stash-server'}}]},
			scopeSpans: [
				{
					spans: [
						{
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
		'expires traces three days after receipt',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			yield* telemetry.ingestTraces(TRACES)
			yield* TestClock.adjust('71 hours')
			assert.lengthOf((yield* telemetry.trace(ID)).spans, 1)
			yield* TestClock.adjust('2 hours')
			assert.instanceOf(yield* Effect.flip(telemetry.trace(ID)), TelemetryError)
		})
	)
})
