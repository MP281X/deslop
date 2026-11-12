import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {Array, Clock, ConfigProvider, Context, DateTime, Effect, Layer, Option, pipe, Schema, String} from 'effect'

import {Mac} from 'effect/crypto'
import {Hex} from 'effect/encoding'
import {HttpClient, HttpRouter} from 'effect/http'
import {Reactivity} from 'effect/reactivity'
import {SqlClient} from 'effect/sql'
import {TestClock} from 'effect/testing'

import {HttpHandlers} from '#http/handlers.ts'
import {runIds} from '#services/github/lib/utils.ts'
import type {WorkflowJob, WorkflowRun} from '#services/github/schema.ts'
import {Telemetry} from '#services/telemetry/service.ts'

const SECRET = 'webhook-secret'
const NOW = 1_781_870_000_000
const TRACE_ID = String.repeat(32)('a')

function iso(millis: number) {
	return DateTime.formatIso(DateTime.makeUnsafe(millis))
}

function runEvent(start: number, action: string) {
	return {
		action,
		repository: {full_name: 'MP281X/deslop'},
		workflow_run: {
			conclusion: 'success',
			display_title: 'CI',
			event: 'push',
			head_branch: 'main',
			head_sha: String.repeat(40)('a'),
			html_url: 'https://github.com/MP281X/deslop/actions/runs/42',
			id: 42,
			name: 'CI',
			run_attempt: 1,
			run_number: 7,
			run_started_at: iso(start),
			updated_at: iso(start + 4 * 60_000)
		}
	} satisfies WorkflowRun
}

function jobEvent(start: number, conclusion: string) {
	return {
		action: 'completed',
		repository: {full_name: 'MP281X/deslop'},
		workflow_job: {
			completed_at: iso(start + 2 * 60_000),
			conclusion,
			created_at: iso(start),
			html_url: 'https://github.com/MP281X/deslop/actions/runs/42/job/100',
			id: 100,
			name: 'build',
			run_attempt: 1,
			run_id: 42,
			runner_name: 'ubuntu-latest',
			started_at: iso(start + 60_000),
			steps: [
				{
					completed_at: iso(start + 2 * 60_000),
					conclusion,
					name: 'Run tests',
					number: 1,
					started_at: iso(start + 60_000)
				}
			]
		}
	} satisfies WorkflowJob
}

function otlp(start: number) {
	return Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))({
		resourceSpans: [
			{
				resource: {
					attributes: [
						{key: 'service.name', value: {stringValue: '@deslop/demo-server'}},
						{key: 'scope.runtime', value: {stringValue: 'server'}}
					]
				},
				scopeSpans: [
					{
						spans: [
							{
								endTimeUnixNano: `${BigInt(start + 1000) * 1_000_000n}`,
								name: 'demo.op',
								spanId: '1111111111111111',
								startTimeUnixNano: `${BigInt(start) * 1_000_000n}`,
								traceId: TRACE_ID
							}
						]
					}
				]
			}
		]
	})
}

// The GitHub API is read only for job logs, which need GITHUB_TOKEN; none of these tests configure it.
const github = HttpClient.make(() => Effect.die('The GitHub API must not be read without GITHUB_TOKEN'))

const serve = Effect.fnUntraced(function* (telemetry: Telemetry['Service']) {
	const mac = yield* Mac.Mac
	const web = yield* Effect.acquireRelease(
		Effect.sync(() =>
			HttpRouter.toWebHandler(
				pipe(
					HttpHandlers,
					Layer.provide(Layer.succeed(Telemetry, telemetry)),
					Layer.provide(Layer.succeed(Mac.Mac, mac)),
					Layer.provide(Layer.succeed(HttpClient.HttpClient, github)),
					Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({GITHUB_WEBHOOK_SECRET: SECRET})))
				),
				{disableLogger: true}
			)
		),
		handler => Effect.promise(() => handler.dispose())
	)
	return {key: yield* Mac.key(Mac.hmacSha256, new TextEncoder().encode(SECRET)), mac, web}
})

function send(web: Effect.Success<ReturnType<typeof serve>>['web'], path: string, init?: RequestInit) {
	return Effect.promise(() => web.handler(new Request(new URL(path, 'https://scope.mp281x.xyz'), init)))
}

const openTelemetry = Effect.fnUntraced(function* () {
	const database = yield* Layer.build(Layer.merge(SqliteClient.layer({filename: ':memory:'}), Reactivity.layer))
	const telemetry = Context.get(
		yield* Layer.build(pipe(Telemetry.layer, Layer.provide(Layer.succeedContext(database)))),
		Telemetry
	)
	return {database, telemetry}
})

// A database that still reads but refuses every write, as a full disk does.
const brokenTelemetry = Effect.fnUntraced(function* () {
	const opened = yield* openTelemetry()
	yield* Effect.provideContext(
		Effect.flatMap(SqlClient.SqlClient, sql => sql`PRAGMA query_only = ON`),
		opened.database
	)
	return opened.telemetry
})

it.layer(Layer.merge(NodeCrypto.layer, NodeServices.layer))('Scope HTTP routes', test => {
	test.effect('turns a signed workflow run and its job into one trace and ignores other events', () =>
		Effect.scoped(
			Effect.gen(function* () {
				yield* TestClock.setTime(NOW)
				const telemetry = (yield* openTelemetry()).telemetry
				const server = yield* serve(telemetry)
				const start = NOW - 5 * 60_000
				const signed = Effect.fnUntraced(function* (event: string, payload: unknown) {
					const body = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(payload)
					return yield* send(server.web, '/v1/github', {
						body,
						headers: {
							'content-type': 'application/json',
							'x-github-event': event,
							'x-hub-signature-256': `sha256=${Hex.encode(yield* server.mac.sign(server.key, new TextEncoder().encode(body)))}`
						},
						method: 'POST'
					})
				})
				const run = runEvent(start, 'completed')
				assert.strictEqual((yield* signed('workflow_run', run)).status, 204)
				const ids = runIds(run)
				assert.deepStrictEqual(
					Array.map((yield* telemetry.trace(ids.traceId)).spans, span => span.name),
					['CI']
				)
				assert.strictEqual((yield* signed('workflow_job', jobEvent(start, 'success'))).status, 204)
				const trace = yield* telemetry.trace(ids.traceId)
				assert.deepStrictEqual(
					Array.map(trace.spans, span => span.name),
					['CI', 'build', 'Run tests']
				)
				assert.deepStrictEqual(trace.spans[1]?.parentSpanId, Option.some(ids.spanId))
				assert.deepStrictEqual(trace.spans[2]?.parentSpanId, Option.fromUndefinedOr(trace.spans[1]?.spanId))
				// GitHub doesn't promise order: a start delivered after the run finished leaves it finished.
				assert.strictEqual((yield* signed('workflow_run', runEvent(start, 'in_progress'))).status, 204)
				assert.isTrue(Option.isSome(Option.getOrThrow(Array.head((yield* telemetry.trace(ids.traceId)).spans)).duration))
				for (const filtered of [
					{event: 'ping', payload: {zen: 'Keep it up'}},
					{event: 'workflow_job', payload: jobEvent(start, 'skipped')},
					{event: 'workflow_run', payload: runEvent(start, 'queued')}
				] satisfies {event: string; payload: unknown}[]) {
					assert.strictEqual((yield* signed(filtered.event, filtered.payload)).status, 204)
				}
				const found = yield* telemetry.findTraces({errors: false, limit: 10, since: '3d', sort: 'recent'})
				assert.strictEqual(found.total, 1)
				assert.strictEqual(found.traces[0]?.app, 'MP281X/deslop')
				assert.strictEqual(found.traces[0]?.operation, 'CI')
				assert.lengthOf((yield* telemetry.trace(ids.traceId)).spans, 3)
			})
		)
	)

	test.effect('refuses a wrong, malformed or stale webhook signature without storing its event', () =>
		Effect.scoped(
			Effect.gen(function* () {
				yield* TestClock.setTime(NOW)
				const telemetry = (yield* openTelemetry()).telemetry
				const server = yield* serve(telemetry)
				const body = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
					runEvent(NOW - 5 * 60_000, 'completed')
				)
				const headers = {'content-type': 'application/json', 'x-github-event': 'workflow_run'}
				function sign(bytes: Uint8Array) {
					return Effect.map(server.mac.sign(server.key, bytes), signature => `sha256=${Hex.encode(signature)}`)
				}
				for (const signature of [
					`sha256=${Hex.encode(yield* server.mac.sign(yield* Mac.key(Mac.hmacSha256, new TextEncoder().encode('another-secret')), new TextEncoder().encode(body)))}`,
					`sha256=${String.repeat(64)('g')}`,
					yield* sign(new TextEncoder().encode(`${body} `))
				]) {
					const response = yield* send(server.web, '/v1/github', {
						body,
						headers: {...headers, 'x-hub-signature-256': signature},
						method: 'POST'
					})
					assert.strictEqual(response.status, 401)
				}
				const malformed = yield* send(server.web, '/v1/github', {
					body: '{',
					headers: {...headers, 'x-hub-signature-256': yield* sign(new TextEncoder().encode('{'))},
					method: 'POST'
				})
				assert.strictEqual(malformed.status, 400)
				assert.strictEqual(
					(yield* telemetry.findTraces({errors: false, limit: 10, since: '3d', sort: 'recent'})).total,
					0
				)
			})
		)
	)

	test.effect('answers 415 to a non-JSON export, counts it, and ingests OTLP JSON', () =>
		Effect.scoped(
			Effect.gen(function* () {
				yield* TestClock.setTime(NOW)
				const telemetry = (yield* openTelemetry()).telemetry
				const server = yield* serve(telemetry)
				const refused = yield* send(server.web, '/v1/traces', {
					body: '{}',
					headers: {'content-type': 'text/plain'},
					method: 'POST'
				})
				assert.strictEqual(refused.status, 415)
				assert.containsSubset((yield* telemetry.checkIngestion()).rejections, [
					{count: 1, credential: 'none', route: '/v1/traces', status: 415}
				])
				const accepted = yield* send(server.web, '/v1/traces', {
					body: otlp(yield* Clock.currentTimeMillis),
					headers: {'content-type': 'application/json; charset=utf-8'},
					method: 'POST'
				})
				assert.strictEqual(accepted.status, 200)
				assert.strictEqual(yield* Effect.promise(() => accepted.text()), '{}')
				assert.deepStrictEqual(
					Array.map((yield* telemetry.trace(TRACE_ID)).spans, span => span.name),
					['demo.op']
				)
				assert.strictEqual(
					(yield* telemetry.findTraces({errors: false, limit: 10, since: '3d', sort: 'recent'})).traces[0]?.app,
					'demo'
				)
			})
		)
	)

	test.effect('answers 503 and counts the rejection when telemetry storage is unavailable', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const telemetry = yield* brokenTelemetry()
				const response = yield* send((yield* serve(telemetry)).web, '/v1/traces', {
					body: otlp(yield* Clock.currentTimeMillis),
					headers: {'content-type': 'application/json'},
					method: 'POST'
				})
				assert.strictEqual(response.status, 503)
				assert.deepStrictEqual(yield* Effect.promise(() => response.json()), {
					code: 14,
					message: 'Telemetry storage unavailable'
				})
				assert.containsSubset((yield* telemetry.checkIngestion()).rejections, [
					{count: 1, credential: 'none', route: '/v1/traces', status: 503}
				])
			})
		)
	)
})
