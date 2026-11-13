import {Schema, pipe} from 'effect'

export type WorkflowRunId = typeof WorkflowRunId.Type
export const WorkflowRunId = pipe(Schema.Int, Schema.brand('WorkflowRunId'))

export type WorkflowJobId = typeof WorkflowJobId.Type
export const WorkflowJobId = pipe(Schema.Int, Schema.brand('WorkflowJobId'))

export type RepositoryName = typeof RepositoryName.Type
export const RepositoryName = pipe(Schema.String, Schema.brand('GitHubRepositoryName'))

type CommitSha = typeof CommitSha.Type
const CommitSha = pipe(Schema.String, Schema.brand('GitCommitSha'))

export type WorkflowRunAttempt = typeof WorkflowRunAttempt.Type
export const WorkflowRunAttempt = pipe(Schema.Int, Schema.brand('WorkflowRunAttempt'))

export type WorkflowStepNumber = typeof WorkflowStepNumber.Type
export const WorkflowStepNumber = pipe(Schema.Int, Schema.brand('WorkflowStepNumber'))

type Repository = typeof Repository.Type
// The parts of GitHub's webhook payloads a trace needs; ISO times and nulls are decoded once here.
const Repository = Schema.Struct({full_name: RepositoryName})

export type Step = typeof Step.Type
const Step = Schema.Struct({
	completed_at: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
	conclusion: Schema.OptionFromNullOr(Schema.String),
	name: Schema.String,
	number: WorkflowStepNumber,
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
		run_attempt: WorkflowRunAttempt,
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
		head_sha: CommitSha,
		html_url: Schema.String,
		id: WorkflowRunId,
		name: Schema.OptionFromNullOr(Schema.String),
		run_attempt: WorkflowRunAttempt,
		run_number: Schema.Int,
		run_started_at: Schema.DateTimeUtcFromString,
		updated_at: Schema.DateTimeUtcFromString
	})
})
