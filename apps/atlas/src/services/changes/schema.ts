import {Schema} from 'effect'

export class AtlasError extends Schema.TaggedError<AtlasError>()('AtlasError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type Provider = typeof Provider.Type
export const Provider = Schema.Literals(['github', 'gitlab'])

export type Repo = typeof Repo.Type
export const Repo = Schema.Struct({
	host: Schema.String,
	id: Schema.String,
	name: Schema.String,
	path: Schema.String,
	provider: Provider,
	url: Schema.String
})

export type ChangeState = typeof ChangeState.Type
export const ChangeState = Schema.Literals(['open', 'draft', 'merged'])

export type Review = typeof Review.Type
export const Review = Schema.Literals(['approved', 'changes', 'required', 'none'])

export type Checks = typeof Checks.Type
export const Checks = Schema.Literals(['passing', 'failing', 'pending', 'none'])

export type FileChange = typeof FileChange.Type
export const FileChange = Schema.Struct({
	additions: Schema.Finite,
	deletions: Schema.Finite,
	path: Schema.String,
	state: Schema.Literals(['added', 'modified', 'removed', 'renamed'])
})

export type PullRequest = typeof PullRequest.Type
export const PullRequest = Schema.Struct({
	additions: Schema.Finite,
	author: Schema.String,
	base: Schema.String,
	checks: Checks,
	comments: Schema.Finite,
	createdAt: Schema.String,
	deletions: Schema.Finite,
	files: Schema.Array(FileChange),
	head: Schema.String,
	mergedAt: Schema.optionalKey(Schema.String),
	number: Schema.Finite,
	repoId: Schema.String,
	review: Review,
	state: ChangeState,
	title: Schema.String,
	updatedAt: Schema.String,
	url: Schema.String
})

export type RepoState = typeof RepoState.Type
export const RepoState = Schema.Struct({
	problem: Schema.optionalKey(Schema.String),
	pullRequests: Schema.Array(PullRequest),
	repo: Repo
})

export type Snapshot = typeof Snapshot.Type
export const Snapshot = Schema.Struct({fetchedAt: Schema.String, repos: Schema.Array(RepoState)})

export type RepoSpecList = typeof RepoSpecList.Type
// `--repos github.com/owner/name,gitlab.example.com/group/subgroup/project`: each host has a dot and each path at least two segments.
export const RepoSpecList = Schema.String.check(
	Schema.isPattern(
		/^(?:[^\s,/]+\.[^\s,/]+\/[^\s,/]+(?:\/[^\s,/]+)+)(?:,(?:[^\s,/]+\.[^\s,/]+\/[^\s,/]+(?:\/[^\s,/]+)+))*$/u
	)
)
