# Pull requests

- **Unlink** PRs the host reports merged or closed before ending a turn.
- **Stacks** exist to ease review: split only where a reviewer would otherwise lose the thread; a layer need not merge on its own. Any PR not based on the default branch is a layer made with the commands below, never `gh pr create --base <branch>` or a changed base. Corrections fold into their own layer before restacking onto the latest default branch.

GitHub stacks act on the checked-out branch's stack and rebase the next layer when the one below merges:

```bash
gh stack init <bottom> [<next> …]    # start, or adopt existing branches bottom first
gh stack add <branch>                # a new layer on top, checked out before its first commit
gh stack rebase [--upstack]          # before a push, or above an amended layer
gh stack submit --auto               # first push: each PR a draft on its parent
gh stack push                        # later rounds
gh stack sync --prune                # after a merge below
```

GitLab stacks act on the stack selected in this worktree. A commit's first message line is its MR's title (`Draft: ` opens a draft); `sync` never edits an existing MR. In a worktree, start one with `glab stack infer`, never `glab stack create`.

```bash
glab stack infer --all --name <stack> origin/<default>..HEAD
git add -A && glab stack save -m 'Draft: <title>'    # a new layer; `amend` folds into the checked-out one
glab stack sync --skip-push --update-base            # before the push, and after a merge below
glab stack sync                                      # push the stack, open missing MRs
glab api "projects/:id/pipelines/<pipeline>/jobs?scope[]=failed" | jq -r '.[] | "\(.id) \(.name)"'; glab ci trace <job id>
```

## Bodies

Each push rewrites the body from `.github/pull_request_template.md` (GitLab: `.gitlab/merge_request_templates/Default.md`) for the change at the head, never rounds, rebases or other PRs. Hosts render no HTML but `<details>`, which keeps Decisions and Evidence collapsed so the body opens on its outcome and picture. An uploaded recording's URL goes under its finish line's one-line caption, alone in its paragraph; read the body back rendered and fix what fails to render. Set the title and body with `pull_request_update`; upload a recording with the host's CLI:

```bash
gh pr edit <n> --attach './proof.mp4'    # appends the video URL
gh api repos/<owner>/<repo>/pulls/<n> -H 'Accept: application/vnd.github.html+json' --jq .body_html
glab mr update <n> --description-file - --attach ./proof.mp4 <<'EOF'   # appends the reference
<body>
EOF
glab api "projects/:id/merge_requests/<n>?render_html=true" | jq -r .description_html
```
