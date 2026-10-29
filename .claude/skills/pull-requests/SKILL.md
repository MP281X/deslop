---
name: pull-requests
description: 'Load before the first commit of a task, before editing a branch that has a PR or MR, before a screenshot, recording or device session, and before creating, describing, pushing or restacking a PR or MR.'
---

# Pull requests

## Branches

- **Review units.** Each PR coherent and runnable on its target, generated files with their source.
- **Stacks.** PRs that depend on each other, change the same thing or merge together form one stack, each layer one branch on the one below and readable on its own; only unrelated PRs branch from the default branch. Use the host's stack commands below, never hand retargets.
- **Owning layer.** A fix goes in the layer that introduced the line, then the layers above restack.
- **Current.** Restack onto the latest default branch before each push: CI checks the pushed branch, not its merge.

## Publish

1. **Push** as a draft once Verify passes locally; a round of fixes is one push per affected PR, since each push cancels the last pipeline.
2. **Describe** with the repository's template (`.github/pull_request_template.md`, `.gitlab/merge_request_templates/Default.md`): its comments say what each section holds. Describe the head for a reader without the conversation, delete empty sections and every comment, and read the rendered body back.
3. **Watch** the final head's pipeline with the harness's watcher; a failure, a review comment or a conflict gets a fix, Verify and one push.
4. **Hand back** once required jobs pass and no P1 or P2 finding is open.
5. **Ready** only when the user asks. Before editing a ready PR's layer, mark it draft again.

## Captures

- **Before.** Reproduce a bug before changing code; a claimed difference gets the baseline first, then the same input after.
- **Taking them.** Representative data at the app's primary viewport and theme, native apps from a simulator; wait for a condition, not a delay. Command output supports a capture, never replaces it.

## Commands

Captures upload through `--attach`, never the hosts' upload APIs.

```bash
gh pr edit <n> --title '<title>' --body-file - --attach './shot.png#<alt>' <<'EOF'  # ![alt](./shot.png) becomes the upload
<body>
EOF
gh pr edit <n> --attach './proof.mp4'    # appends the video URL: move it under its claim, alone in its paragraph
gh api repos/<owner>/<repo>/pulls/<n> -H 'Accept: application/vnd.github.html+json' --jq .body_html
gh run view <run id> --log-failed
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
gh stack view --json; gh stack link <pr> <pr>
```

**GitLab stacks** act on the stack selected in this worktree: one commit per diff on its own branch, whose first message line is the MR title (`Draft: ` opens a draft). Every MR of a stack comes from `sync`, which never edits an existing MR.

```bash
git commit -m 'Draft: <title>'
script -qec "GLAB_EDITOR='sh -c \"git rev-list --reverse origin/<default>..HEAD > \\\$1\" -' glab stack infer --name <stack> <default>..HEAD" /dev/null
git add -A && glab stack save -m 'Draft: <title>'    # a new layer; `amend` folds into the checked-out one
glab stack sync --skip-push                          # restack locally before Verify
glab stack sync --update-base                        # each push and after a merge below: rebase, drop merged diffs, force-push, open missing MRs
```

`infer` needs a TTY and an editor, and its range must start at `origin/<default>` since the local default branch can lag; `glab stack create` cannot run in a worktree. `glab stack reorder` takes the same `script` and editor shape, one branch per line, then `glab stack sync`.
