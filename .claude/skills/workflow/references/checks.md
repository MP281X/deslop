# Checks

Run the assigned commands or behavior steps; use testing for selectors, failure inventory and rerun judgment. Checks and rule-fixture tests run sequentially. Use the supplied repository commands, or its environment reference if missing. Return criterion outcomes, commands/exits and blockers.

**Result.** Verdict first, then Criterion | Observed result | Command/exit. Keep failed and skipped criteria explicit; link relevant logs rather than dumping them. List only unresolved blockers, not routine progress.

## Commands

Collect the owned command's terminal result and exit status, not a log footer or process search. Codex long commands use an exec cell starting with `// @exec: {"yield_time_ms": 1500000}`: await exec_command, then write_stdin at that yield until exit_code exists; wait on the cell if it yields. Servers/stacks use short yields and readiness probes.

## Publishing

Bodies/comments use scratch files and `--body-file` (GitLab: `--description-file`). Attach images with descriptive alt text; GitHub video uses bare `--attach '<file>'`. Read the resulting title/body back.

```bash
gh pr edit --body-file <scratch>/body.md --attach '<file>#<alt text>'
glab mr update <number> --draft --description-file <scratch>/body.md --attach <file>
```

`glab` takes no `--jq`: pipe its API output into `jq`. Compare every hosted diff page against the local merge-base file inventory; investigate missing patches and GitLab `collapsed`/`too_large` flags. Passing CI or raw diffs do not prove the user's T3 PR tab exposes every changed hunk. Link every PR layer to the thread.

## Pipeline watch

Wait for a pipeline with one blocking command, run in the background with a `timeout` of 7200000, then read only the failed jobs' logs.

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
