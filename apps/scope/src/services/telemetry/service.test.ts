import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Context, Effect, FileSystem, Layer, String, pipe} from 'effect'

import {LogsRequest, Query, TracesRequest} from '#services/telemetry/schema.ts'
import {Telemetry} from '#services/telemetry/service.ts'

const TRACE_ID = '1234567890abcdef1234567890abcdef'

it.layer(NodeServices.layer)(test => {
	test.effect('keeps ingested spans readable after restarting storage', () =>
		Effect.gen(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			yield* Effect.scoped(
				Effect.gen(function* () {
					const telemetry = Context.get(yield* Layer.build(Telemetry.layer(directory)), Telemetry)
					yield* telemetry.ingestTraces({
						resourceSpans: [
							{
								scopeSpans: [
									{
										spans: [
											{
												name: 'persisted',
												spanId: '1111111111111111',
												startTimeUnixNano: '1781870000000000000',
												traceId: TRACE_ID
											}
										]
									}
								]
							}
						]
					})
				})
			)
			const telemetry = Context.get(yield* Layer.build(Telemetry.layer(directory)), Telemetry)
			assert.strictEqual((yield* telemetry.trace(TRACE_ID)).spans[0]?.name, 'persisted')
		})
	)
})

const layer = pipe(
	Layer.unwrap(
		Effect.map(
			FileSystem.FileSystem.use(fs => fs.makeTempDirectoryScoped()),
			Telemetry.layer
		)
	),
	Layer.provide(NodeServices.layer)
)
const query = Query.make({
	errors: false,
	from: 0,
	limit: 1,
	offset: 0,
	operation: '',
	runs: 'current',
	service: 'ordering',
	sort: 'recent',
	text: '',
	to: 2_000_000_000_000,
	traceId: ''
})

it.layer(layer)(test => {
	test.effect('keeps default searches current while allowing complete historical traces', () =>
		Effect.gen(function* () {
			const telemetry = yield* Telemetry
			const oldId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
			const newId = 'cccccccccccccccccccccccccccccccc'
			const old = TracesRequest.make({
				resourceSpans: Array.map(['session-web', 'session-api'], (name, index) => ({
					resource: {
						attributes: [
							{key: 'service.name', value: {stringValue: name}},
							{key: 'scope.run.started_unix_nano', value: {stringValue: '100'}}
						]
					},
					scopeSpans: [
						{
							spans: [
								{
									endTimeUnixNano: '1781870000002000000',
									name,
									spanId: String.padStart(16, '0')(`${index + 1}`),
									startTimeUnixNano: '1781870000000000000',
									traceId: oldId
								}
							]
						}
					]
				}))
			})
			yield* telemetry.ingestTraces(old)
			assert.strictEqual((yield* telemetry.trace(oldId)).spans.length, 2)
			yield* telemetry.ingestTraces(
				TracesRequest.make({
					resourceSpans: [
						{
							resource: {
								attributes: [
									{key: 'service.name', value: {stringValue: 'session-api'}},
									{key: 'scope.run.started_unix_nano', value: {stringValue: '200'}}
								]
							},
							scopeSpans: [
								{
									spans: [
										{
											endTimeUnixNano: '1781870000004000000',
											name: 'new request',
											spanId: '3333333333333333',
											startTimeUnixNano: '1781870000003000000',
											traceId: newId
										}
									]
								}
							]
						}
					]
				})
			)
			yield* telemetry.ingestTraces(old)
			assert.strictEqual((yield* telemetry.trace(oldId)).spans.length, 2)
			assert.strictEqual((yield* telemetry.spans({...query, service: 'session-web'})).total, 0)
			assert.strictEqual((yield* telemetry.spans({...query, runs: 'all', service: 'session-web'})).total, 1)
			assert.deepStrictEqual(
				Array.map((yield* telemetry.traces({...query, service: 'session-api'})).entries, entry => entry.id),
				[newId]
			)
			assert.deepStrictEqual(
				Array.map(
					(yield* telemetry.traces({...query, limit: 10, runs: 'all', service: 'session-api'})).entries,
					entry => entry.id
				),
				[newId, oldId]
			)
			assert.strictEqual((yield* telemetry.stats({...query, runs: 'all', service: 'session-api'})).count, 2)
			assert.containsSubset((yield* telemetry.services()).services, [
				{entries: 1, lastEventAt: '1781870000003000000', name: 'session-api', runStartedAt: '200'},
				{entries: 1, lastEventAt: '1781870000000000000', name: 'session-web', runStartedAt: '100'}
			])
		})
	)

	test.effect('reports rejected exports by credential presence without inventing service attribution', () =>
		Effect.gen(function* () {
			const telemetry = yield* Telemetry
			yield* telemetry.reject({credential: 'authorization', route: '/v1/traces', status: 401})
			yield* telemetry.reject({credential: 'authorization', route: '/v1/traces', status: 401})
			yield* telemetry.reject({credential: 'none', route: '/v1/traces', status: 401})
			yield* telemetry.reject({credential: 'cookie', route: '/v1/logs', status: 503})
			assert.containsSubset((yield* telemetry.services()).rejections, [
				{count: 2, credential: 'authorization', route: '/v1/traces', status: 401},
				{count: 1, credential: 'none', route: '/v1/traces', status: 401},
				{count: 1, credential: 'cookie', route: '/v1/logs', status: 503}
			])
		})
	)

	test.effect('assembles late parents, replaces repeated spans and preserves exact OTLP data', () =>
		Effect.gen(function* () {
			const telemetry = yield* Telemetry
			const child = TracesRequest.make({
				resourceSpans: [
					{
						resource: {attributes: [{key: 'service.name', value: {stringValue: 'ordering'}}]},
						schemaUrl: 'https://opentelemetry.io/schemas/1.0.0',
						scopeSpans: [
							{
								scope: {name: 'test'},
								spans: [
									{
										attributes: [{key: 'big', value: {intValue: '9007199254740993'}}],
										endTimeUnixNano: '1781870000001500001',
										name: 'child',
										parentSpanId: '1111111111111111',
										spanId: '2222222222222222',
										startTimeUnixNano: '1781870000001000000',
										status: {code: 2},
										traceId: TRACE_ID
									}
								]
							}
						]
					}
				]
			})
			yield* telemetry.ingestTraces(child)
			yield* telemetry.ingestTraces(child)
			yield* telemetry.ingestTraces(
				TracesRequest.make({
					resourceSpans: [
						{
							resource: {attributes: [{key: 'service.name', value: {stringValue: 'ordering'}}]},
							scopeSpans: [
								{
									spans: [
										{
											endTimeUnixNano: '1781870000002000000',
											name: 'root',
											spanId: '1111111111111111',
											startTimeUnixNano: '1781870000000000000',
											traceId: TRACE_ID
										}
									]
								}
							]
						}
					]
				})
			)
			assert.strictEqual((yield* telemetry.spans(query)).total, 2)
			const trace = yield* telemetry.trace(TRACE_ID)
			assert.strictEqual(trace.spans.length, 2)
			assert.deepStrictEqual(
				Array.map(trace.spans, entry => entry.name),
				['root', 'child']
			)
			assert.containsSubset(trace.spans, [
				{
					payload: {
						attributes: [{key: 'big', value: {intValue: '9007199254740993'}}],
						endTimeUnixNano: '1781870000001500001'
					},
					resourceSchemaUrl: 'https://opentelemetry.io/schemas/1.0.0'
				}
			])
			assert.deepStrictEqual(yield* telemetry.traces(query), {
				entries: [
					{
						durationMs: 2,
						errors: 1,
						id: TRACE_ID,
						logs: 0,
						operation: 'root',
						service: 'ordering',
						services: [{name: 'ordering', runtime: 'unknown'}],
						spans: 2,
						time: '1781870000000000000'
					}
				],
				total: 1
			})
			assert.deepStrictEqual(yield* telemetry.stats(query), {
				count: 2,
				errors: 1,
				from: query.from,
				maxMs: 2,
				p50Ms: 0.500001,
				p95Ms: 2,
				to: query.to
			})
		})
	)

	test.effect('keeps standalone logs searchable and correlates logs without requiring a stored span', () =>
		Effect.gen(function* () {
			const telemetry = yield* Telemetry
			yield* telemetry.ingestLogs(
				LogsRequest.make({
					resourceLogs: [
						{
							resource: {attributes: [{key: 'service.name', value: {stringValue: 'logging'}}]},
							scopeLogs: [
								{
									logRecords: [
										{body: {stringValue: 'standalone'}, observedTimeUnixNano: '1781870000001000000'},
										{
											body: {kvlistValue: {values: [{key: 'bytes', value: {bytesValue: 'AAE='}}]}},
											severityNumber: 17,
											timeUnixNano: '1781870000002000000',
											traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
										}
									]
								}
							]
						}
					]
				})
			)
			const page = yield* telemetry.logs({...query, service: 'logging'})
			assert.strictEqual(page.total, 2)
			assert.strictEqual(page.entries.length, 1)
			assert.strictEqual((yield* telemetry.logs({...query, errors: true, service: 'logging'})).total, 1)
			assert.strictEqual((yield* telemetry.trace('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).logs.length, 1)
			assert.deepStrictEqual(
				Array.map(
					(yield* telemetry.logs({...query, service: 'logging', text: 'standalone'})).entries,
					entry => entry.traceId
				),
				['']
			)
			yield* telemetry.ingestTraces(
				TracesRequest.make({
					resourceSpans: [
						{
							resource: {attributes: [{key: 'service.name', value: {stringValue: 'logging'}}]},
							scopeSpans: [
								{
									spans: [
										{
											name: 'request',
											spanId: '1111111111111111',
											startTimeUnixNano: '1781870000002000000',
											traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
										}
									]
								}
							]
						}
					]
				})
			)
			yield* telemetry.ingestLogs(
				LogsRequest.make({
					resourceLogs: [
						{
							resource: {attributes: [{key: 'service.name', value: {stringValue: 'logging'}}]},
							scopeLogs: [
								{
									logRecords: [
										{
											body: {stringValue: 'attached'},
											spanId: '1111111111111111',
											timeUnixNano: '1781870000003000000',
											traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
										}
									]
								}
							]
						}
					]
				})
			)
			const trace = yield* telemetry.trace('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
			assert.deepStrictEqual(
				Array.map(trace.spans, span => Array.map(span.logs, log => log.name)),
				[['attached']]
			)
			assert.strictEqual(trace.logs.length, 1)
		})
	)
})
