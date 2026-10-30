---
name: pull-requests
description: 'Load before the first commit of a task, before changing code to fix a reported bug, before editing a branch that has a PR or MR, and before creating, describing, pushing or restacking one.'
---

# Pull requests

## Branches

- **Review units.** Each PR is coherent and runnable on its target, with generated files beside their source.
- **Stacks.** PRs that depend on each other, change the same thing or merge together form one stack: one branch per layer on the layer below, each readable alone. Only unrelated PRs branch from the default branch. Restack with the host's stack commands, never by retargeting by hand.
- **Reshape.** Remove a rejected approach from every unmerged layer; reuse the surviving PRs rather than introducing it below and undoing it above.
- **Integration.** Batch corrections into their owning layers, then restack onto the latest default branch before final proof, Verify and review. Publish that integrated state; revalidate if it changes.
- **Baseline first.** Reproduce a bug, or capture the state a difference is claimed against, before changing code.

## Publish

1. **Push** a draft once Verify passes. A round of fixes is one push per affected PR, since each push cancels the previous pipeline.
2. **Describe** with the repository's template (`.github/pull_request_template.md`, `.gitlab/merge_request_templates/Default.md`); its comments say what each section holds.
3. **Watch** the final head's pipeline; a failure, a review comment or a conflict gets a fix, Verify and one push.
4. **Hand back** once the required jobs pass and no P1 or P2 finding is open.
5. **Ready** only when the user asks; mark a ready PR draft again before editing its layer.

## Commands

Captures upload with `--attach`, never through the host's upload API.

```bash
gh pr edit <n> --title '<title>' --body-file - --attach './shot.png#<alt>' <<'EOF'  # ![alt](./shot.png) becomes the upload
<body>
EOF
gh pr edit <n> --attach './proof.mp4'    # appends the video URL: move it under its claim, alone in its paragraph
gh api repos/<owner>/<repo>/pulls/<n> -H 'Accept: application/vnd.github.html+json' --jq .body_html
glab mr update <n> --description-file - --attach ./shot.png <<'EOF'   # appends the reference: move it under its claim
glab api "projects/:id/merge_requests/<n>?render_html=true" | jq -r .description_html
glab api "projects/:id/pipelines/<pipeline>/jobs?scope[]=failed" | jq -r '.[] | "\(.id) \(.name)"'; glab ci trace <job id>
```

**GitHub stacks** act on the checked-out branch's stack; GitHub rebases the next layer when the one below merges.

```bash
gh stack init <bottom> [<next> …]    # start, or adopt existing branches bottom first
gh stack add <branch>                # a new layer on top, checked out before its first commit
gh stack rebase [--upstack]          # before a push, or above an amended layer; --continue or --abort on a conflict
gh stack submit --auto               # first push: opens each PR as a draft on its parent
gh stack push                        # later rounds
gh stack sync --prune                # after a merge below
gh stack unstack --local             # drop tracking of a stack that was never submitted
```

**GitLab stacks** act on the stack selected in this worktree: one commit per diff on its own branch, whose first message line is the MR title (`Draft: ` opens a draft). Every MR of a stack comes from `sync`, which never edits an existing MR.

```bash
git commit -m 'Draft: <title>'
script -qec "GLAB_EDITOR='sh -c \"git rev-list --reverse origin/<default>..HEAD > \\\$1\" -' glab stack infer --name <stack> <default>..HEAD" /dev/null
git add -A && glab stack save -m 'Draft: <title>'    # a new layer; `amend` folds into the checked-out one
glab stack sync --skip-push                          # restack locally before Verify
glab stack sync --update-base                        # each push and after a merge below: rebase, drop merged diffs, force-push, open missing MRs
```

`infer` needs a TTY and an editor, and its range starts at `origin/<default>` since the local default branch can lag; `glab stack create` cannot run in a worktree. `glab stack reorder` takes the same `script` and editor shape, one branch per line, then `glab stack sync`.
