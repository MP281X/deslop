import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Context,
	Deferred,
	Effect,
	FileSystem,
	Layer,
	Number,
	Option,
	Ref,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {layerDataStore} from '@deslop/runtime/server/store'

import {WorkflowJob} from './contract.ts'
import {GitHubActions, GitHubLogs} from './server.ts'

import {Ingestion} from '#ingestion/server.ts'
import {TraceId} from '#telemetry/contract.ts'
import {Telemetry} from '#telemetry/server.ts'

const JOB = Schema.decodeSync(WorkflowJob)({
	action: 'completed',
	repository: {full_name: 'MP281X/deslop'},
	workflow_job: {
		completed_at: '2026-11-18T10:00:20Z',
		conclusion: 'failure',
		created_at: '2026-11-18T09:59:58Z',
		html_url: 'https://github.com/MP281X/deslop/actions/runs/1/job/2',
		id: 2,
		name: 'Check',
		run_attempt: 1,
		run_id: 1,
		runner_name: 'runner',
		started_at: '2026-11-18T10:00:00Z',
		steps: [
			{
				completed_at: '2026-11-18T10:00:09Z',
				conclusion: 'failure',
				name: 'Build',
				number: 1,
				started_at: '2026-11-18T10:00:00Z'
			}
		]
	}
})

// GitHub as the worker meets it: every log request is counted, then answered with what `answer` gives.
function gitHub(requests: Ref.Ref<number>, answer: Effect.Effect<string>) {
	return Layer.mock(GitHubLogs, {
		read: Option.some(() =>
			pipe(
				Ref.update(requests, count => count + 1),
				Effect.andThen(answer),
				Stream.fromEffect
			)
		)
	})
}

// One run of the server on `directory`, its database kept between runs.
function server(directory: string, logs: Layer.Layer<GitHubLogs>) {
	return pipe(
		GitHubActions.layer,
		Layer.provideMerge(Ingestion.layer),
		Layer.provideMerge(Telemetry.layer),
		Layer.provideMerge(layerDataStore(directory)),
		Layer.provide(logs),
		Layer.provide(NodeCrypto.layer),
		Layer.provide(NodeServices.layer)
	)
}

// Real time and files: the worker and the trace reader wait on the clock, and a restart reopens the database the last run wrote.
it.layer(NodeServices.layer, {excludeTestServices: true})(test =>
	test.effect(
		'keeps a requested log across a restart and fetches it once however often the job is delivered',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const requests = yield* Ref.make(0)
			const asked = yield* Deferred.make<void>()
			// The first run stores the job and starts its fetch, then stops before GitHub answers.
			yield* Effect.scoped(
				Effect.gen(function* () {
					const context = yield* Layer.build(
						server(directory, gitHub(requests, Effect.andThen(Deferred.succeed(asked, undefined), Effect.never)))
					)
					const github = Context.get(context, GitHubActions)
					yield* github.ingestJob(JOB)
					yield* github.ingestJob(JOB)
					yield* Deferred.await(asked)
				})
			)
			assert.strictEqual(yield* Ref.get(requests), 1)
			// The next run on the same data claims the fetch at start and stores the log under the job's step.
			const tree = yield* Effect.scoped(
				Effect.gen(function* () {
					const context = yield* Layer.build(
						server(directory, gitHub(requests, Effect.succeed('2026-11-18T10:00:08.0000000Z ##[error]build failed\n')))
					)
					return yield* pipe(
						Context.get(context, Telemetry).watchTrace(TraceId.make('00000000000000000000000100000001')),
						Stream.filter(trace => Array.some(trace.spans, span => Array.isReadonlyArrayNonEmpty(span.logs))),
						Stream.runHead
					)
				})
			)
			assert.deepStrictEqual(
				Option.map(tree, trace => Array.flatMap(trace.spans, span => Array.map(span.logs, log => log.message))),
				Option.some(['build failed'])
			)
			assert.strictEqual(yield* Ref.get(requests), 2)
		})
	)
)

it.layer(NodeServices.layer, {excludeTestServices: true})(test =>
	test.effect(
		'keeps every repeated line of a failed job log across its batches',
		Effect.fnUntraced(function* () {
			const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const requests = yield* Ref.make(0)
			assert.isTrue(
				Option.isSome(
					yield* Effect.scoped(
						Effect.gen(function* () {
							const context = yield* Layer.build(
								server(
									directory,
									gitHub(requests, Effect.succeed(String.repeat(501)('2026-11-18T10:00:08.0000000Z ##[error]again\n')))
								)
							)
							yield* Context.get(context, GitHubActions).ingestJob(JOB)
							return yield* pipe(
								Context.get(context, Telemetry).watchTrace(TraceId.make('00000000000000000000000100000001')),
								Stream.filter(trace => Number.sumAll(Array.map(trace.spans, span => span.logs.length)) === 501),
								Stream.runHead
							)
						})
					)
				)
			)
		})
	)
)
