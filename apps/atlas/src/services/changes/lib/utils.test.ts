import {assert, it} from '@effect/vitest'

import {Array, DateTime, Effect, Option} from 'effect'

import {
	githubPullRequestsOf,
	gitlabFilesOf,
	gitlabPullRequestsOf,
	reposOf,
	specsOf,
	withGitlabFiles
} from '#services/changes/lib/utils.ts'
import {AtlasError, PullRequest, Repo} from '#services/changes/schema.ts'

const GITHUB_FIXTURE = `{
	"data": {
		"repository": {
			"pullRequests": {
				"nodes": [
					{
						"additions": 12,
						"author": {"login": "dev"},
						"baseRefName": "main",
						"changedFiles": 1,
						"comments": {"totalCount": 2},
						"commits": {"nodes": [{"commit": {"statusCheckRollup": {"state": "PENDING"}}}]},
						"createdAt": "2026-11-01T10:00:00Z",
						"deletions": 3,
						"files": {"nodes": [{"additions": 12, "changeType": "MODIFIED", "deletions": 3, "path": "apps/atlas/src/lib/utils.ts"}]},
						"headRefName": "atlas",
						"isDraft": true,
						"mergedAt": null,
						"number": 7,
						"reviewDecision": "REVIEW_REQUIRED",
						"title": "Atlas changes",
						"updatedAt": "2026-11-02T10:00:00Z",
						"url": "https://github.com/MP281X/deslop/pull/7"
					}
				]
			}
		}
	}
}`

const GITLAB_MERGE_REQUESTS_FIXTURE = `[
	{
		"author": {"name": "dev"},
		"created_at": "2026-11-02T09:00:00Z",
		"detailed_merge_status": "discussions_not_resolved",
		"draft": false,
		"head_pipeline": {"status": "success"},
		"iid": 12,
		"labels": ["bug", {"name": "ui"}],
		"merged_at": null,
		"source_branch": "feature",
		"target_branch": "main",
		"title": "Dual changes",
		"updated_at": "2026-11-03T09:00:00Z",
		"user_notes_count": 4,
		"web_url": "https://git.datapizza.tech/dual/dual/-/merge_requests/12"
	}
]`

const GITLAB_DIFFS_FIXTURE = `[
	{
		"deleted_file": false,
		"diff": "--- a/apps/api/src/a.ts\\n+++ b/apps/api/src/a.ts\\n@@ -1,2 +1,3 @@\\n context\\n-old\\n+new\\n+more",
		"new_file": false,
		"new_path": "apps/api/src/a.ts",
		"old_path": "apps/api/src/a.ts",
		"renamed_file": false
	},
	{
		"deleted_file": false,
		"diff": "--- /dev/null\\n+++ b/apps/api/src/b.ts\\n@@ -0,0 +1 @@\\n+added",
		"new_file": true,
		"new_path": "apps/api/src/b.ts",
		"old_path": "apps/api/src/b.ts",
		"renamed_file": false
	},
	{
		"deleted_file": true,
		"diff": "--- a/apps/api/src/c.ts\\n+++ /dev/null\\n@@ -1 +0,0 @@\\n-removed",
		"new_file": false,
		"new_path": "apps/api/src/c.ts",
		"old_path": "apps/api/src/c.ts",
		"renamed_file": false
	},
	{
		"deleted_file": false,
		"diff": "--- a/apps/api/src/old-d.ts\\n+++ b/apps/api/src/d.ts\\n@@ -1 +1 @@\\n-before\\n+after",
		"new_file": false,
		"new_path": "apps/api/src/d.ts",
		"old_path": "apps/api/src/old-d.ts",
		"renamed_file": true
	}
]`

const GITHUB_REPO = Repo.make({
	host: 'github.com',
	id: 'github.com/MP281X/deslop',
	name: 'deslop',
	path: 'MP281X/deslop',
	provider: 'github',
	url: 'https://github.com/MP281X/deslop'
})

const GITLAB_REPO = Repo.make({
	host: 'git.datapizza.tech',
	id: 'git.datapizza.tech/dual/dual',
	name: 'dual',
	path: 'dual/dual',
	provider: 'gitlab',
	url: 'https://git.datapizza.tech/dual/dual'
})

it('splits repository specs and skips malformed ones', () => {
	assert.deepStrictEqual(specsOf(' github.com/MP281X/deslop , git.datapizza.tech/dual/dual ,, nope.com '), [
		'github.com/MP281X/deslop',
		'git.datapizza.tech/dual/dual',
		'nope.com'
	])
	assert.deepStrictEqual(reposOf(' github.com/MP281X/deslop , git.datapizza.tech/dual/dual , nope.com , bad/one '), [
		GITHUB_REPO,
		GITLAB_REPO
	])
})

it.effect(
	'maps a GitHub GraphQL payload into a draft pull request',
	Effect.fnUntraced(function* () {
		assert.deepStrictEqual(
			yield* githubPullRequestsOf(
				GITHUB_FIXTURE,
				GITHUB_REPO,
				DateTime.toEpochMillis(DateTime.makeUnsafe('2026-11-12T00:00:00Z'))
			),
			[
				PullRequest.make({
					additions: 12,
					author: 'dev',
					base: 'main',
					checks: 'pending',
					comments: 2,
					createdAt: '2026-11-01T10:00:00.000Z',
					deletions: 3,
					files: [{additions: 12, deletions: 3, path: 'apps/atlas/src/lib/utils.ts', state: 'modified'}],
					head: 'atlas',
					number: 7,
					repoId: 'github.com/MP281X/deslop',
					review: 'required',
					state: 'draft',
					title: 'Atlas changes',
					updatedAt: '2026-11-02T10:00:00.000Z',
					url: 'https://github.com/MP281X/deslop/pull/7'
				})
			]
		)
	})
)

it.effect(
	'maps GitLab merge requests and diffs into counts and file states',
	Effect.fnUntraced(function* () {
		const pullRequest = withGitlabFiles(
			Option.getOrThrow(Array.head(yield* gitlabPullRequestsOf(GITLAB_MERGE_REQUESTS_FIXTURE, GITLAB_REPO))),
			yield* gitlabFilesOf(GITLAB_DIFFS_FIXTURE)
		)
		assert.deepStrictEqual(
			[pullRequest.additions, pullRequest.deletions, pullRequest.review, pullRequest.checks, pullRequest.comments],
			[4, 3, 'changes', 'passing', 4]
		)
		assert.deepStrictEqual(
			Array.map(pullRequest.files, file => [file.path, file.state]),
			[
				['apps/api/src/a.ts', 'modified'],
				['apps/api/src/b.ts', 'added'],
				['apps/api/src/c.ts', 'removed'],
				['apps/api/src/d.ts', 'renamed']
			]
		)
	})
)

it.effect(
	'reports malformed JSON as AtlasError',
	Effect.fnUntraced(function* () {
		assert.instanceOf(yield* Effect.flip(githubPullRequestsOf('{}', GITHUB_REPO, 0)), AtlasError)
	})
)
