import {Schema} from 'effect'

type Repository = typeof Repository.Type
// The parts of GitHub's `workflow_run` and `workflow_job` webhook payloads a trace needs; times are ISO strings.
const Repository = Schema.Struct({full_name: Schema.String})

export type Step = typeof Step.Type
const Step = Schema.Struct({
	completed_at: Schema.NullOr(Schema.String),
	conclusion: Schema.NullOr(Schema.String),
	name: Schema.String,
	number: Schema.Int,
	started_at: Schema.NullOr(Schema.String)
})

export type WorkflowJob = typeof WorkflowJob.Type
export const WorkflowJob = Schema.Struct({
	action: Schema.String,
	repository: Repository,
	workflow_job: Schema.Struct({
		completed_at: Schema.NullOr(Schema.String),
		conclusion: Schema.NullOr(Schema.String),
		created_at: Schema.String,
		html_url: Schema.String,
		id: Schema.Int,
		name: Schema.String,
		run_attempt: Schema.Int,
		run_id: Schema.Int,
		runner_name: Schema.NullOr(Schema.String),
		started_at: Schema.String,
		steps: Schema.Array(Step)
	})
})

export type WorkflowRun = typeof WorkflowRun.Type
export const WorkflowRun = Schema.Struct({
	action: Schema.String,
	repository: Repository,
	workflow_run: Schema.Struct({
		conclusion: Schema.NullOr(Schema.String),
		display_title: Schema.String,
		event: Schema.String,
		head_branch: Schema.NullOr(Schema.String),
		head_sha: Schema.String,
		html_url: Schema.String,
		id: Schema.Int,
		name: Schema.NullOr(Schema.String),
		run_attempt: Schema.Int,
		run_number: Schema.Int,
		run_started_at: Schema.String,
		updated_at: Schema.String
	})
})
