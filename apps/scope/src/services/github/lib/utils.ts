import {Array, DateTime, Option, String, pipe} from 'effect'

import type {WorkflowJob, WorkflowRun} from '#services/github/schema.ts'
import type {Span} from '#services/telemetry/schema.ts'
import {TracesRequest} from '#services/telemetry/schema.ts'

// An ISO time as OTLP's nanoseconds.
function nanos(time: string) {
	return `${BigInt(DateTime.toEpochMillis(DateTime.makeUnsafe(time))) * 1_000_000n}`
}

function hex(value: number, width: number) {
	return String.padStart(width, '0')(value.toString(16))
}

// A run attempt is one trace and its ids come from GitHub's, so each event joins it and a repeated delivery replaces what it sent.
function traceIdOf(run: number, attempt: number) {
	return `${hex(run, 24)}${hex(attempt, 8)}`
}

function runSpanId(run: number) {
	return `1${hex(run, 15)}`
}

function jobSpanId(job: number) {
	return `2${hex(job, 15)}`
}

// A conclusion as an OTLP status: a failure or timeout failed, success is ok, and a cancelled or skipped one is neither.
function statusOf(conclusion: string | null, message: string) {
	if (conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'startup_failure') {
		return {code: 2, message}
	}
	if (conclusion === 'success') return {code: 1, message: ''}
	return {code: 0, message: ''}
}

function text(key: string, value: string) {
	return {key, value: {stringValue: value}}
}

function repositoryTraces(repository: string, spans: readonly Span[]) {
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

// A workflow run as its trace's root: running, it has no end yet, so the trace lasts as long as its finished jobs.
export function runTrace(event: WorkflowRun) {
	const run = event.workflow_run
	return repositoryTraces(event.repository.full_name, [
		{
			attributes: [
				text('github.title', run.display_title),
				text('github.event', run.event),
				text('git.branch', run.head_branch ?? ''),
				text('git.commit', run.head_sha),
				text('github.conclusion', run.conclusion ?? ''),
				text('url.full', run.html_url)
			],
			kind: 1,
			name: run.name ?? run.display_title,
			parentSpanId: '',
			startTimeUnixNano: nanos(run.run_started_at),
			status: statusOf(run.conclusion, `${run.display_title} failed`),
			...runIds(event),
			...Option.match(
				Option.liftPredicate(event.action, action => action === 'completed'),
				{onNone: () => ({}), onSome: () => ({endTimeUnixNano: nanos(run.updated_at)})}
			)
		}
	])
}

// A failed step links to its log, since GitHub sends no output.
export function jobTrace(event: WorkflowJob) {
	const job = event.workflow_job
	const traceId = traceIdOf(job.run_id, job.run_attempt)
	const steps = Array.getSomes(
		Array.map(job.steps, step =>
			pipe(
				Option.all({
					completed: Option.fromNullishOr(step.completed_at),
					started: Option.fromNullishOr(step.started_at)
				}),
				Option.map(times => ({...step, ...times}))
			)
		)
	)
	const failed = Array.findFirst(steps, step => statusOf(step.conclusion, '').code === 2)
	return repositoryTraces(event.repository.full_name, [
		{
			attributes: [
				text('github.runner', job.runner_name ?? ''),
				text('github.conclusion', job.conclusion ?? ''),
				{
					key: 'github.queued_ms',
					value: {
						intValue: `${DateTime.toEpochMillis(DateTime.makeUnsafe(job.started_at)) - DateTime.toEpochMillis(DateTime.makeUnsafe(job.created_at))}`
					}
				},
				text('url.full', job.html_url)
			],
			endTimeUnixNano: nanos(job.completed_at ?? job.started_at),
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
				text('github.conclusion', step.conclusion ?? ''),
				text('url.full', `${job.html_url}#step:${step.number}:1`)
			],
			endTimeUnixNano: nanos(step.completed),
			kind: 1,
			name: step.name,
			parentSpanId: jobSpanId(job.id),
			spanId: `3${hex(job.id, 12)}${hex(step.number, 3)}`,
			startTimeUnixNano: nanos(step.started),
			status: statusOf(step.conclusion, `${step.name} failed`),
			traceId
		}))
	])
}
