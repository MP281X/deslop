# Checks

**Scope.** Run the assigned commands and behaviors from the repository root; testing owns which checks to select and when to rerun. Run checks one after another when they compete for resources or write shared artifacts; independent checks on source that nobody is editing may overlap. Use the root commands from environment, not a second suite.

**Return.** Return the outcome for each criterion with its command and exit status. Say which results were cached and which ran fresh, and which checks failed, were skipped or passed.

## Commands

Take the result and exit status from the command you started, not from a log footer or a process search. Prefer scoped searches and the tool's own structured or quiet output. Keep bulky logs in scratch and read the part that decides the question. Keep raw failure diagnostics and the exit status; filtering output must never hide a failure. Wait on the session or cell identity a command returns, and do not spawn an agent only to wait. Servers and stacks need readiness probes.

## Publishing

Publish only after workflow's conditions for local iteration and completion are met. An unfinished requirement stays local and blocks publication; it does not go into an "unverified claims" section. Remove claims you cannot support, and do not hide defects or skipped required checks to make the body look complete. A defect newly found in an existing pull request stays visible until it is resolved.

Keep the body in sync with the contracts that the final branch changes, not with its iteration history. Follow Pair's rules on where facts belong and which evidence to show, so that nobody needs the chat history to understand the pull request. Keep consequential risks even when they sit in mechanically changed files. Do not use a required summary, map or table template, or a catch-all "proof and limits" section.

Write bodies and comments to scratch files and pass them with `--body-file` (GitLab uses `--description-file`). Attach images with descriptive alt text; a GitHub video uses a bare `--attach '<file>'`. Read the resulting title and body back.

```bash
gh pr edit --body-file <scratch>/body.md --attach '<file>#<alt text>'
glab mr update <number> --draft --description-file <scratch>/body.md --attach <file>
```

`glab` has no `--jq` option, so pipe its API output into `jq`. Check the published head commit, title, body and list of changed files against the branch. Inspect the full hosted patch only for a concrete rendering problem or a missing diff, not on every push. Passing CI does not prove that a UI rendered the diff. Link every pull request in a stack to T3. Resolve actionable review findings, and use the pull request's page and T3's watch instead of another status ledger.

## Pipeline watch

If `watch_pull_request` is available, the primary thread registers the watch and ends its turn. A delegated checker hands this monitoring back to the primary instead of registering a watch on its own child thread. T3 wakes the thread that registered the watch when a check fails, checks complete, someone comments or reviews, or a conflict appears; inspect the event and read only the logs of the failed jobs. Do not spawn a blocking child or poll alongside that watch.

Without a watcher from the app, wait for the pipeline with one blocking command run in the background under `timeout 2h`, then read only the logs of the failed jobs.

GitHub:

```bash
SHA=$(git rev-parse HEAD)
ID=$(gh run list --commit "$SHA" --json databaseId -q '.[0].databaseId')
: "${ID:?No workflow run exists for this commit}"
gh run watch "$ID" --exit-status --compact
```

If no run exists, inspect the workflow trigger instead of polling an empty lookup. After a failed watch, read the failed logs with `gh run view "$ID" --log-failed` and keep the watch's failure status.

GitLab:

```bash
glab ci status --wait --compact
ID=$(glab api "projects/dual%2Fdual/pipelines?ref=$(git branch --show-current)&per_page=1" | jq -r '.[0].id')
glab api "projects/dual%2Fdual/pipelines/$ID/jobs?scope[]=failed" | jq -r '.[] | "\(.id) \(.name)"'
glab ci trace <job id>
```

## Isolated baseline check

Create an extra worktree only for a check against the base branch or for a prototype that needs different source, dependencies or build inputs, not merely to work in parallel:

```bash
W="$HOME/.deslop/$(basename "$PWD")/<name>"
git worktree add --detach "$W" origin/<default branch> && (cd "$W" && vp install)
```

Remove it as soon as its question is answered: `git worktree remove --force "$W"`.
