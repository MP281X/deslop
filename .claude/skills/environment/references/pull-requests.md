# Pull requests

- **Drafts.** The first push opens a draft. Before ending a turn, unlink PRs the host reports merged or closed.
- **Ready.** `main` has no branch protection, so a PR is ready for him only once its flow was walked and Verify passed in its pull request run on the latest `main`. When `main` moves, rebase and push for a new run.
- **Stacks.** A stack exists to ease review: split only where a reviewer would otherwise lose the thread, and a layer need not merge on its own. Any PR not based on the default branch is a stack layer made with the commands below, never `gh pr create --base <branch>` or a changed base; add one at any time. Corrections fold into their own layer before restacking onto the latest default branch.

GitHub stacks act on the checked-out branch's stack; GitHub rebases the next layer when the one below merges.

```bash
gh stack init <bottom> [<next> …]    # start, or adopt existing branches bottom first
gh stack add <branch>                # a new layer on top, checked out before its first commit
gh stack rebase [--upstack]          # before a push, or above an amended layer; --continue or --abort on a conflict
gh stack submit --auto               # first push: opens each PR as a draft on its parent
gh stack push                        # later rounds
gh stack sync --prune                # after a merge below
```

GitLab stacks act on the stack selected in this worktree: one commit per diff on its own branch, its first message line the MR title (`Draft: ` opens a draft). Every MR comes from `sync`, which never edits an existing MR. `glab stack create` cannot run in a worktree.

```bash
glab stack infer --all --name <stack> origin/<default>..HEAD
git add -A && glab stack save -m 'Draft: <title>'    # a new layer; `amend` folds into the checked-out one
glab stack sync --skip-push --update-base            # before the push, and after a merge below
glab stack sync                                      # push the stack, open missing MRs
glab api "projects/:id/pipelines/<pipeline>/jobs?scope[]=failed" | jq -r '.[] | "\(.id) \(.name)"'; glab ci trace <job id>
```
