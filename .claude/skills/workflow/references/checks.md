# Checks

**Scope.** Run assigned commands/behaviors from repository root; testing owns selection and rerun judgment. Serialize checks that compete for resources or mutate shared artifacts; independent stable-input checks may overlap. Use environment's root commands; no second suite.

**Return.** Give actual criterion outcomes and decisive command/exit evidence, distinguishing cached from fresh execution and failed/skipped from passed. Link useful logs; no dumps, progress diary or mandatory report template.

## Commands

Collect the owned command's terminal result and exit status, not a log footer or process search. Use the harness's returned session/cell identity and supported wait tools for long commands; do not spawn a checking agent merely to wait. Servers/stacks use readiness probes.

## Publishing

**Describe once.** Explain the final branch's changed contracts with linked owning files and useful before/after examples. Group related changes; identify generated copies without describing their behavior again. Keep risks beside the affected change and collapse supporting proof. No second reading map, prose retelling of examples, formatting inventory or lifecycle facts T3 already shows. Distinguish recommended patterns from valid edge cases and stress-test fixtures.

Bodies/comments use scratch files and `--body-file` (GitLab: `--description-file`). Attach images with descriptive alt text; GitHub video uses bare `--attach '<file>'`. Read the resulting title/body back.

```bash
gh pr edit --body-file <scratch>/body.md --attach '<file>#<alt text>'
glab mr update <number> --draft --description-file <scratch>/body.md --attach <file>
```

`glab` takes no `--jq`: pipe its API output into `jq`. Verify the published head, title/body and changed-file inventory against the branch. Investigate full hosted patches only for a concrete rendering/missing-diff problem, not every push. Passing CI does not prove a UI rendered the diff. Link every PR layer to T3. Resolve actionable review findings; use its PR UI/watch instead of another status ledger.

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
