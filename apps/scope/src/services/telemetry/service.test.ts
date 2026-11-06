import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Clock,
	Context,
	Effect,
	Exit,
	FileSystem,
	Fiber,
	Layer,
	Option,
	Order,
	Queue,
	Ref,
	Schema,
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

import {TestClock} from 'effect/testing'

import {Entry, LogsRequest, Query, TracesRequest} from '#services/telemetry/schema.ts'
import type {Overview} from '#services/telemetry/schema.ts'
import {Telemetry} from '#services/telemetry/service.ts'

const TRACE_ID = '1234567890abcdef1234567890abcdef'

const platform = Layer.merge(NodeCrypto.layer, NodeServices.layer)

// One span of `@deslop/stash-server` from a release, or a local build when the version is empty.
function release(version: string, id: string) {
	return TracesRequest.make({
		resourceSpans: [
			{
				resource: {
					attributes: [
						{key: 'service.name', value: {stringValue: '@deslop/stash-server'}},
						...Array.map(Array.filter([version], String.isNonEmpty), value => ({
							key: 'service.version',
							value: {stringValue: value}
						}))
					]
				},
				scopeSpans: [
					{
						spans: [
							{
								endTimeUnixNano: '1781870000010000000',
								name: 'share',
								spanId: String.repeat(16)(id),
								startTimeUnixNano: '1781870000000000000',
								traceId: String.repeat(32)(id)
							}
						]
					}
				]
			}
		]
	})
}

it.layer(platform)(test => {
	test.effect(
		'shares live recomputes across viewers and stops computing after the last viewer leaves',
		Effect.fnUntraced(function* () {
			const clock = yield* Clock.Clock
			const reads = yield* Ref.make(0)
			const telemetry = Context.get(
				yield* Layer.build(
					pipe(
						Telemetry.layer(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()),
						Layer.provide(
							Layer.succeed(Clock.Clock, {
								currentTimeMillis: Effect.tap(clock.currentTimeMillis, () => Ref.update(reads, count => count + 1)),
								currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
								currentTimeNanos: clock.currentTimeNanos,
								currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
								monotonicTimeNanos: clock.monotonicTimeNanos,
								monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
								sleep: duration => clock.sleep(duration)
							})
						)
					)
				),
				Telemetry
			)
			yield* TestClock.adjust('2 seconds')
			yield* telemetry.ingestTraces(release('0.1.1', 'a'))
			const idle = yield* Ref.get(reads)
			yield* TestClock.adjust('2 seconds')
			assert.strictEqual(yield* Ref.get(reads), idle)
			const pushed = yield* Queue.unbounded<Overview>()
			const first = yield* Effect.forkScoped(Stream.runForEach(telemetry.overview, value => Queue.offer(pushed, value)))
			const second = yield* Effect.forkScoped(
				Stream.runForEach(telemetry.overview, value => Queue.offer(pushed, value))
			)
			assert.strictEqual(yield* Queue.take(pushed), yield* Queue.take(pushed))
			assert.strictEqual(yield* Ref.get(reads), idle + 1)
			yield* telemetry.ingestTraces(release('0.1.1', 'b'))
			yield* TestClock.adjust('2 seconds')
			assert.strictEqual(yield* Queue.take(pushed), yield* Queue.take(pushed))
			yield* Fiber.interrupt(first)
			yield* Fiber.interrupt(second)
			yield* telemetry.ingestTraces(release('0.1.1', 'c'))
			const closed = yield* Ref.get(reads)
			yield* TestClock.adjust('2 seconds')
			assert.strictEqual(yield* Ref.get(reads), closed)
			assert.strictEqual(Option.getOrThrow(yield* Stream.runHead(telemetry.overview)).apps[0]?.operations[0]?.count, 3)
		})
	)
	test.effect(
		'retains by receipt time without changing future client timestamps',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			yield* TestClock.setTime(1_781_870_000_000)
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
												name: 'future',
												spanId: '1111111111111111',
												startTimeUnixNano: '99999999999999999999',
												traceId: TRACE_ID
											}
										]
									}
								]
							}
						]
					})
					yield* telemetry.ingestLogs({
						resourceLogs: [
							{
								scopeLogs: [
									{
										logRecords: [
											{body: {stringValue: 'future log'}, timeUnixNano: '99999999999999999999', traceId: TRACE_ID}
										]
									}
								]
							}
						]
					})
					const trace = yield* telemetry.trace(TRACE_ID)
					assert.strictEqual(trace.spans[0]?.time, '99999999999999999999')
					assert.strictEqual(trace.spans[0]?.receivedAt, 1_781_870_000_000)
					assert.strictEqual(trace.spans[0]?.payload['startTimeUnixNano'], '99999999999999999999')
					assert.strictEqual(trace.logs[0]?.time, '99999999999999999999')
				})
			)
			// The immediately previous release stored only the client's clock, without receipt timestamps.
			for (const file of yield* fs.readDirectory(directory)) {
				yield* pipe(
					fs.readFileString(`${directory}/${file}`),
					Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Entry))),
					Effect.map(Struct.omit(['receivedAt'])),
					Effect.flatMap(Schema.encodeEffect(Schema.fromJsonString(Entry))),
					Effect.flatMap(value => fs.writeFileString(`${directory}/${file}`, value))
				)
			}
			yield* Effect.scoped(
				Effect.gen(function* () {
					const telemetry = Context.get(yield* Layer.build(Telemetry.layer(directory)), Telemetry)
					assert.strictEqual((yield* telemetry.trace(TRACE_ID)).spans[0]?.receivedAt, 1_781_870_000_000)
				})
			)
			yield* TestClock.adjust('4 days')
			const telemetry = Context.get(yield* Layer.build(Telemetry.layer(directory)), Telemetry)
			assert.isTrue(Exit.isFailure(yield* Effect.exit(telemetry.trace(TRACE_ID))))
			assert.isEmpty(yield* fs.readDirectory(directory))
		})
	)
	test.effect(
		'keeps ingested spans across restarts for three days, past a broken entry file',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			yield* TestClock.setTime(1_781_870_000_000)
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
			yield* fs.writeFileString(`${directory}/broken`, '{')
			yield* TestClock.adjust('2 days')
			yield* Effect.scoped(
				Effect.gen(function* () {
					const telemetry = Context.get(yield* Layer.build(Telemetry.layer(directory)), Telemetry)
					assert.strictEqual((yield* telemetry.trace(TRACE_ID)).spans[0]?.name, 'persisted')
				})
			)
			assert.isFalse(yield* fs.exists(`${directory}/broken`))
			yield* TestClock.adjust('2 days')
			const telemetry = Context.get(yield* Layer.build(Telemetry.layer(directory)), Telemetry)
			assert.isTrue(Exit.isFailure(yield* Effect.exit(telemetry.trace(TRACE_ID))))
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
	Layer.provide(platform)
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

// The first letter of each kept trace of that service, which names it.
const kept = Effect.fnUntraced(function* (telemetry: Telemetry['Service']) {
	return Array.sort(
		Array.map(
			(yield* telemetry.traces({...query, limit: 10, runs: 'all', service: '@deslop/stash-server'})).entries,
			entry => String.slice(0, 1)(entry.id)
		),
		Order.String
	)
})

it.layer(platform)(test => {
	test.effect(
		"keeps only each service's newest release, across restarts, and never drops a local build's entries",
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			yield* TestClock.setTime(1_781_870_010_000)
			yield* Effect.scoped(
				Effect.gen(function* () {
					const telemetry = Context.get(yield* Layer.build(Telemetry.layer(directory)), Telemetry)
					yield* telemetry.ingestTraces(release('0.1.999', 'a'))
					yield* telemetry.ingestTraces(release('', 'b'))
					// A tab still on the release before sends after the server moved on: it never shows.
					yield* telemetry.ingestTraces(release('0.1.998', 'c'))
					assert.deepStrictEqual(yield* kept(telemetry), ['a', 'b'])
					// Parts compare as numbers: 0.1.1000 is newer than 0.1.999, whose trace goes; the local build's stays.
					yield* telemetry.ingestTraces(release('0.1.1000', 'd'))
					assert.deepStrictEqual(yield* kept(telemetry), ['b', 'd'])
					assert.containsSubset((yield* telemetry.services()).services, [{version: '0.1.1000'}])
					// OTel's version is free text: one that isn't dot-separated numbers, such as a commit, has no order and is kept.
					yield* telemetry.ingestTraces(release('a3f9c21', 'e'))
					assert.deepStrictEqual(yield* kept(telemetry), ['b', 'd', 'e'])
					yield* TestClock.adjust('2 seconds')
					assert.strictEqual(Option.getOrThrow(yield* Stream.runHead(telemetry.overview)).apps.length, 1)
				})
			)
			assert.deepStrictEqual(yield* kept(Context.get(yield* Layer.build(Telemetry.layer(directory)), Telemetry)), [
				'b',
				'd',
				'e'
			])
			assert.deepStrictEqual(Array.sort(yield* fs.readDirectory(directory), Order.String), [
				'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb%3Abbbbbbbbbbbbbbbb',
				'dddddddddddddddddddddddddddddddd%3Adddddddddddddddd',
				'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee%3Aeeeeeeeeeeeeeeee'
			])
		})
	)
})

it.layer(layer)(test => {
	test.effect(
		'keeps subscriptions inspectable without counting their connection lifetimes as operations',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			yield* telemetry.ingestTraces({
				resourceSpans: [
					{
						scopeSpans: [
							{
								spans: Array.flatMap(['stream', 'mcp', 'nested', 'action', 'client'], (name, index) => {
									const traceId = `${index}${String.repeat(31)('a')}`
									const root = {name, spanId: '1111111111111111', startTimeUnixNano: '1781870000000000000', traceId}
									const stream = {
										attributes: [{key: 'rpc.stream', value: {boolValue: true}}],
										name: 'watch',
										parentSpanId: root.spanId,
										spanId: '2222222222222222',
										startTimeUnixNano: root.startTimeUnixNano,
										traceId
									}
									if (name === 'stream') return [{...root, attributes: stream.attributes}]
									if (name === 'mcp') {
										return [
											{...root, name: 'POST /mcp'},
											{...stream, attributes: [], name: 'McpServer.@effect/mcp/2026-07-28/subscriptions/listen'}
										]
									}
									if (name === 'client') {
										return [
											{...root, attributes: [{key: 'rpc.method', value: {stringValue: 'watch'}}]},
											{
												...stream,
												attributes: [...stream.attributes, {key: 'rpc.method', value: {stringValue: 'watch'}}]
											}
										]
									}
									if (name === 'nested') return [root, stream]
									return [root]
								})
							}
						]
					}
				]
			})
			yield* TestClock.adjust('2 seconds')
			assert.sameMembers(
				Array.flatMap(Option.getOrThrow(yield* Stream.runHead(telemetry.overview)).apps, app =>
					Array.map(app.operations, operation => operation.name)
				),
				['nested', 'action']
			)
			assert.strictEqual((yield* telemetry.trace(`0${String.repeat(31)('a')}`)).spans.length, 1)
			assert.strictEqual((yield* telemetry.traces({...query, limit: 20, runs: 'all', service: ''})).total, 5)
		})
	)
	test.effect(
		'keeps default searches current while allowing complete historical traces',
		Effect.fnUntraced(function* () {
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

	test.effect(
		'reports rejected exports by credential presence without inventing service attribution',
		Effect.fnUntraced(function* () {
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

	test.effect(
		'assembles late parents, replaces repeated spans and preserves exact OTLP data',
		Effect.fnUntraced(function* () {
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

	test.effect(
		'keeps standalone logs searchable and correlates logs without requiring a stored span',
		Effect.fnUntraced(function* () {
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
			// Text searches what the entry says, not its ids: an array or key-value body reads as its words.
			assert.strictEqual((yield* telemetry.logs({...query, service: 'logging', text: 'BYTES aae='})).total, 1)
			assert.strictEqual((yield* telemetry.logs({...query, service: 'logging', text: 'aaaaaaaa'})).total, 0)
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

it.layer(layer)(test => {
	test.effect(
		'groups traces by app and operation, failures first, naming the span that broke',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			yield* telemetry.ingestTraces(
				TracesRequest.make({
					resourceSpans: [
						{
							resource: {attributes: [{key: 'service.name', value: {stringValue: '@deslop/stash-server'}}]},
							scopeSpans: [
								{
									spans: [
										// Effect marks the root failed too, so the row must still name the child where it broke.
										{
											endTimeUnixNano: '1781870000100000000',
											name: 'share',
											spanId: '1111111111111111',
											startTimeUnixNano: '1781870000000000000',
											status: {code: 2, message: 'upstream returned 502'},
											traceId: 'dddddddddddddddddddddddddddddddd'
										},
										{
											endTimeUnixNano: '1781870000050000000',
											name: 'http.get',
											parentSpanId: '1111111111111111',
											spanId: '2222222222222222',
											startTimeUnixNano: '1781870000010000000',
											status: {code: 2, message: 'upstream returned 502'},
											traceId: 'dddddddddddddddddddddddddddddddd'
										},
										{
											endTimeUnixNano: '1781870001020000000',
											name: 'share',
											spanId: '3333333333333333',
											startTimeUnixNano: '1781870001000000000',
											traceId: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
										},
										// A child whose root hasn't arrived yet is not a row of its own.
										{
											endTimeUnixNano: '1781870002005000000',
											name: 'http.get',
											parentSpanId: '9999999999999999',
											spanId: '5555555555555555',
											startTimeUnixNano: '1781870002001000000',
											traceId: '99999999999999999999999999999999'
										},
										{
											endTimeUnixNano: '1781870002010000000',
											name: 'list',
											spanId: '4444444444444444',
											startTimeUnixNano: '1781870002000000000',
											traceId: 'ffffffffffffffffffffffffffffffff'
										},
										// Effect names an HTTP span by its method alone: a server's route, or a client's path, says which request it was.
										{
											attributes: [
												{key: 'http.request.method', value: {stringValue: 'POST'}},
												{key: 'http.route', value: {stringValue: '/api/notes'}},
												{key: 'url.path', value: {stringValue: '/api/notes'}}
											],
											endTimeUnixNano: '1781870003010000000',
											kind: 2,
											name: 'POST',
											spanId: '6666666666666666',
											startTimeUnixNano: '1781870003000000000',
											traceId: '66666666666666666666666666666666'
										},
										{
											attributes: [
												{key: 'http.request.method', value: {stringValue: 'POST'}},
												{key: 'url.path', value: {stringValue: '/api/apps'}}
											],
											endTimeUnixNano: '1781870003010000000',
											kind: 3,
											name: 'POST',
											spanId: '8888888888888888',
											startTimeUnixNano: '1781870003000000000',
											traceId: '88888888888888888888888888888888'
										},
										// Scanners probing for files would otherwise make an operation per path.
										...Array.map(['/.env', '/wp-login.php'], (path, index) => ({
											attributes: [
												{key: 'http.request.method', value: {stringValue: 'GET'}},
												{key: 'url.path', value: {stringValue: path}}
											],
											endTimeUnixNano: '1781870003010000000',
											kind: 2,
											name: 'GET',
											spanId: `a${index}aaaaaaaaaaaaaa`,
											startTimeUnixNano: '1781870003000000000',
											traceId: `a${index}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`
										}))
									]
								}
							]
						},
						// The app's web client starts its own traces; they list under the same app as its server's.
						{
							resource: {
								attributes: [
									{key: 'service.name', value: {stringValue: '@deslop/stash-client'}},
									{key: 'scope.runtime', value: {stringValue: 'web'}}
								]
							},
							scopeSpans: [
								{
									spans: [
										{
											endTimeUnixNano: '1781870004010000000',
											name: 'notes.watch',
											spanId: '7777777777777777',
											startTimeUnixNano: '1781870004000000000',
											traceId: '77777777777777777777777777777777'
										}
									]
								}
							]
						}
					]
				})
			)
			// The page's overview recomputes at most once a second, so the clock moves past that pause.
			yield* TestClock.adjust('2 seconds')
			const apps = Option.getOrThrow(yield* Stream.runHead(telemetry.overview)).apps
			assert.deepStrictEqual(
				Array.map(apps, app => app.name),
				['stash']
			)
			const stash = Option.getOrThrow(Array.head(apps))
			// Failures lead, then the busiest; operations that ran as often keep no particular order.
			assert.deepStrictEqual(
				Array.map(Array.take(stash.operations, 2), operation => operation.name),
				['share', 'GET (no route)']
			)
			assert.sameDeepMembers(
				Array.map(stash.operations, operation => [
					operation.runtime,
					operation.name,
					operation.count,
					operation.failures
				]),
				[
					['unknown', 'share', 2, 1],
					['unknown', 'list', 1, 0],
					['unknown', 'GET (no route)', 2, 0],
					['unknown', 'POST /api/notes', 1, 0],
					['unknown', 'POST /api/apps', 1, 0],
					['web', 'notes.watch', 1, 0]
				]
			)
			// Slowest first, and only the root's operation lists the trace: its failing child is not a row.
			assert.deepStrictEqual(
				Array.map(stash.operations[0]?.traces ?? [], trace => [trace.id, trace.failure]),
				[
					['dddddddddddddddddddddddddddddddd', {message: 'upstream returned 502', span: 'http.get'}],
					['eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', undefined]
				]
			)
		})
	)
})
