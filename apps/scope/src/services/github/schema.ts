import {Schema, pipe} from 'effect'

export type WorkflowRunId = typeof WorkflowRunId.Type
export const WorkflowRunId = pipe(Schema.Int, Schema.brand('WorkflowRunId'))

export type WorkflowJobId = typeof WorkflowJobId.Type
export const WorkflowJobId = pipe(Schema.Int, Schema.brand('WorkflowJobId'))

type Repository = typeof Repository.Type
// The parts of GitHub's webhook payloads a trace needs; ISO times and nulls are decoded once here.
const Repository = Schema.Struct({full_name: Schema.String})

export type Step = typeof Step.Type
const Step = Schema.Struct({
	completed_at: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
	conclusion: Schema.OptionFromNullOr(Schema.String),
	name: Schema.String,
	number: Schema.Int,
	started_at: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString)
})

export type WorkflowJob = typeof WorkflowJob.Type
export const WorkflowJob = Schema.Struct({
	action: Schema.String,
	repository: Repository,
	workflow_job: Schema.Struct({
		completed_at: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
		conclusion: Schema.OptionFromNullOr(Schema.String),
		created_at: Schema.DateTimeUtcFromString,
		html_url: Schema.String,
		id: WorkflowJobId,
		name: Schema.String,
		run_attempt: Schema.Int,
		run_id: WorkflowRunId,
		runner_name: Schema.OptionFromNullOr(Schema.String),
		started_at: Schema.DateTimeUtcFromString,
		steps: Schema.Array(Step)
	})
})

export type WorkflowRun = typeof WorkflowRun.Type
export const WorkflowRun = Schema.Struct({
	action: Schema.String,
	repository: Repository,
	workflow_run: Schema.Struct({
		conclusion: Schema.OptionFromNullOr(Schema.String),
		display_title: Schema.String,
		event: Schema.String,
		head_branch: Schema.OptionFromNullOr(Schema.String),
		head_sha: Schema.String,
		html_url: Schema.String,
		id: WorkflowRunId,
		name: Schema.OptionFromNullOr(Schema.String),
		run_attempt: Schema.Int,
		run_number: Schema.Int,
		run_started_at: Schema.DateTimeUtcFromString,
		updated_at: Schema.DateTimeUtcFromString
	})
})
