import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Effect, Layer, Option, Schema, Stream, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'
import {TestClock} from 'effect/testing'

import {jobLogs, jobTrace, runTrace} from '#services/github/lib/utils.ts'
import {WorkflowJob, WorkflowRun} from '#services/github/schema.ts'
import {Telemetry} from '#services/telemetry/service.ts'

const REPOSITORY = {full_name: 'MP281X/deslop'}

// GitHub sends a step that never ran with null times.
const SKIPPED = Schema.decodeSync(Schema.fromJsonString(WorkflowJob.fields.workflow_job.fields.steps))(
	'[{"completed_at": null, "conclusion": "skipped", "name": "Post checkout", "number": 3, "started_at": null}]'
)

const layer = Layer.provide(
	Telemetry.layer,
	Layer.mergeAll(SqliteClient.layer({filename: ':memory:'}), Reactivity.layer, NodeCrypto.layer, NodeServices.layer)
)

const run = WorkflowRun.make({
	action: 'completed',
	repository: REPOSITORY,
	workflow_run: {
		conclusion: 'failure',
		display_title: 'Scope: GitHub Actions as traces',
		event: 'push',
		head_branch: 'main',
		head_sha: 'a05def32',
		html_url: 'https://github.com/MP281X/deslop/actions/runs/101',
		id: 101,
		name: 'Release',
		run_attempt: 1,
		run_number: 101,
		run_started_at: '2026-11-03T08:00:00Z',
		updated_at: '2026-11-03T08:06:00Z'
	}
})

const job = WorkflowJob.make({
	action: 'completed',
	repository: REPOSITORY,
	workflow_job: {
		completed_at: '2026-11-03T08:05:00Z',
		conclusion: 'failure',
		created_at: '2026-11-03T08:00:00Z',
		html_url: 'https://github.com/MP281X/deslop/actions/runs/101/job/202',
		id: 202,
		name: 'Check',
		run_attempt: 1,
		run_id: 101,
		runner_name: 'GitHub Actions 1',
		started_at: '2026-11-03T08:00:10Z',
		steps: [
			{
				completed_at: '2026-11-03T08:01:00Z',
				conclusion: 'success',
				name: 'Set up job',
				number: 1,
				started_at: '2026-11-03T08:00:10Z'
			},
			{
				completed_at: '2026-11-03T08:05:00Z',
				conclusion: 'failure',
				name: 'Format, lint, types and dead code',
				number: 2,
				started_at: '2026-11-03T08:01:00Z'
			},
			...SKIPPED
		]
	}
})

it('attaches a job log to the step each line falls in, the job otherwise', () => {
	const log = Array.join(
		[
			'﻿2026-11-03T08:00:11.0000000Z Runner started',
			'2026-11-03T08:00:20.0000000Z ##[group]Set up job',
			'2026-11-03T08:00:21.0000000Z \u001B[36;1mPreparing\u001B[0m',
			'2026-11-03T08:00:22.0000000Z ##[endgroup]',
			'2026-11-03T08:01:01.0000000Z ##[error]Format failed',
			'2026-11-03T08:01:02.0000000Z [command]vp run verify',
			'2026-11-03T08:05:30.0000000Z ##[warning]Post job cleanup'
		],
		'\n'
	)
	const records = jobLogs(job, log).resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords ?? []
	assert.deepStrictEqual(
		Array.map(records, record => [record.spanId, record.body?.['stringValue'], record.severityNumber]),
		[
			['30000000000ca001', 'Runner started', 9],
			['30000000000ca001', 'Preparing', 9],
			['30000000000ca002', 'Format failed', 17],
			['30000000000ca002', 'vp run verify', 9],
			['20000000000000ca', 'Post job cleanup', 13]
		]
	)
	assert.strictEqual(
		records[0]?.timeUnixNano,
		`${BigInt(DateTime.toEpochMillis(DateTime.makeUnsafe('2026-11-03T08:00:11Z'))) * 1_000_000n}`
	)
	assert.strictEqual(records[0]?.traceId, '00000000000000000000006500000001')
})

it('names a retry attempt after its build number', () => {
	const retry = runTrace({...run, workflow_run: {...run.workflow_run, run_attempt: 2}})
	assert.deepStrictEqual(
		pipe(
			Option.getOrThrow(Array.head(retry.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? [])).attributes ?? [],
			Array.filter(attribute => attribute.key === 'trace.label'),
			Array.map(attribute => attribute.value['stringValue'])
		),
		['#101.2']
	)
})

it.layer(layer)(test => {
	test.effect(
		'reads a workflow run as a trace of its jobs and steps, broken at the step that failed',
		Effect.fnUntraced(function* () {
			const telemetry = yield* Telemetry
			// A job finishes before its run does; a repeated delivery replaces what the first sent.
			yield* telemetry.ingestTraces(jobTrace(job))
			yield* telemetry.ingestTraces(jobTrace(job))
			yield* telemetry.ingestTraces(runTrace({...run, action: 'in_progress'}))
			yield* telemetry.ingestTraces(runTrace(run))
			yield* TestClock.adjust('2 seconds')
			const app = Option.getOrThrow(Array.head(Option.getOrThrow(yield* Stream.runHead(telemetry.watch('3d'))).apps))
			assert.strictEqual(app.name, 'MP281X/deslop')
			assert.deepStrictEqual(
				Array.map(app.operations, operation => [
					operation.runtime,
					operation.name,
					operation.count,
					operation.failures
				]),
				[['ci', 'Release', 1, 1]]
			)
			const trace = Option.getOrThrow(Array.head(app.operations[0]?.traces ?? []))
			assert.containsSubset(trace.failure, {span: 'Format, lint, types and dead code'})
			assert.strictEqual(Duration.toMillis(trace.duration), 360_000)
			assert.strictEqual(trace.label, '#101')
			assert.deepStrictEqual(
				Array.map((yield* telemetry.trace(trace.id)).spans, span => [span.depth, span.name]),
				[
					[0, 'Release'],
					[1, 'Check'],
					[2, 'Set up job'],
					[2, 'Format, lint, types and dead code']
				]
			)
		})
	)
})
