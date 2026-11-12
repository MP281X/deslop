import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	ConfigProvider,
	Context,
	DateTime,
	Effect,
	Layer,
	Option,
	Redacted,
	Ref,
	Sink,
	Stream,
	String,
	pipe
} from 'effect'

import {ChildProcess, ChildProcessSpawner} from 'effect/process'
import {TestClock} from 'effect/testing'

import {Changes} from '#services/changes/service.ts'

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

const GITHUB_REFRESHED_FIXTURE = `{
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
						"commits": {"nodes": [{"commit": {"statusCheckRollup": {"state": "SUCCESS"}}}]},
						"createdAt": "2026-11-01T10:00:00Z",
						"deletions": 3,
						"files": {"nodes": [{"additions": 12, "changeType": "MODIFIED", "deletions": 3, "path": "apps/atlas/src/lib/utils.ts"}]},
						"headRefName": "atlas",
						"isDraft": true,
						"mergedAt": null,
						"number": 7,
						"reviewDecision": "REVIEW_REQUIRED",
						"title": "Atlas changes, refreshed",
						"updatedAt": "2026-11-02T10:00:00Z",
						"url": "https://github.com/MP281X/deslop/pull/7"
					}
				]
			}
		}
	}
}`

const GITLAB_OPENED_FIXTURE = `[
	{
		"author": {"name": "dev"},
		"created_at": "2026-11-02T09:00:00Z",
		"detailed_merge_status": "discussions_not_resolved",
		"draft": false,
		"head_pipeline": {"status": "success"},
		"iid": 12,
		"labels": ["bug"],
		"merged_at": null,
		"source_branch": "feature",
		"target_branch": "main",
		"title": "Dual changes",
		"updated_at": "2026-11-03T09:00:00Z",
		"user_notes_count": 4,
		"web_url": "https://git.datapizza.tech/dual/dual/-/merge_requests/12"
	}
]`

const GITLAB_MERGED_FIXTURE = `[
	{
		"author": {"name": "dev"},
		"created_at": "2026-11-01T09:00:00Z",
		"detailed_merge_status": "mergeable",
		"draft": false,
		"head_pipeline": null,
		"iid": 11,
		"labels": [],
		"merged_at": "2026-11-05T09:00:00Z",
		"source_branch": "old",
		"target_branch": "main",
		"title": "Merged change",
		"updated_at": "2026-11-05T09:00:00Z",
		"user_notes_count": 0,
		"web_url": "https://git.datapizza.tech/dual/dual/-/merge_requests/11"
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
		"diff": "--- a/apps/api/src/old-b.ts\\n+++ b/apps/api/src/b.ts\\n@@ -1 +1 @@\\n-before\\n+after",
		"new_file": false,
		"new_path": "apps/api/src/b.ts",
		"old_path": "apps/api/src/old-b.ts",
		"renamed_file": true
	}
]`

type Fixtures = {
	readonly diffCalls: Ref.Ref<number>
	readonly ghCalls: Ref.Ref<number>
	readonly github: Ref.Ref<string>
	readonly glabFails: Ref.Ref<boolean>
}

function textOf(word?: ChildProcess.StandardCommand['args'][number]) {
	if (word === undefined) return ''
	if (String.isString(word)) return word
	return Redacted.value(word)
}

function handleOf(text: string, code: number, failure: string) {
	return ChildProcessSpawner.makeHandle({
		all: Stream.empty,
		exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(code)),
		getInputFd: () => Sink.drain,
		getOutputFd: () => Stream.empty,
		isRunning: Effect.succeed(false),
		kill: () => Effect.void,
		pid: ChildProcessSpawner.ProcessId(1),
		stderr: Stream.make(new TextEncoder().encode(failure)),
		stdin: Sink.drain,
		stdout: Stream.make(new TextEncoder().encode(text)),
		unref: Effect.succeed(Effect.void)
	})
}

function fixtureOf(request: string) {
	if (String.includes('/diffs')(request)) return GITLAB_DIFFS_FIXTURE
	if (String.includes('state=merged')(request)) return GITLAB_MERGED_FIXTURE
	return GITLAB_OPENED_FIXTURE
}

function spawnerOf(fixtures: Fixtures) {
	return ChildProcessSpawner.make(command =>
		Effect.gen(function* () {
			if (!ChildProcess.isStandardCommand(command)) return yield* Effect.die('Unexpected pipeline')
			const request = textOf(command.args[3])
			if (command.command === 'gh') {
				yield* Ref.update(fixtures.ghCalls, count => count + 1)
				return handleOf(yield* Ref.get(fixtures.github), 0, '')
			}
			if (String.includes('/diffs')(request)) {
				yield* Ref.update(fixtures.diffCalls, count => count + 1)
			}
			if (yield* Ref.get(fixtures.glabFails)) return handleOf('', 1, 'not signed in')
			return handleOf(fixtureOf(request), 0, '')
		})
	)
}

function layerOf(spawner: ReturnType<typeof spawnerOf>) {
	return pipe(
		Changes.layer,
		Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
		Layer.provide(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({ATLAS_REPOS: 'github.com/MP281X/deslop,git.datapizza.tech/dual/dual'})
			)
		)
	)
}

const fixturesOf = Effect.gen(function* () {
	return {
		diffCalls: yield* Ref.make(0),
		ghCalls: yield* Ref.make(0),
		github: yield* Ref.make(GITHUB_FIXTURE),
		glabFails: yield* Ref.make(false)
	} satisfies Fixtures
})

const NOW = DateTime.toEpochMillis(DateTime.makeUnsafe('2026-11-12T00:00:00Z'))

it.layer(NodeServices.layer)('Changes', test => {
	test.effect(
		'reads GitHub and GitLab pull requests in one snapshot',
		Effect.fnUntraced(function* () {
			yield* TestClock.setTime(NOW)
			const snapshot = yield* Context.get(yield* Layer.build(layerOf(spawnerOf(yield* fixturesOf))), Changes).snapshot
			const github = Option.getOrThrow(Array.findFirst(snapshot.repos, state => state.repo.provider === 'github'))
			const gitlab = Option.getOrThrow(Array.findFirst(snapshot.repos, state => state.repo.provider === 'gitlab'))
			assert.isUndefined(github.problem)
			assert.isUndefined(gitlab.problem)
			assert.deepStrictEqual(
				Array.map(github.pullRequests, pr => [pr.number, pr.state, pr.review, pr.checks]),
				[[7, 'draft', 'required', 'pending']]
			)
			assert.deepStrictEqual(
				Array.map(gitlab.pullRequests, pr => [pr.number, pr.state]),
				[
					[12, 'open'],
					[11, 'merged']
				]
			)
			const opened = Option.getOrThrow(Array.findFirst(gitlab.pullRequests, pr => pr.number === 12))
			assert.deepStrictEqual(
				[opened.additions, opened.deletions, Array.map(opened.files, file => file.state)],
				[3, 2, ['modified', 'renamed']]
			)
			const merged = Option.getOrThrow(Array.findFirst(gitlab.pullRequests, pr => pr.number === 11))
			assert.strictEqual(merged.checks, 'none')
			assert.isDefined(merged.mergedAt)
		})
	)
	test.effect(
		'keeps the previous GitLab rows and problem when glab fails, while GitHub refreshes',
		Effect.fnUntraced(function* () {
			yield* TestClock.setTime(NOW)
			const fixtures = yield* fixturesOf
			const changes = Context.get(yield* Layer.build(layerOf(spawnerOf(fixtures))), Changes)
			const firstGitlab = Option.getOrThrow(
				Array.findFirst((yield* changes.snapshot).repos, state => state.repo.provider === 'gitlab')
			)
			yield* Ref.set(fixtures.glabFails, true)
			yield* Ref.set(fixtures.github, GITHUB_REFRESHED_FIXTURE)
			const second = yield* changes.snapshot
			const github = Option.getOrThrow(Array.findFirst(second.repos, state => state.repo.provider === 'github'))
			const gitlab = Option.getOrThrow(Array.findFirst(second.repos, state => state.repo.provider === 'gitlab'))
			assert.deepStrictEqual(gitlab.pullRequests, firstGitlab.pullRequests)
			assert.isString(gitlab.problem)
			assert.deepStrictEqual(
				Array.map(github.pullRequests, pr => pr.title),
				['Atlas changes, refreshed']
			)
		})
	)
	test.effect(
		'reuses cached GitLab diffs on a later snapshot',
		Effect.fnUntraced(function* () {
			yield* TestClock.setTime(NOW)
			const fixtures = yield* fixturesOf
			const changes = Context.get(yield* Layer.build(layerOf(spawnerOf(fixtures))), Changes)
			const firstGitlab = Option.getOrThrow(
				Array.findFirst((yield* changes.snapshot).repos, state => state.repo.provider === 'gitlab')
			)
			assert.strictEqual(yield* Ref.get(fixtures.diffCalls), 2)
			const secondGitlab = Option.getOrThrow(
				Array.findFirst((yield* changes.snapshot).repos, state => state.repo.provider === 'gitlab')
			)
			assert.strictEqual(yield* Ref.get(fixtures.diffCalls), 2)
			assert.strictEqual(yield* Ref.get(fixtures.ghCalls), 2)
			assert.deepStrictEqual(secondGitlab.pullRequests, firstGitlab.pullRequests)
		})
	)
})
