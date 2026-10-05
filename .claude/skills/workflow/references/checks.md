# Checks

- **Scope.** Run the assigned commands from the repository root with environment's root commands; testing selects checks and reruns. Serialize checks that compete for resources or write shared artifacts.
- **Results.** Take the exit status from the command you started, not a log footer. Keep bulky logs in scratch and read the deciding part; filtering never hides a failure. Wait on the returned session, never on a spawned agent. Servers need readiness probes.
- **Return.** Each criterion's command and exit status, cached or fresh, failed, skipped or passed.

## Publishing

- The body follows Pair's Structure and describes the contracts the final branch changes, not its iteration history. Keep consequential risks, even in mechanically changed files.
- Link the words that refer to a file or folder to the file on the branch, like citations, with a line range when the change covers part of the file:

  | Host   | Link                                                                     |
  | ------ | ------------------------------------------------------------------------ |
  | GitHub | `https://github.com/<owner>/<repo>/blob/<branch>/<path>#L<start>-L<end>` |
  | GitLab | `https://<host>/<project>/-/blob/<branch>/<path>#L<start>-<end>`         |

Write bodies and comments to scratch files and pass them with `--body-file` (GitLab uses `--description-file`). Attach images with descriptive alt text; a GitHub video uses a bare `--attach '<file>'`.

```bash
gh pr edit --body-file <scratch>/body.md --attach '<file>#<alt text>'
glab mr update <number> --draft --description-file <scratch>/body.md --attach <file>
```

`glab` has no `--jq` option, so pipe its API output into `jq`. Check the published head commit, title, body and changed files against the branch. Link every pull request in a stack to T3, and resolve actionable review findings.

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

## Baseline check

To compare with the base branch, commit a checkpoint, restore the base version of the files in question, run the check, then reset to the checkpoint:

```bash
git restore --source=origin/<default branch> -- <paths>
```

Reinstall dependencies after both the restore and the reset when a manifest or the lockfile changed. Create an extra worktree only when both versions must run at the same time, and remove it as soon as its question is answered.
