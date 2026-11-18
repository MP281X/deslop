import {NodeCrypto} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Boolean,
	DateTime,
	Duration,
	Effect,
	Fiber,
	Function,
	Layer,
	Option,
	Order,
	Schema,
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

import {Digest} from 'effect/crypto'
import {Reactivity} from 'effect/reactivity'
import {TestClock} from 'effect/testing'

import {
	FindTracesParams,
	LogsRequest,
	MeasureLatencyParams,
	SearchLogsParams,
	TelemetryError,
	TraceId,
	TracesRequest
} from '#services/telemetry/schema.ts'
import {Telemetry} from '#services/telemetry/service.ts'

// Receipt is the test clock's first hour; a day ahead is a clock far past the ten minutes allowed.
const RECEIVED_NS = 3_600_000_000_000n
const FAST_NS = 86_400_000_000_000n
const MINUTE_NS = 60_000_000_000n

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

// Each test builds its own database, so no case sees another's rows or clock.
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

it.layer(telemetryLayer)(test =>
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
			yield* telemetry.ingestTraces(TRACES, 'identified')
			yield* telemetry.ingestTraces(yield* ciExport([child]), 'github')
			yield* telemetry.ingestTraces(
				yield* ciExport([{...root, links: [{spanId: '1111111111111111', traceId: ID}]}]),
				'github'
			)
			assert.deepStrictEqual(
				Array.map(
					(yield* telemetry.findTraces(yield* Schema.decodeEffect(FindTracesParams)({app: 'read-proof'}))).traces,
					trace => [trace.operation, trace.spans, Duration.toMillis(trace.ms), trace.failure]
				),
				[['root', 2, 100, Option.some('child')]]
			)
			const replacement = {...child, endTimeUnixNano: '170000000', status: {code: 1}}
			yield* telemetry.ingestTraces(yield* ciExport([replacement]), 'github')
			yield* telemetry.ingestTraces(yield* ciExport([replacement]), 'github')
			yield* telemetry.ingestTraces(
				yield* ciExport([{...Struct.omit(root, ['endTimeUnixNano']), name: 'late start', status: {code: 1}}]),
				'github'
			)
			assert.deepStrictEqual(
				Array.map(
					(yield* telemetry.findTraces(yield* Schema.decodeEffect(FindTracesParams)({app: 'read-proof'}))).traces,
					trace => [trace.operation, trace.spans, Duration.toMillis(trace.ms), trace.failure]
				),
				[['root', 2, 170, Option.some('root')]]
			)
			assert.strictEqual(Duration.toMillis((yield* telemetry.trace(id)).durationMs), 170)
			// The late start named no links, but the completed span it left alone still links to the other trace.
			assert.deepStrictEqual(
				Array.map((yield* telemetry.trace(id)).spans, span => span.traceId),
				[ID, id, id]
			)
		})
	)
)

it.layer(telemetryLayer)(test =>
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

it.layer(telemetryLayer)(test =>
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

it.layer(telemetryLayer)(test =>
	test.effect(
		'keeps retried spans once, restores interned statements, and searches words',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			yield* telemetry.ingestTraces(TRACES, 'identified')
			yield* telemetry.ingestTraces(TRACES, 'identified')
			const trace = yield* telemetry.trace(ID)
			assert.lengthOf(trace.spans, 1)
			assert.strictEqual(trace.spans[0]?.attributes['db.query.text'], 'SELECT 42')
			assert.strictEqual(
				(yield* telemetry.findTraces(yield* Schema.decodeEffect(FindTracesParams)({text: 'capture'}))).traces.length,
				1
			)
		})
	)
)

it.layer(telemetryLayer)(test =>
	test.effect(
		'expires traces thirty days after receipt',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			yield* telemetry.ingestTraces(TRACES, 'identified')
			yield* TestClock.adjust('719 hours')
			assert.lengthOf((yield* telemetry.trace(ID)).spans, 1)
			yield* TestClock.adjust('2 hours')
			assert.instanceOf(yield* Effect.flip(telemetry.trace(ID)), TelemetryError)
		})
	)
)

function serverExport(service: string, spans: readonly unknown[]) {
	return Schema.decodeUnknownEffect(TracesRequest)({
		resourceSpans: [
			{resource: {attributes: [{key: 'service.name', value: {stringValue: service}}]}, scopeSpans: [{spans}]}
		]
	})
}

// A digest that takes a day, so a log export received first commits after a later trace.
const slowDigestLayer = pipe(
	Telemetry.layer,
	Layer.provide(Layer.merge(SqliteClient.layer({filename: ':memory:'}), Reactivity.layer)),
	Layer.provide(Layer.mock(Digest.Digest, {digest: () => Effect.as(Effect.sleep('1 day'), new Uint8Array(32))}))
)

it.layer(slowDigestLayer)(test =>
	test.effect(
		'expires by receipt when a trace received later committed first',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			const early = TraceId.make('fffffffffffffffffffffffffffffff2')
			const logs = yield* Effect.forkChild(
				telemetry.ingestLogs(
					yield* Schema.decodeEffect(LogsRequest)({
						resourceLogs: [
							{
								resource: {attributes: [{key: 'service.name', value: {stringValue: 'log-server'}}]},
								scopeLogs: [{logRecords: [{body: {stringValue: 'early'}, timeUnixNano: '1000000', traceId: early}]}]
							}
						]
					}),
					'identified'
				)
			)
			yield* TestClock.adjust('12 hours')
			yield* telemetry.ingestTraces(TRACES, 'identified')
			yield* TestClock.adjust('12 hours')
			yield* Fiber.join(logs)
			yield* TestClock.adjust('29 days')
			yield* TestClock.adjust('1 hour')
			assert.lengthOf((yield* telemetry.trace(ID)).spans, 1)
			assert.instanceOf(yield* Effect.flip(telemetry.trace(early)), TelemetryError)
		})
	)
)

it.layer(telemetryLayer)(test =>
	test.effect(
		'names a trace by its real root and measures the root, not a skewed child',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			const id = TraceId.make('fffffffffffffffffffffffffffffff3')
			yield* telemetry.ingestTraces(
				yield* serverExport('skew-server', [
					{
						endTimeUnixNano: '1050000000',
						name: 'orphan',
						parentSpanId: '9999999999999999',
						spanId: '2222222222222222',
						startTimeUnixNano: '1000000000',
						traceId: id
					}
				]),
				'identified'
			)
			yield* telemetry.ingestTraces(
				yield* serverExport('skew-client', [
					{
						endTimeUnixNano: '10100000000',
						name: 'root',
						spanId: '1111111111111111',
						startTimeUnixNano: '10000000000',
						traceId: id
					}
				]),
				'identified'
			)
			assert.deepStrictEqual(
				Array.map((yield* telemetry.findTraces(yield* Schema.decodeEffect(FindTracesParams)({}))).traces, trace => [
					trace.operation,
					Duration.toMillis(trace.ms)
				]),
				[['root', 100]]
			)
		})
	)
)

it.layer(telemetryLayer)(test =>
	test.effect(
		'measures a root once a corrected child stops making it a stream',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
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
			yield* telemetry.ingestTraces(
				yield* serverExport('stream-server', [
					root,
					{...child, attributes: [method, {key: 'rpc.stream', value: {boolValue: true}}]}
				]),
				'identified'
			)
			const measure = Effect.flatMap(
				Schema.decodeEffect(MeasureLatencyParams)({name: 'notes.watch'}),
				telemetry.measureLatency
			)
			assert.strictEqual((yield* measure).count, 0)
			yield* telemetry.ingestTraces(yield* serverExport('stream-server', [child]), 'identified')
			assert.strictEqual((yield* measure).count, 1)
		})
	)
)

it.layer(telemetryLayer)(test =>
	test.effect(
		'keeps equal log lines of one export apart and a retried export once',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			const logs = yield* Schema.decodeEffect(LogsRequest)({
				resourceLogs: [
					{
						resource: {attributes: [{key: 'service.name', value: {stringValue: 'log-server'}}]},
						scopeLogs: [
							{logRecords: Array.makeBy(2, () => ({body: {stringValue: 'identical'}, timeUnixNano: '1000000'}))}
						]
					}
				]
			})
			yield* telemetry.ingestLogs(logs, 'identified')
			yield* telemetry.ingestLogs(logs, 'identified')
			assert.lengthOf((yield* telemetry.searchLogs(yield* Schema.decodeEffect(SearchLogsParams)({}))).logs, 2)
		})
	)
)

it.layer(telemetryLayer)(test =>
	test.effect(
		'never lets an anonymous export replace an identified span or log, and lets an identified one replace an anonymous one',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			const id = TraceId.make('fffffffffffffffffffffffffffffff5')
			const span = {endTimeUnixNano: '10000000', spanId: '1111111111111111', startTimeUnixNano: '0', traceId: id}
			const names = Effect.map(telemetry.trace(id), trace => Array.map(trace.spans, item => item.name))
			yield* telemetry.ingestTraces(yield* serverExport('owner-server', [{...span, name: 'real'}]), 'identified')
			yield* telemetry.ingestTraces(yield* serverExport('owner-server', [{...span, name: 'forged'}]), 'anonymous')
			assert.deepStrictEqual(yield* names, ['real'])
			const other = TraceId.make('fffffffffffffffffffffffffffffff6')
			const anonymous = {...span, name: 'guess', traceId: other}
			yield* telemetry.ingestTraces(yield* serverExport('owner-server', [anonymous]), 'anonymous')
			yield* telemetry.ingestTraces(yield* serverExport('owner-server', [{...anonymous, name: 'real'}]), 'identified')
			assert.deepStrictEqual(
				Array.map((yield* telemetry.trace(other)).spans, item => item.name),
				['real']
			)
			yield* telemetry.ingestTraces(yield* serverExport('owner-server', [{...anonymous, name: 'forged'}]), 'anonymous')
			assert.deepStrictEqual(
				Array.map((yield* telemetry.trace(other)).spans, item => item.name),
				['real']
			)
		})
	)
)

it.layer(telemetryLayer)(test =>
	test.effect(
		'keeps an identified replacement as long as a new trace',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			const id = TraceId.make('fffffffffffffffffffffffffffffffa')
			const span = {
				endTimeUnixNano: '10000000',
				name: 'guess',
				spanId: '1111111111111111',
				startTimeUnixNano: '0',
				traceId: id
			}
			yield* telemetry.ingestTraces(yield* serverExport('owner-server', [span]), 'anonymous')
			yield* TestClock.adjust('29 days')
			yield* telemetry.ingestTraces(yield* serverExport('owner-server', [{...span, name: 'real'}]), 'identified')
			yield* TestClock.adjust('2 days')
			assert.deepStrictEqual(
				Array.map((yield* telemetry.trace(id)).spans, item => item.name),
				['real']
			)
		})
	)
)

function repositoryExport(runtime: string) {
	return Schema.decodeEffect(TracesRequest)({
		resourceSpans: [
			{
				resource: {
					attributes: [
						{key: 'service.name', value: {stringValue: 'MP281X/deslop'}},
						{key: 'scope.runtime', value: {stringValue: runtime}}
					]
				},
				scopeSpans: [
					{
						spans: [
							{
								endTimeUnixNano: '10000000',
								name: 'Verify',
								spanId: '1111111111111111',
								startTimeUnixNano: '0',
								traceId: 'fffffffffffffffffffffffffffffff7'
							}
						]
					}
				]
			}
		]
	})
}

it.layer(telemetryLayer)(test =>
	test.effect(
		'refuses every service name that shows as a repository name',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			for (const service of [' MP281X/deslop ', '@deslop/MP281X/deslop', 'MP281X/deslop-server']) {
				assert.strictEqual(
					yield* telemetry.ingestTraces(
						yield* serverExport(service, [
							{
								endTimeUnixNano: '10000000',
								spanId: '1111111111111111',
								startTimeUnixNano: '0',
								traceId: 'fffffffffffffffffffffffffffffffb'
							}
						]),
						'identified'
					),
					1
				)
			}
		})
	)
)

it.layer(telemetryLayer)(test =>
	test.effect(
		'writes a repository name only from the GitHub webhook and never shows an anonymous ci runtime as CI',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			assert.strictEqual(yield* telemetry.ingestTraces(yield* repositoryExport('ci'), 'anonymous'), 1)
			assert.strictEqual(yield* telemetry.ingestTraces(yield* repositoryExport('server'), 'identified'), 1)
			assert.instanceOf(
				yield* Effect.flip(telemetry.trace(TraceId.make('fffffffffffffffffffffffffffffff7'))),
				TelemetryError
			)
			assert.strictEqual(yield* telemetry.ingestTraces(yield* repositoryExport('ci'), 'github'), 0)
			assert.lengthOf((yield* telemetry.trace(TraceId.make('fffffffffffffffffffffffffffffff7'))).spans, 1)
			yield* telemetry.ingestTraces(
				yield* ciExport([
					{
						endTimeUnixNano: '10000000',
						name: 'pretend',
						spanId: '2222222222222222',
						startTimeUnixNano: '0',
						traceId: 'fffffffffffffffffffffffffffffff8'
					}
				]),
				'anonymous'
			)
			assert.deepStrictEqual(
				Array.map(
					(yield* telemetry.trace(TraceId.make('fffffffffffffffffffffffffffffff8'))).spans,
					span => span.runtime
				),
				['unknown']
			)
		})
	)
)

function ns(value: bigint) {
	return `${value}`
}

function runExport(started: bigint, at: bigint) {
	return Schema.decodeEffect(TracesRequest)({
		resourceSpans: [
			{
				resource: {
					attributes: [
						{key: 'service.name', value: {stringValue: 'run-server'}},
						{key: 'scope.run.started_unix_nano', value: {stringValue: ns(started)}}
					]
				},
				scopeSpans: [
					{
						spans: [
							{
								endTimeUnixNano: ns(at),
								name: 'work',
								spanId: '1111111111111111',
								startTimeUnixNano: ns(at),
								traceId: pipe(`${at}`, String.padStart(32, 'd'))
							}
						]
					}
				]
			}
		]
	})
}

it.layer(telemetryLayer)(test =>
	test.effect(
		"moves a fast clock's whole export back together, keeping every length and offset as sent",
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			const parent = TraceId.make('fffffffffffffffffffffffffffffffa')
			const long = TraceId.make('fffffffffffffffffffffffffffffffb')
			yield* TestClock.adjust('1 hour')
			yield* telemetry.ingestTraces(
				yield* serverExport('clock-server', [
					{
						endTimeUnixNano: ns(FAST_NS + 4_000_000_000n),
						name: 'parent',
						spanId: '1111111111111111',
						startTimeUnixNano: ns(FAST_NS),
						traceId: parent
					},
					{
						endTimeUnixNano: ns(FAST_NS + 3_000_000_000n),
						name: 'child',
						parentSpanId: '1111111111111111',
						spanId: '2222222222222222',
						startTimeUnixNano: ns(FAST_NS + 2_000_000_000n),
						traceId: parent
					},
					{
						endTimeUnixNano: ns(FAST_NS + 660_000_000_000n),
						name: 'eleven minutes',
						spanId: '3333333333333333',
						startTimeUnixNano: ns(FAST_NS),
						traceId: long
					}
				]),
				'identified'
			)
			assert.deepStrictEqual(
				Array.map((yield* telemetry.trace(parent)).spans, span => [
					span.name,
					DateTime.toEpochMillis(span.start),
					Duration.toMillis(span.durationMs)
				]),
				[
					['parent', 2_940_000, 4000],
					['child', 2_942_000, 1000]
				]
			)
			assert.deepStrictEqual(
				Array.map((yield* telemetry.trace(long)).spans, span => [
					DateTime.toEpochMillis(span.start),
					Duration.toMillis(span.durationMs)
				]),
				[[2_940_000, 660_000]]
			)
		})
	)
)

it.layer(telemetryLayer)(test =>
	test.effect(
		'shifts a group only when its newest time is more than ten minutes past receipt',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			yield* TestClock.adjust('1 hour')
			const cases = [
				// Only its end is past the limit: it ends at receipt and keeps its length.
				{
					durationMs: 900_000,
					end: RECEIVED_NS + 20n * MINUTE_NS,
					id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeee1',
					start: RECEIVED_NS + 5n * MINUTE_NS,
					startMs: 2_700_000
				},
				{
					durationMs: 0,
					end: RECEIVED_NS + 10n * MINUTE_NS,
					id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeee2',
					start: RECEIVED_NS + 10n * MINUTE_NS,
					startMs: 4_200_000
				},
				{
					durationMs: 60_000,
					end: RECEIVED_NS - 29n * MINUTE_NS,
					id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeee3',
					start: RECEIVED_NS - 30n * MINUTE_NS,
					startMs: 1_800_000
				},
				// An end before its start never stores a negative length.
				{
					durationMs: 0,
					end: FAST_NS - MINUTE_NS,
					id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeee4',
					start: FAST_NS,
					startMs: 3_600_000
				}
			]
			yield* Effect.forEach(
				cases,
				item =>
					Effect.flatMap(
						serverExport('clock-server', [
							{
								endTimeUnixNano: ns(item.end),
								name: 'work',
								spanId: '1111111111111111',
								startTimeUnixNano: ns(item.start),
								traceId: item.id
							}
						]),
						request => telemetry.ingestTraces(request, 'identified')
					),
				{concurrency: 1}
			)
			assert.deepStrictEqual(
				yield* Effect.forEach(
					cases,
					item =>
						Effect.map(telemetry.trace(TraceId.make(item.id)), trace =>
							Array.map(trace.spans, span => [DateTime.toEpochMillis(span.start), Duration.toMillis(span.durationMs)])
						),
					{concurrency: 1}
				),
				Array.map(cases, item => [[item.startMs, item.durationMs]])
			)
		})
	)
)

it.layer(telemetryLayer)(test =>
	test.effect(
		"moves the logs of a fast clock's export back together, observed-only records included",
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			yield* TestClock.adjust('1 hour')
			yield* telemetry.ingestLogs(
				yield* Schema.decodeEffect(LogsRequest)({
					resourceLogs: [
						{
							resource: {attributes: [{key: 'service.name', value: {stringValue: 'clock-server'}}]},
							scopeLogs: [
								{
									logRecords: [
										{body: {stringValue: 'five seconds before'}, timeUnixNano: ns(FAST_NS - 5_000_000_000n)},
										{body: {stringValue: 'observed'}, observedTimeUnixNano: ns(FAST_NS + 1_000_000_000n)}
									]
								}
							]
						}
					]
				}),
				'identified'
			)
			assert.deepStrictEqual(
				pipe(
					(yield* telemetry.searchLogs(yield* Schema.decodeEffect(SearchLogsParams)({}))).logs,
					Array.map(log => DateTime.toEpochMillis(log.at)),
					Array.sort(Order.Number)
				),
				[3_594_000, 3_600_000]
			)
		})
	)
)

it.layer(telemetryLayer)(test =>
	test.effect(
		'keeps a fast process one run however often it sends, and calls the run heard from last the latest',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			yield* TestClock.adjust('1 hour')
			yield* Effect.forEach(
				[0n, 1n, 2n, 3n],
				offset =>
					pipe(
						runExport(FAST_NS, RECEIVED_NS + offset),
						Effect.flatMap(request => telemetry.ingestTraces(request, 'identified')),
						Effect.andThen(TestClock.adjust('1 second'))
					),
				{concurrency: 1}
			)
			assert.deepStrictEqual(
				Array.map((yield* telemetry.checkIngestion()).services, service => [
					service.entries,
					Option.map(service.runStarted, DateTime.toEpochMillis)
				]),
				[[4, Option.some(86_400_000)]]
			)
			yield* telemetry.ingestTraces(yield* runExport(RECEIVED_NS, RECEIVED_NS + 10_000_000_000n), 'identified')
			assert.deepStrictEqual(
				Array.map((yield* telemetry.checkIngestion()).services, service => [
					service.entries,
					Option.map(service.runStarted, DateTime.toEpochMillis)
				]),
				[[1, Option.some(3_600_000)]]
			)
		})
	)
)
