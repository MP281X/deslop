import {Array, Boolean, DateTime, Option, String, pipe} from 'effect'

import type {WorkflowJob, WorkflowJobId, WorkflowRun, WorkflowRunId} from '#services/github/schema.ts'
import type {ExportedSpan} from '#services/telemetry/schema.ts'
import {LogsRequest, SpanId, TraceId, TracesRequest} from '#services/telemetry/schema.ts'

// A log line as GitHub writes it: an ISO time, then the runner's message.
const LOG_LINE = /^(\d{4}-\d{2}-\d{2}T\S+Z) (.*)$/u
// A runner command such as `##[error]` or `[command]`; group and action markers only divide the page.
const LOG_COMMAND =
	/^(?:##)?\[(command|debug|error|group|endgroup|notice|section|start-action|end-action|warning)(?: [^\]]*)?\](.*)$/u
// oxlint-disable-next-line eslint/no-control-regex -- ANSI escapes start with the ESC control character.
const ANSI = /\u001B\[[0-9;]*m/gu

// An ISO time as OTLP's nanoseconds.
function nanos(time: DateTime.Utc) {
	return `${BigInt(DateTime.toEpochMillis(time)) * 1_000_000n}`
}

function hex(value: number, width: number) {
	return String.padStart(width, '0')(value.toString(16))
}

// A run attempt is one trace and its ids come from GitHub's, so each event joins it and a repeated delivery replaces what it sent.
function traceIdOf(run: WorkflowRunId, attempt: number) {
	return TraceId.make(`${hex(run, 24)}${hex(attempt, 8)}`)
}

function runSpanId(run: WorkflowRunId) {
	return SpanId.make(`1${hex(run, 15)}`)
}

function jobSpanId(job: WorkflowJobId) {
	return SpanId.make(`2${hex(job, 15)}`)
}

// A conclusion as an OTLP status: a failure or timeout failed, success is ok, and a cancelled or skipped one is neither.
function statusOf(conclusion: Option.Option<string>, message: string) {
	if (Option.exists(conclusion, value => Array.contains(['failure', 'timed_out', 'startup_failure'], value))) {
		return {code: 2, message}
	}
	if (Option.contains(conclusion, 'success')) return {code: 1, message: ''}
	return {code: 0, message: ''}
}

function text(key: string, value: string) {
	return {key, value: {stringValue: value}}
}

function repositoryTraces(repository: string, spans: readonly ExportedSpan[]) {
	return TracesRequest.make({
		resourceSpans: [
			{
				resource: {attributes: [text('service.name', repository), text('scope.runtime', 'ci')]},
				scopeSpans: [{scope: {name: 'github-actions'}, spans}]
			}
		]
	})
}

export function runIds(event: WorkflowRun) {
	return {
		spanId: runSpanId(event.workflow_run.id),
		traceId: traceIdOf(event.workflow_run.id, event.workflow_run.run_attempt)
	}
}

// A run's build number, with the attempt after a dot when it is not the first.
function runLabel(run: WorkflowRun['workflow_run']) {
	return `#${run.run_number}${Boolean.match(run.run_attempt === 1, {
		onFalse: () => `.${run.run_attempt}`,
		onTrue: () => ''
	})}`
}

// A workflow run as its trace's root: running, it has no end yet, so the trace lasts as long as its finished jobs.
export function runTrace(event: WorkflowRun) {
	const run = event.workflow_run
	return repositoryTraces(event.repository.full_name, [
		{
			attributes: [
				text('github.title', run.display_title),
				text('github.event', run.event),
				text('github.run_number', `${run.run_number}`),
				text('github.run_attempt', `${run.run_attempt}`),
				text('trace.label', runLabel(run)),
				text(
					'git.branch',
					Option.getOrElse(run.head_branch, () => '')
				),
				text('git.commit', run.head_sha),
				text(
					'github.conclusion',
					Option.getOrElse(run.conclusion, () => '')
				),
				text('url.full', run.html_url)
			],
			kind: 1,
			name: Option.getOrElse(run.name, () => run.display_title),
			parentSpanId: '',
			startTimeUnixNano: nanos(run.run_started_at),
			status: statusOf(run.conclusion, `${run.display_title} failed`),
			...runIds(event),
			...pipe(
				event.action,
				Option.liftPredicate(action => action === 'completed'),
				Option.match({onNone: () => ({}), onSome: () => ({endTimeUnixNano: nanos(run.updated_at)})})
			)
		}
	])
}

// The steps that ran, with the times GitHub gave them.
function stepsOf(job: WorkflowJob['workflow_job']) {
	return Array.getSomes(
		Array.map(job.steps, step =>
			Option.map(Option.all({completed: step.completed_at, started: step.started_at}), times => ({...step, ...times}))
		)
	)
}

function stepSpanId(job: WorkflowJobId, step: number) {
	return SpanId.make(`3${hex(job, 12)}${hex(step, 3)}`)
}

// A job as a span with its steps beneath it, each step linking to its GitHub log.
export function jobTrace(event: WorkflowJob) {
	const job = event.workflow_job
	const traceId = traceIdOf(job.run_id, job.run_attempt)
	const steps = stepsOf(job)
	const failed = Array.findFirst(steps, step => statusOf(step.conclusion, '').code === 2)
	return repositoryTraces(event.repository.full_name, [
		{
			attributes: [
				text(
					'github.runner',
					Option.getOrElse(job.runner_name, () => '')
				),
				text(
					'github.conclusion',
					Option.getOrElse(job.conclusion, () => '')
				),
				{
					key: 'github.queued_ms',
					value: {intValue: `${DateTime.toEpochMillis(job.started_at) - DateTime.toEpochMillis(job.created_at)}`}
				},
				text('url.full', job.html_url)
			],
			endTimeUnixNano: nanos(Option.getOrElse(job.completed_at, () => job.started_at)),
			kind: 1,
			name: job.name,
			parentSpanId: runSpanId(job.run_id),
			spanId: jobSpanId(job.id),
			startTimeUnixNano: nanos(job.started_at),
			status: statusOf(
				job.conclusion,
				Option.match(failed, {onNone: () => `${job.name} failed`, onSome: step => `${step.name} failed`})
			),
			traceId
		},
		...Array.map(steps, step => ({
			attributes: [
				text(
					'github.conclusion',
					Option.getOrElse(step.conclusion, () => '')
				),
				text('url.full', `${job.html_url}#step:${step.number}:1`)
			],
			endTimeUnixNano: nanos(step.completed),
			kind: 1,
			name: step.name,
			parentSpanId: jobSpanId(job.id),
			spanId: stepSpanId(job.id, step.number),
			startTimeUnixNano: nanos(step.started),
			status: statusOf(step.conclusion, `${step.name} failed`),
			traceId
		}))
	])
}

// A runner command's severity as OTLP's: errors are 17, warnings 13, everything else info.
function severityOf(command: string) {
	if (command === 'error') return 17
	if (command === 'warning') return 13
	return 9
}

// Steps run in time order, so a line advances the pointer past every step that had already ended.
function stepIndexAfter(steps: readonly {end: DateTime.Utc}[], index: number, time: DateTime.Utc): number {
	const step = steps[index]
	if (step === undefined || DateTime.isLessThanOrEqualTo(time, step.end)) return index
	return stepIndexAfter(steps, index + 1, time)
}

// The job's log as one log record per line, on the step whose time holds it and the job otherwise, so a trace's steps show their own output.
export function jobLogs(event: WorkflowJob, log: string) {
	const traceId = traceIdOf(event.workflow_job.run_id, event.workflow_job.run_attempt)
	const steps = Array.map(stepsOf(event.workflow_job), step => ({
		end: step.completed,
		spanId: stepSpanId(event.workflow_job.id, step.number),
		start: step.started
	}))
	// Log lines and steps both arrive in time order, so one pointer moves through the steps once.
	const [, lines] = pipe(
		log,
		String.split('\n'),
		Array.mapAccum(0, (stepIndex, raw) => {
			const entry = pipe(
				raw,
				String.replaceAll(ANSI, ''),
				String.trim,
				String.match(LOG_LINE),
				Option.flatMap(match => {
					const message = match[2] ?? ''
					return Option.map(DateTime.make(match[1] ?? ''), date => ({
						...Option.match(String.match(LOG_COMMAND)(message), {
							onNone: () => ({command: '', message}),
							onSome: command => ({command: command[1] ?? '', message: command[2] ?? ''})
						}),
						time: date
					}))
				}),
				Option.filter(
					line => String.trim(line.message) !== '' && line.command !== 'group' && line.command !== 'endgroup'
				)
			)
			const next = Option.match(entry, {
				onNone: () => stepIndex,
				onSome: line => stepIndexAfter(steps, stepIndex, line.time)
			})
			return [
				next,
				Option.map(entry, line => ({
					body: {stringValue: line.message},
					severityNumber: severityOf(line.command),
					spanId: pipe(
						Option.fromUndefinedOr(steps[next]),
						Option.filter(step => DateTime.isGreaterThanOrEqualTo(line.time, step.start)),
						Option.match({onNone: () => jobSpanId(event.workflow_job.id), onSome: step => step.spanId})
					),
					timeUnixNano: nanos(line.time),
					traceId
				}))
			] as const
		})
	)
	const records = Array.getSomes(lines)
	return LogsRequest.make({
		resourceLogs: [
			{
				resource: {attributes: [text('service.name', event.repository.full_name), text('scope.runtime', 'ci')]},
				scopeLogs: [{logRecords: records, scope: {name: 'github-actions'}}]
			}
		]
	})
}
