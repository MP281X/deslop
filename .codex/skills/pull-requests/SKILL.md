---
name: pull-requests
description: 'Load before the first commit of a task, before editing a branch that has a PR or MR, before a screenshot, recording or device session, and before creating, describing, pushing or restacking a PR or MR.'
---

# Pull requests

## Branches

- **Review units.** Split a change for reading and merging: each PR coherent and runnable on its target, generated files with their source.
- **Stacks.** PRs that depend on each other, change the same thing or merge together form one stack, ordered so each layer reads on its own; only unrelated PRs branch from the default branch. Each layer is one branch built on the one below it. Create, adopt, restack and publish only with the host's stack commands under [Commands](#commands), never hand retargets or `git commit-tree`.
- **Owning layer.** A fix goes in the layer that introduced the line, then the layers above restack.
- **Current.** Restack onto the latest default branch before each push (`gh stack rebase`, `glab stack sync --update-base`): CI checks the pushed branch, not its merge with the default branch.

## Publish

1. **Push** once Verify passes locally, opening each PR as a draft; the pipeline confirms the change, it is not where lint or type errors get found. A round of fixes is one push per affected PR, since each push cancels the last pipeline.
2. **Describe** each PR by filling the repository's template (`.github/pull_request_template.md`, `.gitlab/merge_request_templates/Default.md`) per [Body](#body), and again after a push that changes what it says.
3. **Watch** the final head's pipeline to its end with the harness's pull request watcher. A failure, someone else's review comment or a conflict gets a fix, Verify and one push.
4. **Hand back** once required jobs pass and no P1 or P2 finding is open.
5. **Ready** only when the user asks: `gh pr ready <n>`, `glab mr update <n> --ready`. Before the first edit to a layer whose PR is ready, mark that PR draft (`gh pr ready <n> --undo`, `glab mr update <n> --draft`), even if the edit is reverted before a push; a restack without conflicts leaves the layers above unedited.

## Body

The template's comments say what each section holds; the reader has the diff but not the conversation. Describe the head, not the work history; delete empty sections and every template comment. Read the published body back through the host, rendered embeds included.

A rule change:

````md
## Summary

A two-way branch on a boolean reads directly, not through `Boolean.match`.

```diff
 export function label(done: boolean) {
-  return Boolean.match(done, {
-    onFalse: () => 'Running',
-    onTrue: () => 'Done'
-  })
+  if (done) return 'Done'
+  return 'Running'
 }
```

## Evidence

- **The rule flags the rejected form and accepts the direct branch:** <capture of both lint runs>
````

A structural change:

````md
## Summary

The auth app issues tokens; the runtime only verifies them.

```diff
 packages/runtime/src/auth/
-  issue.ts
   verify.ts
 apps/auth/src/services/
+  tokens/
```

## Evidence

- **An existing session survives the move:** <capture>
- **A full sign-in issues a token the runtime accepts:** <video>

## Merge danger

Everyone is signed out unless, before merge:

1. Pause deploys.
2. Rename the data directory with its WAL files.
````

## Captures

- **Required.** Each behavior change, backend, API, CLI and infrastructure included, carries a screenshot or video of its real input through its observable result where it is consumed: the page, the simulator, a terminal running the real command, the requests or traces. A video for a sequence, screenshots for states, changed failure paths when they matter. Command output supports a capture, never replaces it.
- **Comparison.** Reproduce a bug or regression before changing code. When the claim is a difference, capture the baseline first, then the same input and data after.
- **Capture.** Representative data at the app's primary viewport and theme; native apps from a simulator. Wait for a condition, not a delay, and inspect transitions, not just the last frame. On GitHub a video URL stands alone in its paragraph.

## Commands

**Uploads.** Captures go through `--attach`, never the hosts' upload APIs.

```bash
gh pr edit <n> --title '<title>' --body-file - <<'EOF'            # the body inline through stdin; the quoted EOF keeps backticks literal
<body>
EOF
gh pr edit <n> --body-file - --attach './shot.png#<alt>' <<'EOF'  # ![alt](./shot.png) in the body is rewritten to the upload
gh pr edit <n> --attach './proof.mp4'                             # appended video URL; move the bare paragraph under its claim
gh api repos/<owner>/<repo>/pulls/<n> -H 'Accept: application/vnd.github.html+json' --jq .body_html  # the body as rendered
gh run view <run id> --log-failed
glab mr update <n> --description-file - --attach ./shot.png <<'EOF'   # the upload's reference is appended; move it under its claim
glab api "projects/:id/merge_requests/<n>?render_html=true" | jq -r .description_html
glab api "projects/:id/pipelines/<pipeline>/jobs?scope[]=failed" | jq -r '.[] | "\(.id) \(.name)"'; glab ci trace <job id>
```

**GitHub stacks** act on the checked-out branch's stack. GitHub rebases the next layer onto the default branch when the one below merges.

```bash
gh stack init <thread branch>               # this branch becomes the bottom, on the default branch
gh stack init <bottom> <next> <top>         # adopt existing branches, bottom first
gh stack add <branch>                       # the next layer: a new branch on top, checked out before its first commit
gh stack view --json                        # layers, their PRs, which need a restack
gh stack down; gh stack up; gh stack top    # move between layers; gh stack checkout <pr> fetches a stack from GitHub
gh stack rebase --upstack                   # after amending a layer: restack the layers above it
gh stack rebase                             # before a push: fetch and restack onto the default branch; --continue or --abort on a conflict
gh stack submit --auto                      # push, open each new PR as a draft on its parent, link the stack
gh stack push                               # later rounds: every changed head, atomically, with --force-with-lease
gh stack sync --prune                       # after a merge below: fetch, restack, push, delete merged local branches
gh stack link <pr> <pr> <pr>                # join existing PRs into one stack, bottom first
```

**GitLab stacks** act on the stack selected in this worktree. Each diff is one commit on its own branch; the first line of its message is the MR title, so `Draft: ` opens a draft MR. GitLab retargets the next MR when the one below merges and deletes its source branch, without rebasing it. Sync never edits an existing MR and attempts a duplicate of one opened by hand, so every MR of a stack comes from sync.

```bash
git commit -m 'Draft: <title>'                      # the first layer, on the thread branch
script -qec "GLAB_EDITOR='sh -c \"git rev-list --reverse origin/<default>..HEAD > \\\$1\" -' glab stack infer --name <stack> <default>..HEAD" /dev/null
glab stack last                                     # onto the top diff
git add -A && glab stack save -m 'Draft: <title>'   # the next layer: a new diff on its own branch
git add -A && glab stack amend -m 'Draft: <title>'  # fold changes into the checked-out diff
glab stack list                                     # diffs and branches; glab stack first, prev, next, last move between them
glab stack sync --skip-push                         # restack the diffs above an amended one locally, before Verify
glab stack sync --update-base                       # each push: rebase onto the latest base, drop merged diffs, force-push, open missing MRs on their parents
glab mr update <n> --description-file - <<'EOF'     # the body, once sync opened the MR
```

`infer` needs a TTY and an editor. Its range starts at the local default branch, which names the MR target and can lag origin, so the editor keeps only `origin/<default>..HEAD`. `glab stack create` takes the checked-out branch as the base, which a worktree cannot check out while the main checkout holds it. `glab stack reorder` takes the same `script` and editor shape, with the editor writing one branch per line; follow it with `glab stack sync`.
