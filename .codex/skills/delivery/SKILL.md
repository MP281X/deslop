---
name: delivery
description: Use before the first commit or push, before creating, editing or readying a PR or MR, before writing a PR body, before a screenshot, recording, device session or video, and on every PR notice.
---

# Delivery

## Branches

- **Review units.** Split a change for reading, each PR coherent and runnable on its target. Independent changes target the default branch; stack only real code dependencies. Keep generated files with their source.
- **Composition.** Before ready, prove clean application in dependency order and between independent PRs; reshape shared edits in their owning slices to remove conflicts.
- **Current.** The last Verify before a push follows `git fetch` and a rebase onto the PR's target branch, and a conflict gets the same rebase: every PR stays current with its target.

## Publish

1. **Push** only a head that passed lint-companion's Verify after its last rebase, opening each PR as a draft. A round of fixes is one commit and one push: each push starts a pipeline and cancels the last.
2. **Describe** the head as it is now per [Body](#body), at the first push and after every push that changes what it says; never narrate how the PR got there ("now also", "updated", "fixed review").
3. **Watch** the final head's pipeline to its end with the harness's pull request watcher when it has one, else the host CLI. A failure, someone else's review comment or a conflict on the current head gets a fix, Verify and one push.
4. **Ready** when the final head passes required jobs, no P1 or P2 finding is open and review's Body reader finds no unsupported claim or missing evidence: `gh pr ready <n>` or `glab mr update <n> --ready`. A new commit on a ready PR returns it to draft in the same step (`gh pr ready <n> --undo`, `glab mr update <n> --draft`).

## Body

Follow the repository's PR template. State the changed behavior, deciding evidence, material risks and required migration. Keep a sentence only if it helps the reviewer accept or reject the change. Link supporting analysis rather than paste it; omit research history, process counts, file inventories and facts the diff already makes obvious. Put end-to-end evidence beside its claim and distinguish measured behavior from unverified expectations.

## Captures

**End to end.** A behavior change gets a visible demonstration from its real input through its observable result, not just a description or a green suite. This applies to backend, API, CLI and infrastructure changes too, not only UI. Show the actual consuming interface, terminal, requests and results, or traces as appropriate. A video proves a sequence or journey; screenshots prove observable states and outcomes. Include changed failure paths when they matter. An HTML mock or an animation of the intended behavior is not proof that it works.

**Capture.** Use representative data at the supported viewport and theme; native apps from a simulator. Wait for a condition, not a delay; record from meaningful input through outcome. Compare target and changed behavior on the same data when needed. Inspect each capture, embed it under its claim, and check the published PR renders the image or video player. On GitHub, keep an uploaded video URL alone in its paragraph, not in a Markdown link. Command output supports, not replaces, feasible captures. If capture is unavailable or nothing runs, state the limitation and show the strongest real evidence without claiming end-to-end verification.

## Commands

```bash
gh pr edit <n> --title '<title>' --body-file - <<'EOF'            # the body inline through stdin; the quoted EOF keeps backticks literal
<body>
EOF
gh pr edit <n> --body-file - --attach './shot.png#<alt>' <<'EOF'  # ![alt](./shot.png) in the body is rewritten to the upload
gh pr edit <n> --attach './proof.mp4'                             # appended video URL; move the bare paragraph under its claim
glab mr update <n> --description-file - --attach ./shot.png <<'EOF'   # the upload's reference is appended to the description
gh run view <run id> --log-failed
glab api "projects/<id>/pipelines/<pipeline>/jobs?scope[]=failed" | jq -r '.[] | "\(.id) \(.name)"'; glab ci trace <job id>
```

- **GitLab stacks** target each predecessor branch with `glab mr create` and `glab mr update --target-branch`; never `glab stack`, which shares state across worktrees.
- **Baseline.** To measure the target branch in this checkout: commit, `git restore --source=origin/<target> -- <paths>`, measure, `git restore --source=HEAD -- <paths>`.
