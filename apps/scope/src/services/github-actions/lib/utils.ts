import {Array, Boolean, DateTime, Duration, Option, String, pipe} from 'effect'

import type {
	RepositoryName,
	WorkflowJob,
	WorkflowJobId,
	WorkflowRun,
	WorkflowRunAttempt,
	WorkflowRunId,
	WorkflowStepNumber
} from '#services/github-actions/schema.ts'
import type {ExportedSpan} from '#services/telemetry/schema.ts'
import {LogsRequest, SpanId, TraceId, TracesRequest} from '#services/telemetry/schema.ts'

// A log line as GitHub writes it: an ISO time, then the runner's message.
const LOG_LINE = /^(\d{4}-\d{2}-\d{2}T\S+Z) (.*)$/u
// A runner command such as `##[error]` or `[command]`; group and action markers only divide the page.
const LOG_COMMAND =
	/^(?:##)?\[(command|debug|error|group|endgroup|notice|section|start-action|end-action|warning)(?: [^\]]*)?\](.*)$/u
// oxlint-disable-next-line eslint/no-control-regex -- ANSI escapes start with the ESC control character.
const ANSI = /\u001B\[[0-9;]*m/gu
const INSTRUMENTATION = {attributes: Option.none(), name: 'github-actions'}

// A GitHub instant as exact epoch nanoseconds.
function nanos(time: DateTime.Utc) {
	return Duration.nanos(BigInt(DateTime.toEpochMillis(time)) * 1_000_000n)
}

function hex(value: number, width: number) {
	return String.padStart(width, '0')(value.toString(16))
}

// A run attempt is one trace and its ids come from GitHub's, so each event joins it and a repeated delivery replaces what it sent.
function traceIdOf(run: WorkflowRunId, attempt: WorkflowRunAttempt) {
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
		return Option.some({code: Option.some(2), message: Option.some(message)})
	}
	if (Option.contains(conclusion, 'success')) return Option.some({code: Option.some(1), message: Option.some('')})
	return Option.some({code: Option.some(0), message: Option.some('')})
}

function text(key: string, value: string) {
	return {key, value: {stringValue: value}}
}

function repositoryTraces(repository: RepositoryName, spans: readonly ExportedSpan[]) {
	return TracesRequest.make({
		resourceSpans: Option.some([
			{
				resource: Option.some({
					attributes: Option.some([text('service.name', repository), text('scope.runtime', 'ci')])
				}),
				scopeSpans: Option.some([{scope: INSTRUMENTATION, spans: Option.some(spans)}])
			}
		])
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
	return repositoryTraces(event.repository.full_name, [
		{
			attributes: Option.some([
				text('github.title', event.workflow_run.display_title),
				text('github.event', event.workflow_run.event),
				text('github.run_number', `${event.workflow_run.run_number}`),
				text('github.run_attempt', `${event.workflow_run.run_attempt}`),
				text('trace.label', runLabel(event.workflow_run)),
				text(
					'git.branch',
					Option.getOrElse(event.workflow_run.head_branch, () => '')
				),
				text('git.commit', event.workflow_run.head_sha),
				text(
					'github.conclusion',
					Option.getOrElse(event.workflow_run.conclusion, () => '')
				),
				text('url.full', event.workflow_run.html_url)
			]),
			endTimeUnixNano: Option.liftPredicate(nanos(event.workflow_run.updated_at), () => event.action === 'completed'),
			events: Option.none(),
			kind: Option.some(1),
			links: Option.none(),
			name: Option.some(Option.getOrElse(event.workflow_run.name, () => event.workflow_run.display_title)),
			parentSpanId: Option.none(),
			startTimeUnixNano: nanos(event.workflow_run.run_started_at),
			status: statusOf(event.workflow_run.conclusion, `${event.workflow_run.display_title} failed`),
			...runIds(event)
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

function stepSpanId(job: WorkflowJobId, step: WorkflowStepNumber) {
	return SpanId.make(`3${hex(job, 12)}${hex(step, 3)}`)
}

// A job as a span with its steps beneath it, each step linking to its GitHub log.
export function jobTrace(event: WorkflowJob) {
	const job = event.workflow_job
	const traceId = traceIdOf(job.run_id, job.run_attempt)
	const steps = stepsOf(job)
	const failed = Array.findFirst(steps, step =>
		Option.exists(statusOf(step.conclusion, ''), status => Option.contains(status.code, 2))
	)
	return repositoryTraces(event.repository.full_name, [
		{
			attributes: Option.some([
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
					value: {intValue: `${Duration.toMillis(DateTime.distance(job.created_at, job.started_at))}`}
				},
				text('url.full', job.html_url)
			]),
			endTimeUnixNano: Option.some(nanos(Option.getOrElse(job.completed_at, () => job.started_at))),
			events: Option.none(),
			kind: Option.some(1),
			links: Option.none(),
			name: Option.some(job.name),
			parentSpanId: Option.some(runSpanId(job.run_id)),
			spanId: jobSpanId(job.id),
			startTimeUnixNano: nanos(job.started_at),
			status: statusOf(
				job.conclusion,
				Option.match(failed, {onNone: () => `${job.name} failed`, onSome: step => `${step.name} failed`})
			),
			traceId
		},
		...Array.map(steps, step => ({
			attributes: Option.some([
				text(
					'github.conclusion',
					Option.getOrElse(step.conclusion, () => '')
				),
				text('url.full', `${job.html_url}#step:${step.number}:1`)
			]),
			endTimeUnixNano: Option.some(nanos(step.completed)),
			events: Option.none(),
			kind: Option.some(1),
			links: Option.none(),
			name: Option.some(step.name),
			parentSpanId: Option.some(jobSpanId(job.id)),
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
					attributes: Option.none(),
					body: Option.some({stringValue: line.message}),
					observedTimeUnixNano: Option.none(),
					severityNumber: Option.some(severityOf(line.command)),
					severityText: Option.none(),
					spanId: Option.some(
						pipe(
							Option.fromUndefinedOr(steps[next]),
							Option.filter(step => DateTime.isGreaterThanOrEqualTo(line.time, step.start)),
							Option.match({onNone: () => jobSpanId(event.workflow_job.id), onSome: step => step.spanId})
						)
					),
					timeUnixNano: nanos(line.time),
					traceId: Option.some(traceId)
				}))
			] as const
		})
	)
	const records = Array.getSomes(lines)
	return LogsRequest.make({
		resourceLogs: Option.some([
			{
				resource: Option.some({
					attributes: Option.some([text('service.name', event.repository.full_name), text('scope.runtime', 'ci')])
				}),
				scopeLogs: Option.some([{logRecords: Option.some(records), scope: INSTRUMENTATION}])
			}
		])
	})
}
