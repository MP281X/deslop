---
name: delivery
description: Use before the first commit or push, before creating, editing or readying a PR or MR, before writing a PR body, before a screenshot, recording, device session or video, and on every PR notice.
---

# Delivery

## Branches

- **One PR per feature.** A second PR only for a feature the user would accept or reject on its own; it stacks only on a real dependency. Never split a feature across PRs, and no PR rewrites what another adds. A task's instruction and configuration changes are one PR; generated files stay with their source. Decide the split before the first commit.
- **Current.** The last Verify before a push follows `git fetch` and `git rebase origin/<default branch>`, and a conflict gets the same rebase: a PR is never behind or conflicting.

## Publish

1. **Push** only a head that passed engineering's Verify after its last rebase, opening each PR as a draft. A round of fixes is one commit and one push: each push starts a pipeline and cancels the last.
2. **Describe** the head as it is now per [Body](#body), at the first push and after every push that changes what it says; never narrate how the PR got there ("now also", "updated", "fixed review").
3. **Watch** the final head's pipeline to its end. A failure, someone else's review comment or a conflict on the current head gets a fix, Verify and one push.
4. **Ready** when the final head passes required jobs, no P1 or P2 finding is open, the captures are in the body and [Critique](#critique) finds nothing: `gh pr ready <n>` or `glab mr update <n> --ready`. A new commit on a ready PR returns it to draft in the same step (`gh pr ready <n> --undo`, `glab mr update <n> --draft`).

## Body

**Inverted pyramid.** One opening line with the central change in the reader's terms, then one `###` per change a user or caller notices, central change first, each proved by a capture or real command output in a fenced block. Follow the repository's PR template when it has one.

- **Risk.** Up to three bullets after the opening: a migration, a changed contract, removed behavior; none when nothing can break.
- **Contracts.** A changed endpoint, schema, key, migration or exported API gets a before and after table and the caller migration.
- **Evidence.** Each capture under the entry it proves: one video per journey, at most eight screenshots, a changed screen as a before (target branch) and after table with the same data.
- **Also.** Minor changes as one-line bullets under `### Also`; the last names generated files and the command that reproduces them.
- **Never** test counts, check tables, process notes, a proof section, diffs or code links.

## Captures

How a capture looks follows design; this is how to make one.

- **One tab** on the preview, shared with the user: reuse it, never a second; while the user drives it, do other work; leave it on the changed screen.
- **Wait for a condition,** never a fixed delay; batch reads in one script; after a failed action, read the screen, console and failed requests before you retry.
- **Record** each storyboard chapter from just before its first meaningful input to just after its outcome, at phone size (390×844); a desktop-only layout at 1440×900.
- **Native apps** are captured from a simulator, never a mock.

## Critique

Read the published PR as a reviewer will, without the chat. Fix every "no" before ready:

1. Does the first screen of the body say what changed for the user?
2. Does each claim carry a capture or real output, and does each capture prove a claim?
3. Would the user accept each PR as one unit?
4. Is everything in the diff something the request asked for?
5. Would the user watch the video to the end?

## Commands

```bash
gh pr edit <n> --title '<title>' --body-file - <<'EOF'            # the body inline through stdin; the quoted EOF keeps backticks literal
<body>
EOF
gh pr edit <n> --body-file - --attach './shot.png#<alt>' <<'EOF'  # ![alt](./shot.png) in the body is rewritten to the upload
gh pr edit <n> --attach './proof.mp4'                             # a video takes no #alt; its URL is appended, so move it under its entry next edit
glab mr update <n> --description-file - --attach ./shot.png <<'EOF'   # the upload's reference is appended to the description
gh run view <run id> --log-failed
glab api "projects/<id>/pipelines/<pipeline>/jobs?scope[]=failed" | jq -r '.[] | "\(.id) \(.name)"'; glab ci trace <job id>
```

- **GitLab stacks** target each predecessor branch with `glab mr create` and `glab mr update --target-branch`; never `glab stack`, which shares state across worktrees.
- **Baseline.** To measure the target branch in this checkout: commit, `git restore --source=origin/<target> -- <paths>`, measure, `git restore --source=HEAD -- <paths>`.
