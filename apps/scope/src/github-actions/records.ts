import {Array, Boolean, DateTime, Duration, Function, HashMap, Option, Stream, String, pipe} from 'effect'

import type {
	RepositoryName,
	WorkflowJob,
	WorkflowJobId,
	WorkflowRun,
	WorkflowRunAttempt,
	WorkflowRunId,
	WorkflowStepNumber
} from './contract.ts'

import {LogsRequest, TracesRequest} from '#ingestion/contract.ts'
import type {ExportedLog, ExportedSpan} from '#ingestion/contract.ts'
import {SpanId, TraceId} from '#telemetry/contract.ts'

// A runner line past this many characters is cut, so a line that never ends holds no more of the log in memory.
const LINE_LIMIT = 64 * 1024
// A log line as GitHub writes it: an ISO time, then the runner's message.
const LOG_LINE = /^(\d{4}-\d{2}-\d{2}T\S+Z) (.*)$/u
// A runner command such as `##[error]` or `[command]`; group and action markers only divide the page.
const LOG_COMMAND =
	/^(?:##)?\[(command|debug|error|group|endgroup|notice|section|start-action|end-action|warning)(?: [^\]]*)?\](.*)$/u
// oxlint-disable-next-line eslint/no-control-regex -- ANSI escapes start with the ESC control character.
const ANSI = /\u001B\[[0-9;]*m/gu
// A step an action runs rather than the workflow's own command: its output is setup, checkout or cleanup chatter.
const ACTION_STEP = /^(?:Run actions\/|Run \.\/|Post |Set up job$|Complete job$)/u
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

function failedConclusion(conclusion: Option.Option<string>) {
	return Option.exists(conclusion, value => Array.contains(['failure', 'timed_out', 'startup_failure'], value))
}

// A conclusion as an OTLP status: a failure or timeout failed, success is ok, and a cancelled or skipped one is neither.
function statusOf(conclusion: Option.Option<string>, message: string) {
	if (failedConclusion(conclusion)) {
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

function runIds(event: WorkflowRun) {
	return {
		spanId: runSpanId(event.workflow_run.id),
		traceId: traceIdOf(event.workflow_run.id, event.workflow_run.run_attempt)
	}
}

// A run's build number, with the attempt after a dot when it is not the first.
function runLabel(run: WorkflowRun['workflow_run']) {
	return `#${run.run_number}${Boolean.match(run.run_attempt === 1, {
		onFalse: () => `.${run.run_attempt}`,
		onTrue: Function.constant('')
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
				text('git.branch', Option.getOrElse(event.workflow_run.head_branch, Function.constant(''))),
				text('git.commit', event.workflow_run.head_sha),
				text('github.conclusion', Option.getOrElse(event.workflow_run.conclusion, Function.constant(''))),
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
				text('github.runner', Option.getOrElse(job.runner_name, Function.constant(''))),
				text('github.conclusion', Option.getOrElse(job.conclusion, Function.constant(''))),
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
				text('github.conclusion', Option.getOrElse(step.conclusion, Function.constant(''))),
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

// A runner time as exact epoch nanoseconds: GitHub writes seven fractional digits, finer than a millisecond.
function lineNanos(stamp: string, time: DateTime.Utc) {
	const fraction = pipe(
		stamp,
		String.match(/\.(\d{1,9})Z$/u),
		Option.flatMap(match => Option.fromUndefinedOr(match[1])),
		Option.getOrElse(Function.constant('')),
		String.padEnd(9, '0')
	)
	return Duration.nanos(BigInt(Math.floor(DateTime.toEpochMillis(time) / 1000)) * 1_000_000_000n + BigInt(fraction))
}

// A log's text as lines, each cut at LINE_LIMIT characters; only the line being read is held, never the whole log. The closing newline ends the last line only when the log ended cleanly, so a download cut mid-line leaves no half line.
export function logLines<E, R>(log: Stream.Stream<string, E, R>) {
	return pipe(
		log,
		Stream.concat(Stream.make('\n')),
		Stream.mapAccum(Function.constant(''), (partial, chunk) => {
			const lines = String.split(`${partial}${chunk}`, '\n')
			return [
				String.slice(0, LINE_LIMIT)(Array.lastNonEmpty(lines)),
				Array.map(Array.initNonEmpty(lines), String.slice(0, LINE_LIMIT))
			] as const
		})
	)
}

// One runner line as a log record on the step whose time holds it, the job otherwise, so a buffered line written late still finds its step.
function lineReader(event: WorkflowJob) {
	const traceId = traceIdOf(event.workflow_job.run_id, event.workflow_job.run_attempt)
	const steps = Array.map(stepsOf(event.workflow_job), step => ({
		end: step.completed,
		spanId: stepSpanId(event.workflow_job.id, step.number),
		start: step.started
	}))
	return (raw: string) =>
		pipe(
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
					nanos: lineNanos(match[1] ?? '', date),
					time: date
				}))
			}),
			Option.filter(
				line => String.trim(line.message) !== '' && line.command !== 'group' && line.command !== 'endgroup'
			),
			Option.map(
				line =>
					({
						attributes: Option.none(),
						body: Option.some({stringValue: line.message}),
						observedTimeUnixNano: Option.none(),
						severityNumber: Option.some(severityOf(line.command)),
						severityText: Option.none(),
						spanId: Option.some(
							pipe(
								steps,
								Array.findFirst(
									step =>
										DateTime.isGreaterThanOrEqualTo(line.time, step.start) &&
										DateTime.isLessThanOrEqualTo(line.time, step.end)
								),
								Option.match({onNone: () => jobSpanId(event.workflow_job.id), onSome: step => step.spanId})
							)
						),
						timeUnixNano: Option.some(line.nanos),
						traceId: Option.some(traceId)
					}) satisfies ExportedLog
			)
		)
}

function warns(record: ExportedLog) {
	return Option.exists(record.severityNumber, severity => severity >= 13)
}

// The records a job's log keeps, as they are read: a failed job keeps every line; a successful one keeps runner warnings and errors, and the last ten lines of each of its own steps, which hold their test, lint or build summary.
export function jobRecords<E, R>(event: WorkflowJob, lines: Stream.Stream<string, E, R>) {
	const read = lineReader(event)
	const failed = failedConclusion(event.workflow_job.conclusion)
	const own = pipe(
		stepsOf(event.workflow_job),
		Array.filter(step => Option.isNone(String.match(ACTION_STEP)(step.name))),
		Array.map(step => stepSpanId(event.workflow_job.id, step.number))
	)
	return pipe(
		lines,
		Stream.map(Option.some),
		// The closing none arrives only when the log ended cleanly: a download cut short emits no step's last lines, which its retry would store again in another batch.
		Stream.concat(Stream.make(Option.none<string>())),
		Stream.mapAccum(
			() => HashMap.empty<string, readonly ExportedLog[]>(),
			(tails, line) =>
				Option.match(line, {
					// A warning among a step's last lines was kept when it was read.
					onNone: () =>
						[
							tails,
							pipe(
								HashMap.values(tails),
								Array.fromIterable,
								Array.flatten,
								Array.filter(record => !warns(record))
							)
						] as const,
					onSome: content =>
						Option.match(read(content), {
							onNone: () => [tails, []] as const,
							// An export's record, as the steps' last lines emitted at the end are.
							onSome: (record: ExportedLog) => {
								const kept = Array.filter([record], () => failed || warns(record))
								if (failed) return [tails, kept] as const
								return pipe(
									record.spanId,
									Option.filter(span => Array.contains(own, span)),
									Option.match({
										onNone: () => [tails, kept] as const,
										onSome: span =>
											[
												HashMap.set(
													tails,
													span,
													pipe(
														tails,
														HashMap.get(span),
														Option.getOrElse(Array.empty<ExportedLog>),
														Array.takeRight(9),
														Array.append(record)
													)
												),
												kept
											] as const
									})
								)
							}
						})
				})
		)
	)
}

// Some of a job's log records as one export under its repository; the batch is the export's place in the log.
export function jobLogs(event: WorkflowJob, records: readonly ExportedLog[], batch: number) {
	return LogsRequest.make({
		resourceLogs: Option.some([
			{
				resource: Option.some({
					attributes: Option.some([
						text('service.name', event.repository.full_name),
						text('scope.runtime', 'ci'),
						text('github.log_batch', `${batch}`)
					])
				}),
				scopeLogs: Option.some([{logRecords: Option.some(records), scope: INSTRUMENTATION}])
			}
		])
	})
}
