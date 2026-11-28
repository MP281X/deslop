import {NodeCrypto} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {Effect, Layer, Schema, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'

import {MeasureLatencyParams} from './contract.ts'
import {Search} from './server.ts'

import {TracesRequest} from '#ingestion/contract.ts'
import {Ingestion} from '#ingestion/server.ts'
import {TraceId} from '#telemetry/contract.ts'
import {Telemetry} from '#telemetry/server.ts'

// Each test builds its own database, so no case sees another's rows or clock.
const layer = pipe(
	Layer.mergeAll(Ingestion.layer, Search.layer),
	Layer.provideMerge(Telemetry.layer),
	Layer.provide(Layer.merge(SqliteClient.layer({filename: ':memory:'}), Reactivity.layer)),
	Layer.provide(NodeCrypto.layer)
)

function serverExport(service: string, spans: readonly unknown[]) {
	return Schema.decodeUnknownEffect(TracesRequest)({
		resourceSpans: [
			{resource: {attributes: [{key: 'service.name', value: {stringValue: service}}]}, scopeSpans: [{spans}]}
		]
	})
}

it.layer(layer)(test =>
	test.effect(
		'measures a root once a corrected child stops making it a stream',
		Effect.fnUntraced(function* () {
			const ingestion = yield* Ingestion
			const search = yield* Search
			const id = TraceId.make('fffffffffffffffffffffffffffffff4')
			const method = {key: 'rpc.method', value: {stringValue: 'notes.watch'}}
			const root = {
				attributes: [method],
				endTimeUnixNano: '20000000',
				name: 'notes.watch',
				spanId: '1111111111111111',
				startTimeUnixNano: '0',
				traceId: id
			}
			const child = {...root, name: 'child', parentSpanId: '1111111111111111', spanId: '2222222222222222'}
			yield* ingestion.ingestTraces(
				yield* serverExport('stream-server', [
					root,
					{...child, attributes: [method, {key: 'rpc.stream', value: {boolValue: true}}]}
				]),
				'identified'
			)
			const measure = Effect.flatMap(
				Schema.decodeEffect(MeasureLatencyParams)({name: 'notes.watch'}),
				search.measureLatency
			)
			assert.strictEqual((yield* measure).count, 0)
			yield* ingestion.ingestTraces(yield* serverExport('stream-server', [child]), 'identified')
			assert.strictEqual((yield* measure).count, 1)
		})
	)
)
