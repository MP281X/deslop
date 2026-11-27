import {assert, it} from '@effect/vitest'

import {Array, Duration, Effect, Function, Option, Result, Schema, Stream, String, pipe} from 'effect'

import {jobRecords, logLines} from '#server/github-actions/records.ts'
import {WorkflowJob} from '#server/github-actions/schema.ts'

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
			},
			{
				completed_at: '2026-11-18T10:00:19Z',
				conclusion: 'success',
				name: 'Test',
				number: 2,
				started_at: '2026-11-18T10:00:10Z'
			}
		]
	}
})

function records(log: string, job: WorkflowJob = JOB) {
	return Effect.map(Stream.runCollect(jobRecords(job, logLines(Stream.make(log)))), Array.fromIterable)
}

it.effect(
	'puts a line on the step whose time holds it, even when it was written after a later step',
	Effect.fnUntraced(function* () {
		assert.deepStrictEqual(
			Array.map(
				yield* records(
					Array.join(
						[
							'2026-11-18T10:00:01.0000000Z compiling',
							'2026-11-18T10:00:11.0000000Z testing',
							'2026-11-18T10:00:08.0000000Z ##[error]build failed'
						],
						'\n'
					)
				),
				record => Option.getOrThrow(record.spanId)
			),
			['3000000000002001', '3000000000002002', '3000000000002001']
		)
	})
)

it.effect(
	'keeps the runner time finer than a millisecond',
	Effect.fnUntraced(function* () {
		assert.deepStrictEqual(
			Array.map(
				yield* records(Array.join(['2026-11-18T10:00:01.0000001Z first', '2026-11-18T10:00:01.0000002Z second'], '\n')),
				record => Duration.toNanosUnsafe(Option.getOrThrow(record.timeUnixNano)) % 1_000_000n
			),
			[100n, 200n]
		)
	})
)

it.effect(
	'reads lines across chunks and cuts one that never ends',
	Effect.fnUntraced(function* () {
		assert.deepStrictEqual(
			Array.map(
				Array.fromIterable(
					yield* Stream.runCollect(logLines(Stream.make('first\nsec', 'ond\n', String.repeat(70_000)('x'), 'y')))
				),
				line => line.length
			),
			[5, 6, 65_536]
		)
	})
)

it.effect(
	'leaves no half line when the download is cut mid-line',
	Effect.fnUntraced(function* () {
		const read = yield* pipe(
			Stream.make('first\nsec'),
			Stream.concat(Stream.fail('cut')),
			logLines,
			Stream.result,
			Stream.runCollect
		)
		assert.deepStrictEqual(Array.map(Array.fromIterable(read), Result.getOrElse(Function.identity)), ['first', 'cut'])
	})
)

it.effect(
	"keeps a successful job's warnings and the last ten lines of its own steps",
	Effect.fnUntraced(function* () {
		const passed = {
			...JOB,
			workflow_job: {
				...JOB.workflow_job,
				conclusion: Option.some('success'),
				steps: Array.map(JOB.workflow_job.steps, step => ({...step, conclusion: Option.some('success')}))
			}
		}
		const lines = [
			'2026-11-18T10:00:01.0000000Z ##[warning]deprecated',
			...Array.makeBy(12, index => `2026-11-18T10:00:0${Math.floor(index / 4) + 2}.${index}000000Z line ${index}`),
			'2026-11-18T10:00:19.5000000Z job cleanup'
		]
		assert.deepStrictEqual(
			Array.map(yield* records(Array.join(lines, '\n'), passed), record => record.body),
			Array.map(['deprecated', ...Array.makeBy(10, index => `line ${index + 2}`)], line =>
				Option.some({stringValue: line})
			)
		)
	})
)

it.effect(
	"keeps no step's last lines from a download that was cut, so its retry stores them once",
	Effect.fnUntraced(function* () {
		const passed = {
			...JOB,
			workflow_job: {
				...JOB.workflow_job,
				conclusion: Option.some('success'),
				steps: Array.map(JOB.workflow_job.steps, step => ({...step, conclusion: Option.some('success')}))
			}
		}
		const read = yield* pipe(
			Stream.make('2026-11-18T10:00:01.0000000Z ##[warning]deprecated\n2026-11-18T10:00:02.0000000Z line\n'),
			Stream.concat(Stream.fail('cut')),
			logLines,
			lines => jobRecords(passed, lines),
			Stream.result,
			Stream.runCollect
		)
		assert.deepStrictEqual(
			Array.map(
				Array.fromIterable(read),
				Result.match({onFailure: Function.identity, onSuccess: record => record.body})
			),
			[Option.some({stringValue: 'deprecated'}), 'cut']
		)
	})
)
