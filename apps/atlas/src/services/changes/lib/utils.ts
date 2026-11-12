import {Array, Boolean, DateTime, Effect, Option, Record, Schema, String, pipe} from 'effect'

import {AtlasError, FileChange, PullRequest, Repo} from '#services/changes/schema.ts'
import type {Checks, Review} from '#services/changes/schema.ts'

const GITHUB_CHECKS: Record<string, Checks> = {
	ERROR: 'failing',
	EXPECTED: 'pending',
	FAILURE: 'failing',
	PENDING: 'pending',
	SUCCESS: 'passing'
}

const GITHUB_FILE_STATES: Record<string, FileChange['state']> = {ADDED: 'added', DELETED: 'removed', RENAMED: 'renamed'}

const GITHUB_REVIEWS: Record<string, Review> = {
	APPROVED: 'approved',
	CHANGES_REQUESTED: 'changes',
	REVIEW_REQUIRED: 'required'
}

const GITLAB_CHECKS: Record<string, Checks> = {
	canceled: 'failing',
	created: 'pending',
	failed: 'failing',
	pending: 'pending',
	preparing: 'pending',
	running: 'pending',
	success: 'passing'
}

const GITLAB_REVIEWS: Record<string, Review> = {discussions_not_resolved: 'changes', not_approved: 'required'}

// A host with a dot, then at least two path segments; GitLab subgroups stay in the path.
const REPO_SPEC = /^([^/\s,]+\.[^/\s,]+)\/((?:[^/\s,]+\/)+([^/\s,]+))$/u

export const githubQuery =
	'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(states:[OPEN,MERGED],first:60,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title url isDraft createdAt updatedAt mergedAt reviewDecision baseRefName headRefName additions deletions changedFiles comments{totalCount} author{login} labels(first:10){nodes{name}} commits(last:1){nodes{commit{statusCheckRollup{state}}}} files(first:100){nodes{path additions deletions changeType}}}}}}'

type GithubCommit = {readonly commit: {readonly statusCheckRollup: {readonly state: string} | null}}

type GithubFile = {
	readonly additions: number
	readonly changeType: string
	readonly deletions: number
	readonly path: string
}

type GithubPullRequest = {
	readonly additions: number
	readonly author: {readonly login: string} | null
	readonly baseRefName: string
	readonly changedFiles: number
	readonly comments: {readonly totalCount: number}
	readonly commits: {readonly nodes: readonly GithubCommit[]}
	readonly createdAt: DateTime.Utc
	readonly deletions: number
	readonly files: {readonly nodes: readonly GithubFile[]}
	readonly headRefName: string
	readonly isDraft: boolean
	readonly mergedAt: DateTime.Utc | null
	readonly number: number
	readonly reviewDecision: string | null
	readonly title: string
	readonly updatedAt: DateTime.Utc
	readonly url: string
}

type GitlabDiff = {
	readonly deleted_file: boolean
	readonly diff: string
	readonly new_file: boolean
	readonly new_path: string
	readonly renamed_file: boolean
}

type GitlabMergeRequest = {
	readonly author: {readonly name: string}
	readonly created_at: DateTime.Utc
	readonly detailed_merge_status?: string
	readonly draft?: boolean
	readonly head_pipeline: {readonly status: string} | null
	readonly iid: number
	readonly merged_at: DateTime.Utc | null
	readonly source_branch: string
	readonly target_branch: string
	readonly title: string
	readonly updated_at: DateTime.Utc
	readonly user_notes_count: number
	readonly web_url: string
}

export function specsOf(value: string) {
	return Array.filter(Array.map(String.split(value, ','), String.trim), String.isNonEmpty)
}

function repoOf(spec: string) {
	return pipe(
		String.match(REPO_SPEC)(spec),
		Option.flatMap(match =>
			Option.all({
				host: Option.fromUndefinedOr(match[1]),
				name: Option.fromUndefinedOr(match[3]),
				path: Option.fromUndefinedOr(match[2])
			})
		),
		Option.map(parts =>
			Repo.make({
				host: parts.host,
				id: `${parts.host}/${parts.path}`,
				name: parts.name,
				path: parts.path,
				provider: Boolean.match(parts.host === 'github.com', {
					onFalse: () => 'gitlab' as const,
					onTrue: () => 'github' as const
				}),
				url: `https://${parts.host}/${parts.path}`
			})
		)
	)
}

export function reposOf(specs: string) {
	return Array.getSomes(Array.map(specsOf(specs), repoOf))
}

function githubReviewOf(decision: string | null) {
	return Option.getOrElse(
		Option.flatMap(Option.fromNullishOr(decision), value => Record.get(GITHUB_REVIEWS, value)),
		() => 'none' as const
	)
}

function githubChecksOf(commits: readonly GithubCommit[]) {
	return Option.getOrElse(
		Option.flatMap(
			Option.flatMap(Array.head(commits), entry =>
				Option.map(Option.fromNullishOr(entry.commit.statusCheckRollup), rollup => rollup.state)
			),
			value => Record.get(GITHUB_CHECKS, value)
		),
		() => 'none' as const
	)
}

function githubFilesOf(node: GithubPullRequest) {
	if (Array.isReadonlyArrayNonEmpty(node.files.nodes)) {
		return Array.map(node.files.nodes, file =>
			FileChange.make({
				additions: file.additions,
				deletions: file.deletions,
				path: file.path,
				state: Option.getOrElse(Record.get(GITHUB_FILE_STATES, file.changeType), () => 'modified' as const)
			})
		)
	}
	// A pull request GitHub returns without file nodes still carries its churn into the map.
	if (node.changedFiles === 0) return []
	return [FileChange.make({additions: node.additions, deletions: node.deletions, path: '', state: 'modified' as const})]
}

function githubStateOf(node: GithubPullRequest) {
	return Option.match(Option.fromNullishOr(node.mergedAt), {
		onNone: () => Boolean.match(node.isDraft, {onFalse: () => 'open' as const, onTrue: () => 'draft' as const}),
		onSome: () => 'merged' as const
	})
}

function githubPullRequestOf(node: GithubPullRequest, repo: Repo, now: number) {
	const merged = Option.fromNullishOr(node.mergedAt)
	if (Option.exists(merged, value => DateTime.toEpochMillis(value) < now - 30 * 86_400_000)) {
		return Option.none<PullRequest>()
	}
	return Option.some(
		PullRequest.make({
			additions: node.additions,
			author: Option.getOrElse(
				Option.map(Option.fromNullishOr(node.author), value => value.login),
				() => ''
			),
			base: node.baseRefName,
			checks: githubChecksOf(node.commits.nodes),
			comments: node.comments.totalCount,
			createdAt: DateTime.formatIso(node.createdAt),
			deletions: node.deletions,
			files: githubFilesOf(node),
			head: node.headRefName,
			...Option.match(merged, {onNone: () => ({}), onSome: value => ({mergedAt: DateTime.formatIso(value)})}),
			number: node.number,
			repoId: repo.id,
			review: githubReviewOf(node.reviewDecision),
			state: githubStateOf(node),
			title: node.title,
			updatedAt: DateTime.formatIso(node.updatedAt),
			url: node.url
		})
	)
}

export function githubPullRequestsOf(json: string, repo: Repo, now: number) {
	return pipe(
		Schema.decodeEffect(
			Schema.fromJsonString(
				Schema.Struct({
					data: Schema.Struct({
						repository: Schema.Struct({
							pullRequests: Schema.Struct({
								nodes: Schema.Array(
									Schema.Struct({
										additions: Schema.Finite,
										author: Schema.NullOr(Schema.Struct({login: Schema.String})),
										baseRefName: Schema.String,
										changedFiles: Schema.Finite,
										comments: Schema.Struct({totalCount: Schema.Finite}),
										commits: Schema.Struct({
											nodes: Schema.Array(
												Schema.Struct({
													commit: Schema.Struct({
														statusCheckRollup: Schema.NullOr(Schema.Struct({state: Schema.String}))
													})
												})
											)
										}),
										createdAt: Schema.DateTimeUtcFromString,
										deletions: Schema.Finite,
										files: Schema.Struct({
											nodes: Schema.Array(
												Schema.Struct({
													additions: Schema.Finite,
													changeType: Schema.String,
													deletions: Schema.Finite,
													path: Schema.String
												})
											)
										}),
										headRefName: Schema.String,
										isDraft: Schema.Boolean,
										mergedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
										number: Schema.Finite,
										reviewDecision: Schema.NullOr(Schema.String),
										title: Schema.String,
										updatedAt: Schema.DateTimeUtcFromString,
										url: Schema.String
									})
								)
							})
						})
					})
				})
			)
		)(json),
		Effect.mapBoth({
			onFailure: cause => AtlasError.make({cause, message: `Cannot read GitHub pull requests from ${repo.id}`}),
			onSuccess: payload =>
				Array.getSomes(
					Array.map(payload.data.repository.pullRequests.nodes, node => githubPullRequestOf(node, repo, now))
				)
		})
	)
}

function gitlabChecksOf(pipeline: {readonly status: string} | null) {
	return Option.getOrElse(
		Option.flatMap(Option.fromNullishOr(pipeline), value => Record.get(GITLAB_CHECKS, value.status)),
		() => 'none' as const
	)
}

function gitlabReviewOf(status?: string) {
	return Option.getOrElse(
		Option.flatMap(Option.fromUndefinedOr(status), value => Record.get(GITLAB_REVIEWS, value)),
		() => 'none' as const
	)
}

function gitlabStateOf(mr: GitlabMergeRequest) {
	if (Option.isSome(Option.fromNullishOr(mr.merged_at))) return 'merged'
	if (mr.draft === true) return 'draft'
	return 'open'
}

function gitlabPullRequestOf(mr: GitlabMergeRequest, repo: Repo) {
	return PullRequest.make({
		additions: 0,
		author: mr.author.name,
		base: mr.target_branch,
		checks: gitlabChecksOf(mr.head_pipeline),
		comments: mr.user_notes_count,
		createdAt: DateTime.formatIso(mr.created_at),
		deletions: 0,
		files: [],
		head: mr.source_branch,
		...Option.match(Option.fromNullishOr(mr.merged_at), {
			onNone: () => ({}),
			onSome: merged => ({mergedAt: DateTime.formatIso(merged)})
		}),
		number: mr.iid,
		repoId: repo.id,
		review: gitlabReviewOf(mr.detailed_merge_status),
		state: gitlabStateOf(mr),
		title: mr.title,
		updatedAt: DateTime.formatIso(mr.updated_at),
		url: mr.web_url
	})
}

export function gitlabPullRequestsOf(json: string, repo: Repo) {
	return pipe(
		Schema.decodeEffect(
			Schema.fromJsonString(
				Schema.Array(
					Schema.Struct({
						author: Schema.Struct({name: Schema.String}),
						created_at: Schema.DateTimeUtcFromString,
						detailed_merge_status: Schema.optionalKey(Schema.String),
						draft: Schema.optionalKey(Schema.Boolean),
						head_pipeline: Schema.NullOr(Schema.Struct({status: Schema.String})),
						iid: Schema.Finite,
						labels: Schema.Array(Schema.Union([Schema.String, Schema.Struct({name: Schema.String})])),
						merged_at: Schema.NullOr(Schema.DateTimeUtcFromString),
						source_branch: Schema.String,
						target_branch: Schema.String,
						title: Schema.String,
						updated_at: Schema.DateTimeUtcFromString,
						user_notes_count: Schema.Finite,
						web_url: Schema.String
					})
				)
			)
		)(json),
		Effect.mapBoth({
			onFailure: cause => AtlasError.make({cause, message: `Cannot read GitLab merge requests from ${repo.id}`}),
			onSuccess: mergeRequests => Array.map(mergeRequests, mr => gitlabPullRequestOf(mr, repo))
		})
	)
}

function diffCounts(diff: string) {
	const lines = String.split(diff, '\n')
	return {
		additions: Array.countBy(lines, line => String.startsWith('+')(line) && !String.startsWith('+++')(line)),
		deletions: Array.countBy(lines, line => String.startsWith('-')(line) && !String.startsWith('---')(line))
	}
}

function gitlabFileStateOf(diff: GitlabDiff) {
	if (diff.renamed_file) return 'renamed' as const
	if (diff.new_file) return 'added' as const
	if (diff.deleted_file) return 'removed' as const
	return 'modified' as const
}

export function gitlabFilesOf(json: string) {
	return pipe(
		Schema.decodeEffect(
			Schema.fromJsonString(
				Schema.Array(
					Schema.Struct({
						deleted_file: Schema.Boolean,
						diff: Schema.String,
						new_file: Schema.Boolean,
						new_path: Schema.String,
						old_path: Schema.String,
						renamed_file: Schema.Boolean
					})
				)
			)
		)(json),
		Effect.mapBoth({
			onFailure: cause => AtlasError.make({cause, message: 'Cannot read GitLab merge request diffs'}),
			onSuccess: diffs =>
				Array.map(diffs, diff => {
					const counts = diffCounts(diff.diff)
					return FileChange.make({
						additions: counts.additions,
						deletions: counts.deletions,
						path: diff.new_path,
						state: gitlabFileStateOf(diff)
					})
				})
		})
	)
}

export function withGitlabFiles(pr: PullRequest, files: FileChange[]) {
	return PullRequest.make({
		...pr,
		additions: Array.reduce(files, 0, (total, file) => total + file.additions),
		deletions: Array.reduce(files, 0, (total, file) => total + file.deletions),
		files: Array.take(files, 100)
	})
}
