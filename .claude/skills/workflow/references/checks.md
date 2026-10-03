# Checks

**Scope.** Run assigned commands/behaviors from repository root; testing owns selection and rerun judgment. Checks and rule fixtures run sequentially. Use environment's root commands; no second suite.

## Result

- **Verdict.** Actual criterion outcomes, not a green log footer.
- **Evidence.** Criterion | Observed result | Command/exit; identify cache replay versus fresh execution.
- **Gaps.** Failed/skipped criteria and unresolved cause; links to decisive logs, no dumps/progress diary.

## Commands

Collect the owned command's terminal result and exit status, not a log footer or process search. Codex long commands use an exec cell starting with `// @exec: {"yield_time_ms": 1500000}`: await exec_command, then write_stdin at that yield until exit_code exists; wait on the cell if it yields. Servers/stacks use short yields and readiness probes.

## Publishing

**Map.** Explain the whole branch: every semantic/config change and its final package/file, not only highlights. Link folders/entry files; separate moves/generated copies from changed logic, omit formatting-only noise. Prefer readable tables/lists to compressed tree art. Show small before/after code examples when they make a semantic change easier to judge; distinguish recommended patterns from valid edge cases and stress-test fixtures. The description should explain behavior without requiring diff reading or imagining an example.

**Reason.** Briefly state consequential choices and tradeoffs. Keep risks visible; collapse supporting rationale, behavioral evidence and secondary paths in `<details>`. Omit lifecycle/green-check facts and benchmark diaries T3 already supplies. Report failures/unproved contracts; no user testing chore. Publish for review only when owned proof and fixes are complete.

Bodies/comments use scratch files and `--body-file` (GitLab: `--description-file`). Attach images with descriptive alt text; GitHub video uses bare `--attach '<file>'`. Read the resulting title/body back.

```bash
gh pr edit --body-file <scratch>/body.md --attach '<file>#<alt text>'
glab mr update <number> --draft --description-file <scratch>/body.md --attach <file>
```

`glab` takes no `--jq`: pipe its API output into `jq`. Compare every hosted diff page against the local merge-base file inventory; investigate missing patches and GitLab `collapsed`/`too_large` flags. Passing CI or raw diffs do not prove the user's T3 PR tab exposes every changed hunk. Link every PR layer to the thread.

## Pipeline watch

If `watch_pull_request` is available, the primary thread registers the PR watch and ends its turn. A delegated checker returns this monitoring requirement to the primary instead of registering a watch on its child thread. T3 wakes the thread that registered the watch for check failures, completed checks, new comments/reviews or conflicts; inspect the event and read only relevant failed-job logs. Do not spawn a blocking child or poll alongside that watch.

Without an app-owned watcher, wait for a pipeline with one blocking command, run in the background with a `timeout` of 7200000, then read only the failed jobs' logs.

GitHub:

```bash
SHA=$(git rev-parse HEAD)
ID=$(gh run list --commit "$SHA" --json databaseId -q '.[0].databaseId')
: "${ID:?No workflow run exists for this commit}"
gh run watch "$ID" --exit-status --compact
```

If no run exists, inspect the workflow trigger instead of polling an empty lookup. After a failed watch, read its failed logs with `gh run view "$ID" --log-failed`; keep the watch's failure status.

GitLab:

```bash
glab ci status --wait --compact
ID=$(glab api "projects/dual%2Fdual/pipelines?ref=$(git branch --show-current)&per_page=1" | jq -r '.[0].id')
glab api "projects/dual%2Fdual/pipelines/$ID/jobs?scope[]=failed" | jq -r '.[] | "\(.id) \(.name)"'
glab ci trace <job id>
```

## Isolated baseline check

An extra worktree is for a base check or a prototype needing incompatible source, dependency or build inputs—not merely parallel work:

```bash
W="$HOME/.deslop/$(basename "$PWD")/<name>"
git worktree add --detach "$W" origin/<default branch> && (cd "$W" && vp install)
```

Remove it as soon as its question is settled: `git worktree remove --force "$W"`.
