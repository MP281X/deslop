import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Effect, FileSystem, Layer, Option, Schema, Stream, pipe} from 'effect'

import {TestClock} from 'effect/testing'

import {jobTrace, runTrace} from '#services/github/lib/utils.ts'
import {WorkflowJob, WorkflowRun} from '#services/github/schema.ts'
import {Telemetry} from '#services/telemetry/service.ts'

const REPOSITORY = {full_name: 'MP281X/deslop'}

// GitHub sends a step that never ran with null times.
const SKIPPED = Schema.decodeSync(Schema.fromJsonString(WorkflowJob.fields.workflow_job.fields.steps))(
	'[{"completed_at": null, "conclusion": "skipped", "name": "Post checkout", "number": 3, "started_at": null}]'
)

const layer = pipe(
	Layer.unwrap(
		Effect.map(
			FileSystem.FileSystem.use(fs => fs.makeTempDirectoryScoped()),
			Telemetry.layer
		)
	),
	Layer.provide(Layer.merge(NodeCrypto.layer, NodeServices.layer))
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
			const app = Option.getOrThrow(Array.head(Option.getOrThrow(yield* Stream.runHead(telemetry.overview)).apps))
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
			assert.deepStrictEqual(trace.failure, {span: 'Format, lint, types and dead code'})
			assert.strictEqual(trace.durationMs, 360_000)
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
