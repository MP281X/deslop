import {
	Array,
	Boolean,
	Clock,
	Config,
	Context,
	DateTime,
	Effect,
	Layer,
	Option,
	Record,
	Ref,
	String,
	pipe
} from 'effect'

import {ChildProcessSpawner} from 'effect/process'

import {execute} from '@deslop/runtime/cli/service'

import {
	githubPullRequestsOf,
	githubQuery,
	gitlabFilesOf,
	gitlabPullRequestsOf,
	reposOf,
	withGitlabFiles
} from '#services/changes/lib/utils.ts'
import {AtlasError, RepoSpecList, RepoState, Snapshot} from '#services/changes/schema.ts'
import type {FileChange, PullRequest, Repo} from '#services/changes/schema.ts'

const THIRTY_DAYS = 30 * 86_400_000

type DiffCache = Record<string, {readonly fetchedAt: number; readonly files: FileChange[]}>

function diffKey(repo: Repo, number: number) {
	return `${repo.id}#${number}`
}

export class Changes extends Context.Service<Changes, {readonly snapshot: Effect.Effect<Snapshot>}>()(
	'@deslop/atlas/services/changes/service/Changes'
) {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			const repos = reposOf(
				yield* Config.withDefault(
					Config.schema(RepoSpecList, 'ATLAS_REPOS'),
					'github.com/MP281X/deslop,git.datapizza.tech/dual/dual'
				)
			)
			const diffs = yield* Ref.make<DiffCache>({})
			const previous = yield* Ref.make<Record<string, PullRequest[]>>({})
			function command(name: string, args: string[]) {
				return pipe(
					execute(name, args),
					Effect.mapError(cause => AtlasError.make({cause, message: cause.message})),
					Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
				)
			}
			const fetchDiffs = Effect.fnUntraced(function* (repo: Repo, number: number, now: number) {
				const text = yield* command('glab', [
					'api',
					'--hostname',
					repo.host,
					`projects/${encodeURIComponent(repo.path)}/merge_requests/${number}/diffs?per_page=100`
				])
				const files = yield* gitlabFilesOf(text)
				yield* Ref.update(diffs, current => ({...current, [diffKey(repo, number)]: {fetchedAt: now, files}}))
				return files
			})
			const withFiles = Effect.fnUntraced(function* (repo: Repo, pr: PullRequest, now: number) {
				const files = yield* Option.match(Record.get(yield* Ref.get(diffs), diffKey(repo, pr.number)), {
					onNone: () => fetchDiffs(repo, pr.number, now),
					onSome: entry =>
						Boolean.match(now - entry.fetchedAt < 10 * 60_000, {
							onFalse: () => fetchDiffs(repo, pr.number, now),
							onTrue: () => Effect.succeed(entry.files)
						})
				})
				return withGitlabFiles(pr, files)
			})
			const fetchGithub = Effect.fnUntraced(function* (repo: Repo, now: number) {
				const text = yield* command('gh', [
					'api',
					'graphql',
					'-f',
					`query=${githubQuery}`,
					'-F',
					`owner=${String.split(repo.path, '/')[0]}`,
					'-F',
					`name=${repo.name}`
				])
				return yield* githubPullRequestsOf(text, repo, now)
			})
			const fetchGitlab = Effect.fnUntraced(function* (repo: Repo, now: number) {
				const project = `projects/${encodeURIComponent(repo.path)}`
				const lists = yield* Effect.forEach(
					[
						`${project}/merge_requests?state=opened&per_page=50&order_by=updated_at&sort=desc`,
						`${project}/merge_requests?state=merged&per_page=50&order_by=updated_at&sort=desc&updated_after=${DateTime.formatIso(DateTime.makeUnsafe(now - THIRTY_DAYS))}`
					],
					request => command('glab', ['api', '--hostname', repo.host, request]),
					{concurrency: 2}
				)
				const mergeRequests = Array.flatten(
					yield* Effect.forEach(lists, text => gitlabPullRequestsOf(text, repo), {concurrency: 2})
				)
				return yield* Effect.forEach(
					Array.filter(mergeRequests, pr =>
						Option.match(Option.fromUndefinedOr(pr.mergedAt), {
							onNone: () => true,
							onSome: mergedAt => DateTime.toEpochMillis(DateTime.makeUnsafe(mergedAt)) >= now - THIRTY_DAYS
						})
					),
					pr => withFiles(repo, pr, now),
					{concurrency: 4}
				)
			})
			const repository = Effect.fnUntraced(function* (repo: Repo, now: number, before: Record<string, PullRequest[]>) {
				return yield* pipe(
					Boolean.match(repo.provider === 'github', {
						onFalse: () => fetchGitlab(repo, now),
						onTrue: () => fetchGithub(repo, now)
					}),
					Effect.timeout('45 seconds'),
					Effect.tap(pullRequests => Ref.update(previous, current => ({...current, [repo.id]: pullRequests}))),
					Effect.match({
						onFailure: cause =>
							RepoState.make({
								problem: String.slice(0, 160)(cause.message),
								pullRequests: Option.getOrElse(Record.get(before, repo.id), () => []),
								repo
							}),
						onSuccess: pullRequests => RepoState.make({pullRequests, repo})
					})
				)
			})
			return Changes.of({
				snapshot: Effect.scoped(
					Effect.gen(function* () {
						const now = yield* Clock.currentTimeMillis
						const before = yield* Ref.get(previous)
						const states = yield* Effect.forEach(repos, repo => repository(repo, now, before), {concurrency: 2})
						return Snapshot.make({fetchedAt: DateTime.formatIso(DateTime.makeUnsafe(now)), repos: states})
					})
				)
			})
		})
	)
}
