import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Clock,
	Context,
	DateTime,
	Deferred,
	Effect,
	Exit,
	FileSystem,
	Fiber,
	Function,
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

import {KeyValueStore} from 'effect/persistence'
import {TestClock} from 'effect/testing'

import {Entry, LogsRequest, TracesRequest} from '#services/telemetry/schema.ts'
import type {Overview, ReadTraceAnswer, TracesAnswer} from '#services/telemetry/schema.ts'
import {Telemetry} from '#services/telemetry/service.ts'

const TRACE_ID = '1234567890abcdef1234567890abcdef'
const NOW = 1_781_870_000_000
const START = `${BigInt(NOW) * 1_000_000n}`

const platform = Layer.merge(NodeCrypto.layer, NodeServices.layer)

function kept(telemetry: Telemetry['Service']) {
	return Effect.map(telemetry.findTraces({errors: false, limit: 50, since: '3d', sort: 'recent'}), page =>
		Array.sort(
			Array.map(page.traces, entry => String.slice(0, 1)(entry.id)),
			Order.String
		)
	)
}

function denial(type: string) {
	return [
		{
			attributes: [
				{key: 'exception.type', value: {stringValue: type}},
				{key: 'exception.message', value: {stringValue: 'Sign in first\n    at auth.ts:1:1'}},
				{key: 'exception.stacktrace', value: {stringValue: 'stack'}}
			],
			name: 'exception',
			timeUnixNano: START
		}
	]
}

type AttributeInput = {key: string; value: Schema.JsonObject}

function release(version: string, key: string, start = START) {
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
								endTimeUnixNano: `${BigInt(start) + 10_000_000n}`,
								name: 'share',
								spanId: String.repeat(16)(key),
								startTimeUnixNano: start,
								traceId: String.repeat(32)(key)
							}
						]
					}
				]
			}
		]
	})
}

type SpanInput = {
	attributes?: readonly AttributeInput[]
	end?: string
	events?: readonly {attributes?: readonly AttributeInput[]; name: string; timeUnixNano: string}[]
	kind?: number
	links?: readonly {spanId: string; traceId: string}[]
	name: string
	parent?: string
	spanId: string
	start: string
	status?: {code: number; message?: string}
	traceId: string
}

function span(input: SpanInput) {
	return {
		...Option.match(Option.fromUndefinedOr(input.attributes), {
			onNone: () => ({}),
			onSome: attributes => ({attributes})
		}),
		...Option.match(Option.fromUndefinedOr(input.end), {onNone: () => ({}), onSome: end => ({endTimeUnixNano: end})}),
		...Option.match(Option.fromUndefinedOr(input.events), {onNone: () => ({}), onSome: events => ({events})}),
		...Option.match(Option.fromUndefinedOr(input.kind), {onNone: () => ({}), onSome: kind => ({kind})}),
		...Option.match(Option.fromUndefinedOr(input.links), {onNone: () => ({}), onSome: links => ({links})}),
		name: input.name,
		...Option.match(Option.fromUndefinedOr(input.parent), {
			onNone: () => ({}),
			onSome: parentSpanId => ({parentSpanId})
		}),
		spanId: input.spanId,
		startTimeUnixNano: input.start,
		...Option.match(Option.fromUndefinedOr(input.status), {onNone: () => ({}), onSome: status => ({status})}),
		traceId: input.traceId
	}
}

function stored(index: number) {
	const traceId = String.padStart(32, '0')((index + 1).toString(16))
	const spanId = String.padStart(16, '0')((index + 1).toString(16))
	return Entry.make({
		durationMs: 1,
		id: `${traceId}:${spanId}`,
		name: 'stored.op',
		payload: span({end: `${BigInt(START) + 1_000_000n}`, name: 'stored.op', spanId, start: START, traceId}),
		receivedAt: NOW,
		resource: {
			attributes: [
				{key: 'service.name', value: {stringValue: '@deslop/stored-server'}},
				{key: 'scope.runtime', value: {stringValue: 'server'}}
			]
		},
		service: '@deslop/stored-server',
		signal: 'trace',
		spanId,
		status: 0,
		time: START,
		traceId
	})
}

function versioned(service: string, version: string, spans: readonly ReturnType<typeof span>[]) {
	return {
		resource: {
			attributes: [
				{key: 'service.name', value: {stringValue: service}},
				...Array.map(Array.filter([version], String.isNonEmpty), value => ({
					key: 'service.version',
					value: {stringValue: value}
				}))
			]
		},
		scopeSpans: [{spans}]
	}
}

function request(
	service: string,
	spans: readonly ReturnType<typeof span>[],
	options: {runtime?: string; version?: string} = {}
) {
	return TracesRequest.make({
		resourceSpans: [
			{
				resource: {
					attributes: [
						{key: 'service.name', value: {stringValue: service}},
						...Option.match(Option.fromUndefinedOr(options.runtime), {
							onNone: () => [],
							onSome: runtime => [{key: 'scope.runtime', value: {stringValue: runtime}}]
						}),
						...Option.match(Option.fromUndefinedOr(options.version), {
							onNone: () => [],
							onSome: version => [{key: 'service.version', value: {stringValue: version}}]
						})
					]
				},
				scopeSpans: [{spans}]
			}
		]
	})
}

function log(
	body: string,
	time: string,
	options: {attributes?: readonly AttributeInput[]; severityNumber?: number; spanId?: string; traceId?: string} = {}
) {
	return {
		body: {stringValue: body},
		...Option.match(Option.fromUndefinedOr(options.attributes), {
			onNone: () => ({}),
			onSome: attributes => ({attributes})
		}),
		...Option.match(Option.fromUndefinedOr(options.severityNumber), {
			onNone: () => ({}),
			onSome: severityNumber => ({severityNumber})
		}),
		...Option.match(Option.fromUndefinedOr(options.spanId), {onNone: () => ({}), onSome: spanId => ({spanId})}),
		timeUnixNano: time,
		...Option.match(Option.fromUndefinedOr(options.traceId), {onNone: () => ({}), onSome: traceId => ({traceId})})
	}
}

function logs(service: string, records: readonly ReturnType<typeof log>[], runtime?: string, version?: string) {
	return LogsRequest.make({
		resourceLogs: [
			{
				resource: {
					attributes: [
						{key: 'service.name', value: {stringValue: service}},
						...Option.match(Option.fromUndefinedOr(runtime), {
							onNone: () => [],
							onSome: value => [{key: 'scope.runtime', value: {stringValue: value}}]
						}),
						...Option.match(Option.fromUndefinedOr(version), {
							onNone: () => [],
							onSome: value => [{key: 'service.version', value: {stringValue: value}}]
						})
					]
				},
				scopeLogs: [{logRecords: records}]
			}
		]
	})
}

function loaded(directory: string) {
	return Effect.gen(function* () {
		const telemetry = Context.get(yield* Layer.build(Telemetry.layer(directory)), Telemetry)
		yield* telemetry.ready
		return telemetry
	})
}

function fresh() {
	return Effect.gen(function* () {
		return yield* loaded(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped())
	})
}

function pickTrace(answer: TracesAnswer) {
	return {
		total: answer.total,
		traces: Array.map(answer.traces, row => ({
			app: row.app,
			at: row.at,
			failure: row.failure,
			id: row.id,
			ms: row.ms,
			operation: row.operation,
			spans: row.spans
		}))
	}
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
			yield* telemetry.ready
			yield* TestClock.adjust('2 seconds')
			yield* telemetry.ingestTraces(release('0.1.1', 'a'))
			const idle = yield* Ref.get(reads)
			yield* TestClock.adjust('2 seconds')
			assert.strictEqual(yield* Ref.get(reads), idle)
			const pushed = yield* Queue.unbounded<Overview>()
			const first = yield* Effect.forkScoped(
				Stream.runForEach(telemetry.overview('3d'), value => Queue.offer(pushed, value))
			)
			const second = yield* Effect.forkScoped(
				Stream.runForEach(telemetry.overview('3d'), value => Queue.offer(pushed, value))
			)
			assert.deepStrictEqual(yield* Queue.take(pushed), yield* Queue.take(pushed))
			assert.strictEqual(yield* Ref.get(reads), idle + 1)
			yield* telemetry.ingestTraces(release('0.1.1', 'b'))
			yield* TestClock.adjust('2 seconds')
			assert.deepStrictEqual(yield* Queue.take(pushed), yield* Queue.take(pushed))
			yield* Fiber.interrupt(first)
			yield* Fiber.interrupt(second)
			yield* telemetry.ingestTraces(release('0.1.1', 'c'))
			const closed = yield* Ref.get(reads)
			yield* TestClock.adjust('2 seconds')
			assert.strictEqual(yield* Ref.get(reads), closed)
			assert.strictEqual(
				Option.getOrThrow(yield* Stream.runHead(telemetry.overview('3d'))).apps[0]?.operations[0]?.count,
				3
			)
		})
	)

	test.effect(
		'answers before stored entries load, keeps an ingest made meanwhile and shows both afterwards',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			yield* TestClock.setTime(NOW)
			const entries = Array.makeBy(32, stored)
			const memory = Context.get(yield* Layer.build(KeyValueStore.layerMemory), KeyValueStore.KeyValueStore)
			const store = KeyValueStore.toSchemaStore(memory, Entry)
			yield* Effect.forEach(
				entries,
				entry =>
					Effect.andThen(
						store.set(entry.id, entry),
						fs.writeFileString(`${directory}/${encodeURIComponent(entry.id)}`, '')
					),
				{concurrency: 1}
			)
			const gate = yield* Deferred.make<void>()
			const firstGet = yield* Deferred.make<void>()
			const slow = Layer.succeed(KeyValueStore.KeyValueStore, {
				...memory,
				get: key =>
					Effect.andThen(Deferred.succeed(firstGet, undefined), Effect.andThen(Deferred.await(gate), memory.get(key)))
			})
			const telemetry = Context.get(
				yield* Layer.build(pipe(Layer.effect(Telemetry, Telemetry.make(directory)), Layer.provide(slow))),
				Telemetry
			)
			yield* Deferred.await(firstGet)
			yield* telemetry.ingestTraces(
				request(
					'@deslop/live-server',
					[
						span({
							end: `${BigInt(START) + 1_000_000n}`,
							name: 'live.op',
							spanId: 'ffffffffffffffff',
							start: START,
							traceId: String.repeat(32)('f')
						})
					],
					{runtime: 'server'}
				)
			)
			assert.deepStrictEqual(
				Array.map((yield* telemetry.checkIngestion()).services, service => service.app),
				['live']
			)
			yield* Deferred.succeed(gate, undefined)
			const frame = yield* pipe(
				telemetry.overview('3d'),
				Stream.filter(current => current.apps.length === 2),
				Stream.runHead,
				Effect.forkChild
			)
			yield* TestClock.adjust('2 seconds')
			assert.deepStrictEqual(
				Array.map(
					Array.sort(
						Option.getOrThrow(yield* Fiber.join(frame)).apps,
						Order.mapInput(Order.String, (app: Overview['apps'][number]) => app.name)
					),
					app => [app.name, app.operations[0]?.name, app.operations[0]?.count]
				),
				[
					['live', 'live.op', 1],
					['stored', 'stored.op', 32]
				]
			)
		})
	)

	test.effect(
		'retains by receipt time without changing future client timestamps',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			yield* TestClock.setTime(NOW)
			yield* Effect.scoped(
				Effect.gen(function* () {
					const telemetry = yield* loaded(directory)
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
					assert.strictEqual(trace.spans[0]?.receivedAt, NOW)
					assert.strictEqual(trace.spans[0]?.payload['startTimeUnixNano'], '99999999999999999999')
					assert.strictEqual(trace.logs[0]?.time, '99999999999999999999')
				})
			)
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
					const telemetry = yield* loaded(directory)
					assert.strictEqual((yield* telemetry.trace(TRACE_ID)).spans[0]?.receivedAt, NOW)
				})
			)
			yield* TestClock.adjust('4 days')
			const telemetry = yield* loaded(directory)
			assert.isTrue(Exit.isFailure(yield* Effect.exit(telemetry.trace(TRACE_ID))))
			assert.isEmpty(yield* fs.readDirectory(directory))
		})
	)

	test.effect(
		'keeps ingested spans across restarts for three days, past a broken entry file',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			yield* TestClock.setTime(NOW)
			yield* Effect.scoped(
				Effect.gen(function* () {
					const telemetry = yield* loaded(directory)
					yield* telemetry.ingestTraces({
						resourceSpans: [
							{
								scopeSpans: [
									{
										spans: [
											{name: 'persisted', spanId: '1111111111111111', startTimeUnixNano: START, traceId: TRACE_ID}
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
					const telemetry = yield* loaded(directory)
					assert.strictEqual((yield* telemetry.trace(TRACE_ID)).spans[0]?.name, 'persisted')
				})
			)
			assert.isFalse(yield* fs.exists(`${directory}/broken`))
			yield* TestClock.adjust('2 days')
			const telemetry = yield* loaded(directory)
			assert.isTrue(Exit.isFailure(yield* Effect.exit(telemetry.trace(TRACE_ID))))
		})
	)

	test.effect(
		'keeps a trace while a versioned entry is current or an unversioned sibling is present',
		Effect.fnUntraced(function* () {
			yield* TestClock.setTime(NOW)
			const telemetry = yield* fresh()
			const stale = String.repeat(32)('a')
			const old = String.repeat(32)('b')
			const ios = String.repeat(32)('c')
			const current = String.repeat(32)('d')
			const free = String.repeat(32)('e')
			const late = String.repeat(32)('f')
			yield* telemetry.ingestTraces(
				TracesRequest.make({
					resourceSpans: [
						versioned('@deslop/trips-client', '0.1.1', [
							span({name: 'trips.watch', spanId: '1111111111111111', start: START, traceId: stale})
						]),
						versioned('@deslop/trips-server', '0.1.2', [
							span({name: 'trips.list', spanId: '2222222222222222', start: START, traceId: stale})
						]),
						versioned('@deslop/trips-client', '0.1.1', [
							span({name: 'trips.watch', spanId: '3333333333333333', start: START, traceId: old})
						]),
						versioned('@deslop/trips-server', '0.1.1', [
							span({name: 'trips.list', spanId: '4444444444444444', start: START, traceId: old})
						]),
						versioned('@deslop/trips-ios', '0.1.2', [
							span({name: 'Trips.refresh', spanId: '5555555555555555', start: START, traceId: ios})
						]),
						versioned('@deslop/trips-server', '0.1.1', [
							span({name: 'trips.list', spanId: '6666666666666666', start: START, traceId: ios})
						]),
						versioned('@deslop/trips-client', '0.1.1', [
							span({name: 'trips.watch', spanId: '7777777777777777', start: START, traceId: free})
						]),
						versioned('@deslop/trips-server', '', [
							span({name: 'trips.list', spanId: '8888888888888888', start: START, traceId: free})
						]),
						versioned('@deslop/trips-client', '0.1.2', [
							span({name: 'trips.watch', spanId: '9999999999999999', start: START, traceId: current})
						]),
						versioned('@deslop/trips-server', '0.1.2', [
							span({name: 'trips.list', spanId: 'aaaaaaaaaaaaaaa1', start: START, traceId: current})
						])
					]
				})
			)
			// An old client tab keeps the new server's half, and an unversioned sibling keeps the trace whole.
			assert.strictEqual((yield* telemetry.trace(stale)).spans.length, 2)
			assert.strictEqual((yield* telemetry.trace(ios)).spans.length, 2)
			assert.strictEqual((yield* telemetry.trace(free)).spans.length, 2)
			assert.isTrue(Exit.isFailure(yield* Effect.exit(telemetry.trace(old))))
			assert.sameMembers(
				Array.map(
					(yield* telemetry.findTraces({errors: false, limit: 20, since: '3d', sort: 'recent'})).traces,
					row => row.id
				),
				[stale, ios, free, current]
			)
			// An incoming stale client span joins its kept trace; a trace whose versioned entries are all old is dropped.
			yield* telemetry.ingestTraces(
				TracesRequest.make({
					resourceSpans: [
						versioned('@deslop/trips-client', '0.1.1', [
							span({name: 'trips.watch', spanId: 'bbbbbbbbbbbbbbbb', start: START, traceId: stale})
						]),
						versioned('@deslop/trips-client', '0.1.1', [
							span({name: 'trips.watch', spanId: 'cccccccccccccccc', start: START, traceId: late})
						]),
						versioned('@deslop/trips-server', '0.1.1', [
							span({name: 'trips.list', spanId: 'dddddddddddddddd', start: START, traceId: late})
						])
					]
				})
			)
			assert.strictEqual((yield* telemetry.trace(stale)).spans.length, 3)
			assert.isTrue(Exit.isFailure(yield* Effect.exit(telemetry.trace(late))))
		})
	)

	test.effect(
		'keeps subscriptions inspectable without counting their connection lifetimes as operations',
		Effect.fnUntraced(function* () {
			yield* TestClock.setTime(NOW)
			const telemetry = yield* fresh()
			yield* telemetry.ingestTraces(
				TracesRequest.make({
					resourceSpans: [
						{
							scopeSpans: [
								{
									spans: Array.flatMap(
										['stream', 'mcp', 'nested', 'action', 'client', 'client-kind'],
										(name, index) => {
											const traceId = `${index}${String.repeat(31)('a')}`
											const root = {name, spanId: '1111111111111111', startTimeUnixNano: START, traceId}
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
											if (name === 'client-kind') {
												return [{...root, attributes: stream.attributes, kind: 3}]
											}
											if (name === 'nested') return [root, stream]
											return [root]
										}
									)
								}
							]
						}
					]
				})
			)
			yield* TestClock.adjust('2 seconds')
			assert.sameMembers(
				Array.flatMap(Option.getOrThrow(yield* Stream.runHead(telemetry.overview('3d'))).apps, app =>
					Array.map(app.operations, operation => operation.name)
				),
				['nested', 'action']
			)
			assert.strictEqual((yield* telemetry.trace(`0${String.repeat(31)('a')}`)).spans.length, 1)
			assert.strictEqual(
				(yield* telemetry.findTraces({errors: false, limit: 20, since: '3d', sort: 'recent'})).total,
				2
			)
			assert.strictEqual((yield* telemetry.measureLatency({name: 'stream', since: '3d'})).count, 0)
			assert.strictEqual((yield* telemetry.measureLatency({name: 'action', since: '3d'})).count, 1)
		})
	)

	test.effect(
		'names machine steps by their source and treats a timer as a wait, not an operation',
		Effect.fnUntraced(function* () {
			yield* TestClock.setTime(NOW)
			const telemetry = yield* fresh()
			const source = String.repeat(32)('d')
			const timer = String.repeat(32)('e')
			const effect = String.repeat(32)('f')
			yield* telemetry.ingestTraces(
				request('@deslop/trips-ios', [
					span({
						attributes: [{key: 'machine.invoke.source', value: {stringValue: 'read'}}],
						name: 'Machine.invoke',
						spanId: '1111111111111111',
						start: START,
						traceId: source
					}),
					span({
						attributes: [{key: 'machine.invoke.kind', value: {stringValue: 'Timer'}}],
						name: 'Machine.invoke',
						spanId: '2222222222222222',
						start: START,
						traceId: timer
					}),
					span({
						attributes: [{key: 'machine.invoke.kind', value: {stringValue: 'Effect'}}],
						name: 'Machine.invoke',
						spanId: '3333333333333333',
						start: START,
						traceId: effect
					})
				])
			)
			yield* TestClock.adjust('2 seconds')
			assert.sameMembers(
				Array.flatMap(Option.getOrThrow(yield* Stream.runHead(telemetry.overview('3d'))).apps, app =>
					Array.map(app.operations, operation => operation.name)
				),
				['Machine.invoke read', 'Machine.invoke']
			)
			assert.strictEqual((yield* telemetry.trace(source)).spans[0]?.name, 'Machine.invoke read')
			assert.strictEqual(
				(yield* telemetry.findTraces({errors: false, limit: 20, since: '3d', sort: 'recent'})).total,
				2
			)
			assert.strictEqual((yield* telemetry.measureLatency({name: 'Machine.invoke', since: '3d'})).count, 1)
		})
	)

	test.effect(
		'keeps only each service’s newest release, across restarts, and never drops a local build’s entries',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			yield* TestClock.setTime(NOW + 10_000)
			yield* Effect.scoped(
				Effect.gen(function* () {
					const telemetry = yield* loaded(directory)
					yield* telemetry.ingestTraces(release('0.1.999', 'a'))
					yield* telemetry.ingestLogs(
						logs('@deslop/stash-server', [log('old release log', START)], undefined, '0.1.999')
					)
					yield* telemetry.ingestTraces(release('', 'b'))
					yield* telemetry.ingestTraces(release('0.1.998', 'c'))
					assert.deepStrictEqual(yield* kept(telemetry), ['a', 'b'])
					assert.strictEqual((yield* telemetry.searchLogs({limit: 10, since: '3d', text: 'old release log'})).total, 1)
					// Parts compare as numbers: 0.1.1000 is newer than 0.1.999, whose trace and log go; the local build's stays.
					yield* telemetry.ingestTraces(release('0.1.1000', 'd'))
					assert.deepStrictEqual(yield* kept(telemetry), ['b', 'd'])
					assert.strictEqual((yield* telemetry.searchLogs({limit: 10, since: '3d', text: 'old release log'})).total, 0)
					assert.containsSubset((yield* telemetry.checkIngestion()).services, [{release: '0.1.1000'}])
					// OTel's version is free text: one that isn't dot-separated numbers, such as a commit, has no order and is kept.
					yield* telemetry.ingestTraces(release('a3f9c21', 'e'))
					assert.deepStrictEqual(yield* kept(telemetry), ['b', 'd', 'e'])
					yield* TestClock.adjust('2 seconds')
					assert.strictEqual(Option.getOrThrow(yield* Stream.runHead(telemetry.overview('3d'))).apps.length, 1)
				})
			)
			assert.deepStrictEqual(yield* kept(yield* loaded(directory)), ['b', 'd', 'e'])
			assert.deepStrictEqual(Array.sort(yield* fs.readDirectory(directory), Order.String), [
				'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb%3Abbbbbbbbbbbbbbbb',
				'dddddddddddddddddddddddddddddddd%3Adddddddddddddddd',
				'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee%3Aeeeeeeeeeeeeeeee'
			])
		})
	)

	test.effect(
		'reports rejected exports by credential presence without inventing service attribution',
		Effect.fnUntraced(function* () {
			yield* TestClock.setTime(NOW)
			const telemetry = yield* fresh()
			yield* telemetry.reject({credential: 'authorization', route: '/v1/traces', status: 401})
			yield* telemetry.reject({credential: 'authorization', route: '/v1/traces', status: 401})
			yield* telemetry.reject({credential: 'none', route: '/v1/traces', status: 401})
			yield* telemetry.reject({credential: 'cookie', route: '/v1/logs', status: 503})
			assert.containsSubset((yield* telemetry.checkIngestion()).rejections, [
				{count: 2, credential: 'authorization', route: '/v1/traces', status: 401},
				{count: 1, credential: 'none', route: '/v1/traces', status: 401},
				{count: 1, credential: 'cookie', route: '/v1/logs', status: 503}
			])
		})
	)

	test.effect(
		'assembles late parents, replaces repeated spans and preserves exact OTLP data',
		Effect.fnUntraced(function* () {
			yield* TestClock.setTime(NOW)
			const telemetry = yield* fresh()
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
										endTimeUnixNano: `${BigInt(START) + 1_500_001n}`,
										name: 'child',
										parentSpanId: '1111111111111111',
										spanId: '2222222222222222',
										startTimeUnixNano: `${BigInt(START) + 1_000_000n}`,
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
											endTimeUnixNano: `${BigInt(START) + 2_000_000n}`,
											name: 'root',
											spanId: '1111111111111111',
											startTimeUnixNano: START,
											traceId: TRACE_ID
										}
									]
								}
							]
						}
					]
				})
			)
			const trace = yield* telemetry.trace(TRACE_ID)
			assert.strictEqual(trace.spans.length, 2)
			assert.strictEqual(trace.failureSpanId, '2222222222222222')
			assert.deepStrictEqual(
				Array.map(trace.spans, entry => entry.name),
				['root', 'child']
			)
			assert.containsSubset(trace.spans, [
				{
					payload: {
						attributes: [{key: 'big', value: {intValue: '9007199254740993'}}],
						endTimeUnixNano: `${BigInt(START) + 1_500_001n}`
					}
				}
			])
			assert.strictEqual((yield* telemetry.readTrace({id: TRACE_ID, limit: 1000})).spans.length, 2)
			assert.deepStrictEqual(
				pickTrace(yield* telemetry.findTraces({errors: false, limit: 10, since: '3d', sort: 'recent'})),
				{
					total: 1,
					traces: [
						{
							app: 'ordering',
							at: DateTime.formatIso(DateTime.makeUnsafe(NOW)),
							failure: 'child',
							id: TRACE_ID,
							ms: 2,
							operation: 'root',
							spans: 2
						}
					]
				}
			)
			assert.deepStrictEqual(yield* telemetry.measureLatency({name: 'child', since: '3d'}), {
				count: 1,
				failures: 1,
				maxMs: 0.5,
				p50Ms: 0.5,
				p95Ms: 0.5
			})
		})
	)

	test.effect(
		'keeps standalone logs searchable and correlates logs without requiring a stored span',
		Effect.fnUntraced(function* () {
			yield* TestClock.setTime(NOW)
			const telemetry = yield* fresh()
			yield* telemetry.ingestLogs(
				logs('logging', [
					log('standalone', `${BigInt(START) + 1_000_000n}`),
					log('bytes AAE=', `${BigInt(START) + 2_000_000n}`, {
						severityNumber: 17,
						traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
					})
				])
			)
			assert.strictEqual((yield* telemetry.searchLogs({limit: 100, since: '3d'})).total, 2)
			assert.strictEqual((yield* telemetry.searchLogs({level: 'error', limit: 100, since: '3d'})).total, 1)
			assert.strictEqual(
				(yield* telemetry.searchLogs({limit: 100, since: '3d', text: 'standalone'})).logs[0]?.trace,
				undefined
			)
			// Text searches what the entry says, not its ids: an array or key-value body reads as its words.
			assert.strictEqual((yield* telemetry.searchLogs({limit: 100, since: '3d', text: 'BYTES aae='})).total, 1)
			assert.strictEqual((yield* telemetry.searchLogs({limit: 100, since: '3d', text: 'aaaaaaaa'})).total, 0)
			yield* telemetry.ingestTraces(
				request('logging', [
					span({
						end: `${BigInt(START) + 2_000_000n}`,
						name: 'request',
						spanId: '1111111111111111',
						start: `${BigInt(START) + 2_000_000n}`,
						traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
					})
				])
			)
			yield* telemetry.ingestLogs(
				logs('logging', [
					log('attached', `${BigInt(START) + 3_000_000n}`, {
						spanId: '1111111111111111',
						traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
					})
				])
			)
			const trace = yield* telemetry.trace('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
			assert.strictEqual(
				(yield* telemetry.findTraces({errors: false, limit: 10, since: '3d', sort: 'recent'})).total,
				1
			)
			assert.deepStrictEqual(
				Array.map(trace.spans, entry => Array.map(entry.logs, logEntry => logEntry.name)),
				[['attached']]
			)
			assert.strictEqual(trace.logs.length, 1)
		})
	)

	test.effect(
		'denials are not failures in the overview, trace view, errors filter or latency',
		Effect.fnUntraced(function* () {
			yield* TestClock.setTime(NOW)
			const telemetry = yield* fresh()
			yield* telemetry.ingestTraces(
				request('@deslop/auth-server', [
					span({
						attributes: [{key: 'http.response.status_code', value: {intValue: 401}}],
						name: 'denied.http',
						spanId: '1111111111111111',
						start: START,
						status: {code: 2, message: 'Sign in first'},
						traceId: String.repeat(32)('1')
					}),
					span({
						attributes: [{key: 'http.response.status_code', value: {intValue: 403}}],
						name: 'denied.forbidden',
						spanId: '1111111111111111',
						start: START,
						status: {code: 2, message: 'Forbidden'},
						traceId: String.repeat(32)('2')
					}),
					span({
						events: denial('AuthError'),
						name: 'denied.auth',
						spanId: '1111111111111111',
						start: START,
						status: {code: 2, message: 'Sign in first'},
						traceId: String.repeat(32)('3')
					}),
					span({
						events: denial('AuthUnavailable'),
						name: 'outage',
						spanId: '1111111111111111',
						start: START,
						status: {code: 2, message: 'Auth is down'},
						traceId: String.repeat(32)('4')
					}),
					span({
						end: `${BigInt(START) + 10_000_000n}`,
						name: 'fault',
						spanId: '1111111111111111',
						start: START,
						status: {code: 2, message: 'Boom'},
						traceId: String.repeat(32)('5')
					})
				])
			)
			yield* TestClock.adjust('2 seconds')
			assert.sameDeepMembers(
				Array.flatMap(Option.getOrThrow(yield* Stream.runHead(telemetry.overview('3d'))).apps, app =>
					Array.map(app.operations, operation => [operation.name, operation.failures])
				),
				[
					['denied.http', 0],
					['denied.forbidden', 0],
					['denied.auth', 0],
					['outage', 1],
					['fault', 1]
				]
			)
			assert.deepStrictEqual(
				Array.map(
					(yield* telemetry.findTraces({errors: true, limit: 10, since: '3d', sort: 'recent'})).traces,
					row => row.operation
				),
				['fault', 'outage']
			)
			const denied = yield* telemetry.readTrace({id: String.repeat(32)('3'), limit: 100})
			assert.strictEqual(denied.failure, undefined)
			assert.strictEqual(denied.spans[0]?.denied, true)
			assert.strictEqual(denied.spans[0]?.error, undefined)
			assert.strictEqual((yield* telemetry.trace(String.repeat(32)('3'))).failureSpanId, undefined)
			assert.strictEqual((yield* telemetry.measureLatency({name: 'denied.auth', since: '3d'})).failures, 0)
			assert.strictEqual((yield* telemetry.measureLatency({name: 'outage', since: '3d'})).failures, 1)
			assert.deepStrictEqual(
				Array.map(
					(yield* telemetry.findTraces({errors: true, limit: 10, since: '3d', sort: 'recent'})).traces,
					row => row.failure
				),
				['fault: Boom', 'outage: Sign in first']
			)
		})
	)

	test.effect(
		'derives denial on load from the previous release’s stored entries',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			yield* TestClock.setTime(NOW)
			yield* Effect.scoped(
				Effect.gen(function* () {
					const telemetry = yield* loaded(directory)
					yield* telemetry.ingestTraces(
						request('@deslop/auth-server', [
							span({
								attributes: [{key: 'http.response.status_code', value: {intValue: 401}}],
								name: 'denied.http',
								spanId: '1111111111111111',
								start: START,
								status: {code: 2, message: 'Sign in first'},
								traceId: TRACE_ID
							})
						])
					)
				})
			)
			for (const file of yield* fs.readDirectory(directory)) {
				yield* pipe(
					fs.readFileString(`${directory}/${file}`),
					Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Entry))),
					Effect.map(Struct.omit(['denied'])),
					Effect.flatMap(Schema.encodeEffect(Schema.fromJsonString(Entry))),
					Effect.flatMap(value => fs.writeFileString(`${directory}/${file}`, value))
				)
			}
			yield* Effect.scoped(
				Effect.gen(function* () {
					const telemetry = yield* loaded(directory)
					assert.strictEqual((yield* telemetry.readTrace({id: TRACE_ID, limit: 100})).spans[0]?.denied, true)
					yield* TestClock.adjust('2 seconds')
					assert.strictEqual(
						Option.getOrThrow(yield* Stream.runHead(telemetry.overview('3d'))).apps[0]?.operations[0]?.failures,
						0
					)
				})
			)
		})
	)

	test.effect(
		'groups traces by app and operation, naming the span that broke',
		Effect.fnUntraced(function* () {
			yield* TestClock.setTime(NOW)
			const telemetry = yield* fresh()
			yield* telemetry.ingestTraces(
				request('@deslop/stash-server', [
					span({
						end: `${BigInt(START) + 100_000_000n}`,
						name: 'share',
						spanId: '1111111111111111',
						start: START,
						status: {code: 2, message: 'upstream returned 502'},
						traceId: String.repeat(32)('d')
					}),
					span({
						end: `${BigInt(START) + 50_000_000n}`,
						name: 'http.get',
						parent: '1111111111111111',
						spanId: '2222222222222222',
						start: `${BigInt(START) + 10_000_000n}`,
						status: {code: 2, message: 'upstream returned 502'},
						traceId: String.repeat(32)('d')
					}),
					span({
						end: `${BigInt(START) + 1_020_000_000n}`,
						name: 'share',
						spanId: '3333333333333333',
						start: `${BigInt(START) + 1_000_000_000n}`,
						traceId: String.repeat(32)('e')
					}),
					span({
						end: `${BigInt(START) + 2_005_000_000n}`,
						name: 'http.get',
						parent: '9999999999999999',
						spanId: '5555555555555555',
						start: `${BigInt(START) + 2_001_000_000n}`,
						traceId: String.repeat(32)('9')
					}),
					span({
						end: `${BigInt(START) + 2_010_000_000n}`,
						name: 'list',
						spanId: '4444444444444444',
						start: `${BigInt(START) + 2_000_000_000n}`,
						traceId: String.repeat(32)('f')
					}),
					span({
						attributes: [
							{key: 'http.request.method', value: {stringValue: 'POST'}},
							{key: 'http.route', value: {stringValue: '/api/notes'}},
							{key: 'url.path', value: {stringValue: '/api/notes'}}
						],
						end: `${BigInt(START) + 3_010_000_000n}`,
						kind: 2,
						name: 'POST',
						spanId: '6666666666666666',
						start: `${BigInt(START) + 3_000_000_000n}`,
						traceId: String.repeat(32)('6')
					}),
					span({
						attributes: [
							{key: 'http.request.method', value: {stringValue: 'POST'}},
							{key: 'url.path', value: {stringValue: '/api/apps'}}
						],
						end: `${BigInt(START) + 3_010_000_000n}`,
						kind: 3,
						name: 'POST',
						spanId: '8888888888888888',
						start: `${BigInt(START) + 3_000_000_000n}`,
						traceId: String.repeat(32)('8')
					}),
					...Array.map(['/.env', '/wp-login.php'], (path, index) => ({
						attributes: [
							{key: 'http.request.method', value: {stringValue: 'GET'}},
							{key: 'url.path', value: {stringValue: path}}
						],
						endTimeUnixNano: `${BigInt(START) + 3_010_000_000n}`,
						kind: 2,
						name: 'GET',
						spanId: `a${index}aaaaaaaaaaaaaa`,
						startTimeUnixNano: `${BigInt(START) + 3_000_000_000n}`,
						traceId: `a${index}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`
					}))
				])
			)
			yield* telemetry.ingestTraces(
				request(
					'@deslop/stash-client',
					[
						span({
							end: `${BigInt(START) + 4_010_000_000n}`,
							name: 'notes.watch',
							spanId: '7777777777777777',
							start: `${BigInt(START) + 4_000_000_000n}`,
							traceId: String.repeat(32)('7')
						})
					],
					{runtime: 'web'}
				)
			)
			yield* TestClock.adjust('2 seconds')
			const apps = Option.getOrThrow(yield* Stream.runHead(telemetry.overview('3d'))).apps
			assert.deepStrictEqual(
				Array.map(apps, app => app.name),
				['stash']
			)
			const stash = Option.getOrThrow(Array.head(apps))
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
			assert.deepStrictEqual(
				Array.map(
					Option.getOrThrow(Array.findFirst(stash.operations, operation => operation.name === 'share')).traces,
					trace => [trace.id, trace.failure]
				),
				[
					[String.repeat(32)('d'), {error: 'upstream returned 502', span: 'http.get'}],
					[String.repeat(32)('e'), undefined]
				]
			)
		})
	)
})

it.layer(platform)(test => {
	test.effect(
		'list_operations answers the page’s order with the compact operation shape',
		Effect.fnUntraced(function* () {
			yield* TestClock.setTime(NOW)
			const telemetry = yield* fresh()
			const first = String.repeat(32)('1')
			const second = String.repeat(32)('2')
			const third = String.repeat(32)('3')
			const watch = String.repeat(32)('4')
			const deploy = String.repeat(32)('5')
			yield* telemetry.ingestTraces(
				request(
					'@deslop/trips-server',
					[
						span({
							end: `${BigInt(START) + 10_000_000n}`,
							name: 'GET /api/trips',
							spanId: '1111111111111111',
							start: START,
							status: {code: 2, message: 'boom'},
							traceId: first
						}),
						span({
							end: `${BigInt(START) + 21_000_000n}`,
							name: 'GET /api/trips',
							spanId: '2222222222222222',
							start: `${BigInt(START) + 1_000_000n}`,
							traceId: second
						}),
						span({
							end: `${BigInt(START) + 32_000_000n}`,
							name: 'GET /api/trips',
							spanId: '3333333333333333',
							start: `${BigInt(START) + 2_000_000n}`,
							traceId: third
						})
					],
					{runtime: 'server'}
				)
			)
			yield* telemetry.ingestTraces(
				request(
					'@deslop/trips-client',
					[
						span({
							end: `${BigInt(START) + 43_000_000n}`,
							name: 'trips.watch',
							spanId: '4444444444444444',
							start: `${BigInt(START) + 3_000_000n}`,
							traceId: watch
						})
					],
					{runtime: 'web'}
				)
			)
			yield* telemetry.ingestTraces(
				request(
					'@deslop/deploy-server',
					[
						span({
							end: `${BigInt(START) + 9_000_000n}`,
							name: 'deploy.run',
							spanId: '5555555555555555',
							start: `${BigInt(START) + 4_000_000n}`,
							traceId: deploy
						})
					],
					{runtime: 'server'}
				)
			)
			const answer = yield* telemetry.listOperations({since: '3d'})
			assert.deepStrictEqual(
				Array.map(answer.apps, app => app.app),
				['trips', 'deploy']
			)
			assert.deepStrictEqual(answer.apps[0]?.operations, [
				{
					failure: {error: 'boom', span: 'GET /api/trips', trace: first},
					failures: 1,
					name: 'GET /api/trips',
					p50Ms: 20,
					p95Ms: 30,
					runs: 3,
					side: 'server',
					slowest: third
				},
				{name: 'trips.watch', p50Ms: 40, p95Ms: 40, runs: 1, side: 'web', slowest: watch}
			])
			assert.deepStrictEqual((yield* telemetry.listOperations({app: 'deploy', since: '3d'})).apps, [
				{
					app: 'deploy',
					operations: [{name: 'deploy.run', p50Ms: 5, p95Ms: 5, runs: 1, side: 'server', slowest: deploy}]
				}
			])
		})
	)

	test.effect(
		'find_traces filters by app, operation, span, text and failure and answers one compact row each',
		Effect.fnUntraced(function* () {
			yield* TestClock.setTime(NOW)
			const telemetry = yield* fresh()
			const searched = String.repeat(32)('1')
			const created = String.repeat(32)('2')
			const cached = String.repeat(32)('3')
			yield* telemetry.ingestTraces(
				request(
					'@deslop/stash-server',
					[
						span({
							attributes: [{key: 'query', value: {stringValue: 'mittens'}}],
							end: `${BigInt(START) + 30_000_000n}`,
							name: 'notes.search',
							spanId: '1111111111111111',
							start: START,
							traceId: searched
						}),
						span({
							end: `${BigInt(START) + 12_000_000n}`,
							name: 'db.query',
							parent: '1111111111111111',
							spanId: '1111111111111112',
							start: `${BigInt(START) + 2_000_000n}`,
							status: {code: 2, message: 'timeout\nstack trace'},
							traceId: searched
						}),
						span({
							end: `${BigInt(START) + 35_000_000n}`,
							name: 'notes.create',
							spanId: '2222222222222222',
							start: `${BigInt(START) + 10_000_000n}`,
							traceId: created
						}),
						span({
							end: `${BigInt(START) + 60_000_000n}`,
							name: 'notes.search',
							spanId: '3333333333333333',
							start: `${BigInt(START) + 20_000_000n}`,
							traceId: cached
						})
					],
					{runtime: 'server'}
				)
			)
			yield* telemetry.ingestLogs(
				logs('logging', [
					log('cache warmed', `${BigInt(START) + 21_000_000n}`, {spanId: '3333333333333333', traceId: cached})
				])
			)
			const recent = yield* telemetry.findTraces({errors: false, limit: 10, since: '3d', sort: 'recent'})
			assert.strictEqual(recent.total, 3)
			assert.deepStrictEqual(
				Array.map(recent.traces, row => row.id),
				[cached, created, searched]
			)
			assert.deepStrictEqual(
				pickTrace({...recent, total: 1, traces: Array.filter(recent.traces, row => row.id === searched)}),
				{
					total: 1,
					traces: [
						{
							app: 'stash',
							at: DateTime.formatIso(DateTime.makeUnsafe(NOW)),
							failure: 'db.query: timeout',
							id: searched,
							ms: 30,
							operation: 'notes.search',
							spans: 2
						}
					]
				}
			)
			assert.deepStrictEqual(
				Array.map(
					(yield* telemetry.findTraces({errors: true, limit: 10, since: '3d', sort: 'recent'})).traces,
					row => row.failure
				),
				['db.query: timeout']
			)
			assert.strictEqual(
				(yield* telemetry.findTraces({
					errors: false,
					limit: 10,
					operation: 'notes.search',
					since: '3d',
					sort: 'recent'
				})).total,
				2
			)
			assert.deepStrictEqual(
				Array.map(
					(yield* telemetry.findTraces({errors: false, limit: 10, since: '3d', sort: 'recent', span: 'db.query'}))
						.traces,
					row => row.id
				),
				[searched]
			)
			assert.deepStrictEqual(
				Array.map(
					(yield* telemetry.findTraces({errors: false, limit: 10, since: '3d', sort: 'recent', text: 'mittens'}))
						.traces,
					row => row.id
				),
				[searched]
			)
			assert.deepStrictEqual(
				Array.map(
					(yield* telemetry.findTraces({errors: false, limit: 10, since: '3d', sort: 'recent', text: 'cache warmed'}))
						.traces,
					row => row.id
				),
				[cached]
			)
			assert.strictEqual(
				(yield* telemetry.findTraces({app: 'stash', errors: false, limit: 10, since: '3d', sort: 'recent'})).total,
				3
			)
			assert.strictEqual(
				(yield* telemetry.findTraces({app: 'other', errors: false, limit: 10, since: '3d', sort: 'recent'})).total,
				0
			)
			const slowest = yield* telemetry.findTraces({errors: false, limit: 1, since: '3d', sort: 'slowest'})
			assert.strictEqual(slowest.total, 3)
			assert.deepStrictEqual(
				Array.map(slowest.traces, row => row.id),
				[cached]
			)
			assert.match(slowest.traces[0]?.at ?? '', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
			assert.match(slowest.traces[0]?.id ?? '', /^[a-f0-9]{32}$/u)
			assert.deepStrictEqual(slowest.traces[0], {
				app: 'stash',
				at: DateTime.formatIso(DateTime.makeUnsafe(NOW + 20)),
				id: cached,
				ms: 40,
				operation: 'notes.search',
				side: 'server',
				spans: 1
			})
		})
	)

	test.effect(
		'read_trace answers the tree compactly, trims over the limit and keeps the failure’s ancestors',
		Effect.fnUntraced(function* () {
			yield* TestClock.setTime(NOW)
			const telemetry = yield* fresh()
			const trace = String.repeat(32)('1')
			const deep = String.repeat(32)('2')
			yield* telemetry.ingestTraces(
				request(
					'@deslop/stash-server',
					[
						span({
							attributes: [
								{key: 'custom', value: {stringValue: 'keep'}},
								{key: 'http.route', value: {stringValue: '/x'}},
								{key: 'rpc.method', value: {stringValue: 'trace.root'}},
								{key: 'rpc.system.name', value: {stringValue: 'effect/rpc'}},
								{key: 'code.function', value: {stringValue: 'trace.root'}},
								{key: 'url.scheme', value: {stringValue: 'https'}},
								{key: 'server.port', value: {intValue: 3000}},
								{key: 'user_agent.original', value: {stringValue: 'agent'}}
							],
							end: `${BigInt(START) + 100_000_000n}`,
							name: 'trace.root',
							spanId: '1111111111111111',
							start: START,
							traceId: trace
						}),
						span({
							attributes: [{key: 'user_agent.original', value: {stringValue: 'agent'}}],
							end: `${BigInt(START) + 40_000_000n}`,
							name: 'db.query',
							parent: '1111111111111111',
							spanId: '2222222222222222',
							start: `${BigInt(START) + 10_000_000n}`,
							status: {code: 2, message: 'Boom\nstack trace'},
							traceId: trace
						}),
						span({
							end: `${BigInt(START) + 25_000_000n}`,
							name: 'parse',
							parent: '2222222222222222',
							spanId: '3333333333333333',
							start: `${BigInt(START) + 20_000_000n}`,
							traceId: trace
						})
					],
					{runtime: 'server'}
				)
			)
			yield* telemetry.ingestLogs(
				logs('stash-server', [
					log('log line', `${BigInt(START) + 15_000_000n}`, {
						severityNumber: 17,
						spanId: '2222222222222222',
						traceId: trace
					}),
					log('standalone line', `${BigInt(START) + 5_000_000n}`, {severityNumber: 13, traceId: trace})
				])
			)
			assert.deepStrictEqual(yield* telemetry.readTrace({id: trace, limit: 100}), {
				at: DateTime.formatIso(DateTime.makeUnsafe(NOW)),
				failure: '2222222222222222',
				id: trace,
				logs: [{at: DateTime.formatIso(DateTime.makeUnsafe(NOW + 5)), level: 'warn', message: 'standalone line'}],
				ms: 100,
				spans: [
					{
						app: 'stash',
						at: 0,
						attrs: {custom: 'keep', 'http.route': '/x'},
						id: '1111111111111111',
						ms: 100,
						name: 'trace.root',
						side: 'server'
					},
					{
						app: 'stash',
						at: 10,
						attrs: {'user_agent.original': 'agent'},
						error: 'Boom',
						id: '2222222222222222',
						logs: [{at: DateTime.formatIso(DateTime.makeUnsafe(NOW + 15)), level: 'error', message: 'log line'}],
						ms: 30,
						name: 'db.query',
						parent: '1111111111111111',
						side: 'server'
					},
					{
						app: 'stash',
						at: 20,
						id: '3333333333333333',
						ms: 5,
						name: 'parse',
						parent: '2222222222222222',
						side: 'server'
					}
				]
			} satisfies ReadTraceAnswer)
			yield* telemetry.ingestTraces(
				request('@deslop/stash-server', [
					span({
						end: `${BigInt(START) + 100_000_000n}`,
						name: 'deep.root',
						spanId: 'aaaaaaaaaaaaaaaa',
						start: START,
						traceId: deep
					}),
					span({
						end: `${BigInt(START) + 90_000_000n}`,
						name: 'deep.mid',
						parent: 'aaaaaaaaaaaaaaaa',
						spanId: 'bbbbbbbbbbbbbbbb',
						start: `${BigInt(START) + 1_000_000n}`,
						traceId: deep
					}),
					span({
						end: `${BigInt(START) + 80_000_000n}`,
						name: 'deep.fail',
						parent: 'bbbbbbbbbbbbbbbb',
						spanId: 'cccccccccccccccc',
						start: `${BigInt(START) + 2_000_000n}`,
						status: {code: 2, message: 'deep boom'},
						traceId: deep
					}),
					...Array.map(Array.makeBy(4, Function.identity), index =>
						span({
							end: `${BigInt(START) + BigInt(70 - index * 10) * 1_000_000n}`,
							name: `deep.slow.${index}`,
							spanId: `dddddddddddddd${index}d`,
							start: `${BigInt(START) + BigInt(3 + index) * 1_000_000n}`,
							traceId: deep
						})
					)
				])
			)
			const trimmed = yield* telemetry.readTrace({id: deep, limit: 2})
			assert.deepStrictEqual(
				Array.map(trimmed.spans, current => current.name),
				['deep.root', 'deep.mid', 'deep.fail']
			)
			assert.strictEqual(trimmed.omitted, 4)
		})
	)

	test.effect(
		'a trace and the traces linked to it read as one tree from either end',
		Effect.fnUntraced(function* () {
			yield* TestClock.setTime(NOW)
			const telemetry = yield* fresh()
			const capture = String.repeat(32)('1')
			const organize = String.repeat(32)('2')
			yield* telemetry.ingestTraces(
				request('@deslop/stash-server', [
					span({
						end: `${BigInt(START) + 10_000_000n}`,
						name: 'POST /api/capture',
						spanId: '1111111111111111',
						start: START,
						traceId: capture
					}),
					span({
						end: `${BigInt(START) + 40_000_000n}`,
						links: [{spanId: '1111111111111111', traceId: capture}],
						name: 'Notes.organize',
						spanId: '2222222222222222',
						start: `${BigInt(START) + 5_000_000n}`,
						traceId: organize
					}),
					span({
						end: `${BigInt(START) + 30_000_000n}`,
						name: 'Notes.tag',
						parent: '2222222222222222',
						spanId: '3333333333333333',
						start: `${BigInt(START) + 10_000_000n}`,
						traceId: organize
					})
				])
			)
			const tree = [
				{at: 0, id: '1111111111111111', ms: 10, name: 'POST /api/capture'},
				{at: 5, id: '2222222222222222', ms: 35, name: 'Notes.organize', parent: '1111111111111111'},
				{at: 10, id: '3333333333333333', ms: 20, name: 'Notes.tag', parent: '2222222222222222'}
			]
			for (const id of [capture, organize]) {
				const answer = yield* telemetry.readTrace({id, limit: 100})
				assert.strictEqual(answer.ms, 40)
				assert.deepStrictEqual(
					Array.map(answer.spans, read => ({
						at: read.at,
						id: read.id,
						ms: read.ms,
						name: read.name,
						...Option.match(Option.fromUndefinedOr(read.parent), {onNone: () => ({}), onSome: parent => ({parent})})
					})),
					tree
				)
				assert.deepStrictEqual(
					Array.map((yield* telemetry.trace(id)).spans, view => view.depth),
					[0, 1, 2]
				)
			}
		})
	)

	test.effect(
		'search_logs filters by level, text, app and trace and answers newest first',
		Effect.fnUntraced(function* () {
			yield* TestClock.setTime(NOW)
			const telemetry = yield* fresh()
			const trace = String.repeat(32)('1')
			yield* telemetry.ingestLogs(
				logs(
					'stash-server',
					[
						log('disk full', `${BigInt(START) + 4_000_000n}`, {
							attributes: [{key: 'path', value: {stringValue: '/tmp'}}],
							severityNumber: 17,
							spanId: '1111111111111111',
							traceId: trace
						}),
						log('slow request', `${BigInt(START) + 3_000_000n}`, {severityNumber: 13}),
						log('started', `${BigInt(START) + 2_000_000n}`, {severityNumber: 9}),
						log('trace level', `${BigInt(START) + 1_000_000n}`, {severityNumber: 1})
					],
					'server'
				)
			)
			const answer = yield* telemetry.searchLogs({limit: 100, since: '3d'})
			assert.strictEqual(answer.total, 4)
			assert.deepStrictEqual(
				Array.map(answer.logs, row => row.level),
				['error', 'warn', 'info', 'trace']
			)
			assert.deepStrictEqual(answer.logs[0], {
				app: 'stash',
				at: DateTime.formatIso(DateTime.makeUnsafe(NOW + 4)),
				attrs: {path: '/tmp'},
				level: 'error',
				message: 'disk full',
				side: 'server',
				span: '1111111111111111',
				trace
			})
			assert.strictEqual((yield* telemetry.searchLogs({level: 'warn', limit: 100, since: '3d'})).total, 2)
			assert.strictEqual((yield* telemetry.searchLogs({level: 'error', limit: 100, since: '3d'})).total, 1)
			assert.strictEqual((yield* telemetry.searchLogs({limit: 100, since: '3d', text: 'disk'})).total, 1)
			assert.strictEqual((yield* telemetry.searchLogs({app: 'stash', limit: 100, since: '3d'})).total, 4)
			assert.strictEqual((yield* telemetry.searchLogs({app: 'other', limit: 100, since: '3d'})).total, 0)
			assert.strictEqual((yield* telemetry.searchLogs({limit: 100, since: '3d', trace})).total, 1)
			const limited = yield* telemetry.searchLogs({limit: 2, since: '3d'})
			assert.strictEqual(limited.total, 4)
			assert.deepStrictEqual(
				Array.map(limited.logs, row => row.message),
				['disk full', 'slow request']
			)
			assert.deepStrictEqual(limited.logs[1], {
				app: 'stash',
				at: DateTime.formatIso(DateTime.makeUnsafe(NOW + 3)),
				level: 'warn',
				message: 'slow request',
				side: 'server'
			})
		})
	)

	test.effect(
		'measure_latency measures one exact span name without counting denied sign-ins as failures',
		Effect.fnUntraced(function* () {
			yield* TestClock.setTime(NOW)
			const telemetry = yield* fresh()
			yield* telemetry.ingestTraces(
				request(
					'@deslop/trips-server',
					[
						span({
							end: `${BigInt(START) + 10_000_000n}`,
							name: 'job',
							spanId: '1111111111111111',
							start: START,
							traceId: String.repeat(32)('1')
						}),
						span({
							end: `${BigInt(START) + 31_000_000n}`,
							name: 'job',
							spanId: '2222222222222222',
							start: `${BigInt(START) + 1_000_000n}`,
							status: {code: 2, message: 'boom'},
							traceId: String.repeat(32)('2')
						}),
						span({
							end: `${BigInt(START) + 22_000_000n}`,
							name: 'job',
							spanId: '3333333333333333',
							start: `${BigInt(START) + 2_000_000n}`,
							traceId: String.repeat(32)('3')
						}),
						span({
							attributes: [{key: 'http.response.status_code', value: {intValue: 401}}],
							end: `${BigInt(START) + 53_000_000n}`,
							name: 'job',
							spanId: '4444444444444444',
							start: `${BigInt(START) + 3_000_000n}`,
							status: {code: 2, message: 'Sign in first'},
							traceId: String.repeat(32)('4')
						})
					],
					{runtime: 'server'}
				)
			)
			yield* telemetry.ingestTraces(
				request(
					'@deslop/gateway-server',
					[
						span({
							end: `${BigInt(START) + 64_000_000n}`,
							name: 'job',
							spanId: '5555555555555555',
							start: `${BigInt(START) + 4_000_000n}`,
							traceId: String.repeat(32)('5')
						})
					],
					{runtime: 'server'}
				)
			)
			assert.deepStrictEqual(yield* telemetry.measureLatency({name: 'job', since: '3d'}), {
				count: 5,
				failures: 1,
				maxMs: 60,
				p50Ms: 30,
				p95Ms: 60
			})
			assert.deepStrictEqual(yield* telemetry.measureLatency({app: 'trips', name: 'job', since: '3d'}), {
				count: 4,
				failures: 1,
				maxMs: 50,
				p50Ms: 20,
				p95Ms: 50
			})
			assert.deepStrictEqual(yield* telemetry.measureLatency({app: 'gateway', name: 'job', since: '3d'}), {
				count: 1,
				failures: 0,
				maxMs: 60,
				p50Ms: 60,
				p95Ms: 60
			})
			assert.strictEqual((yield* telemetry.measureLatency({name: 'missing', since: '3d'})).count, 0)
		})
	)

	test.effect(
		'check_ingestion names each service’s app, side, release and rejection compactly',
		Effect.fnUntraced(function* () {
			yield* TestClock.setTime(NOW)
			const telemetry = yield* fresh()
			yield* telemetry.ingestTraces(
				request(
					'@deslop/stash-server',
					[
						span({
							end: `${BigInt(START) + 10_000_000n}`,
							name: 'notes.list',
							spanId: '1111111111111111',
							start: START,
							traceId: String.repeat(32)('1')
						})
					],
					{runtime: 'server', version: '0.1.2'}
				)
			)
			yield* telemetry.ingestLogs(logs('@deslop/deploy-client', [log('deployed', `${BigInt(START) + 20_000_000n}`)]))
			yield* telemetry.reject({credential: 'authorization', route: '/v1/traces', status: 401})
			yield* telemetry.reject({credential: 'authorization', route: '/v1/traces', status: 401})
			yield* telemetry.reject({credential: 'none', route: '/v1/logs', status: 503})
			const answer = yield* telemetry.checkIngestion()
			assert.containsSubset(answer.services, [
				{
					app: 'stash',
					entries: 1,
					lastEvent: DateTime.formatIso(DateTime.makeUnsafe(NOW)),
					release: '0.1.2',
					runStarted: DateTime.formatIso(DateTime.makeUnsafe(0)),
					side: 'server'
				},
				{
					app: 'deploy',
					entries: 1,
					lastEvent: DateTime.formatIso(DateTime.makeUnsafe(NOW + 20)),
					runStarted: DateTime.formatIso(DateTime.makeUnsafe(0)),
					side: 'web'
				}
			])
			assert.containsSubset(answer.rejections, [
				{
					count: 2,
					credential: 'authorization',
					lastAt: DateTime.formatIso(DateTime.makeUnsafe(NOW)),
					route: '/v1/traces',
					status: 401
				},
				{
					count: 1,
					credential: 'none',
					lastAt: DateTime.formatIso(DateTime.makeUnsafe(NOW)),
					route: '/v1/logs',
					status: 503
				}
			])
			assert.isTrue(
				Option.isNone(
					Option.flatMap(
						Array.findFirst(answer.services, service => service.app === 'deploy'),
						service => Option.fromUndefinedOr(service.release)
					)
				)
			)
		})
	)

	test.effect(
		'a thousand failing spans answer read_trace and find_traces under 300 KB',
		Effect.fnUntraced(function* () {
			yield* TestClock.setTime(NOW)
			const telemetry = yield* fresh()
			const big = String.repeat(32)('a')
			const stack = String.repeat(4096)('s')
			function failing(name: string, traceId: string, spanId: string, start: string) {
				return span({
					attributes: [
						{key: 'http.route', value: {stringValue: '/api/big'}},
						{key: 'rpc.system.name', value: {stringValue: 'effect/rpc'}},
						{key: 'rpc.method', value: {stringValue: name}},
						{key: 'url.scheme', value: {stringValue: 'https'}},
						{key: 'server.port', value: {intValue: 3000}}
					],
					end: `${BigInt(start) + 1_000_000n}`,
					events: [
						{
							attributes: [
								{key: 'exception.type', value: {stringValue: 'BoundsError'}},
								{key: 'exception.message', value: {stringValue: 'boom'}},
								{key: 'exception.stacktrace', value: {stringValue: stack}}
							],
							name: 'exception',
							timeUnixNano: start
						}
					],
					name,
					spanId,
					start,
					status: {code: 2, message: 'boom'},
					traceId
				})
			}
			const bigSpans = Array.makeBy(1000, index =>
				failing(
					`big.span.${index}`,
					big,
					String.padStart(16, '0')((index + 1).toString(16)),
					`${BigInt(START) + BigInt(index) * 1_000_000n}`
				)
			)
			const otherSpans = Array.makeBy(999, index =>
				failing(
					`other.${index}`,
					String.padStart(32, '0')((index + 1000).toString(16)),
					'0000000000000001',
					`${BigInt(START) + BigInt(index) * 1_000_000n}`
				)
			)
			yield* telemetry.ingestTraces(request('@deslop/stash-server', [...bigSpans, ...otherSpans], {runtime: 'server'}))
			assert.strictEqual((yield* telemetry.checkIngestion()).services[0]?.entries, 1999)
			const read = yield* telemetry.readTrace({id: big, limit: 1000})
			const found = yield* telemetry.findTraces({errors: true, limit: 50, since: '3d', sort: 'recent'})
			assert.strictEqual(read.spans.length, 1000)
			assert.strictEqual(found.total, 1000)
			assert.isBelow((yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(read)).length, 300_000)
			assert.isBelow((yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(found)).length, 300_000)
		})
	)
})
