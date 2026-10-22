---
name: delivery
description: Use before changing a behavior a PR will demonstrate, before the first commit or push, before creating, editing or readying a PR or MR, before writing a PR body, before a screenshot, recording, device session or video, and on every PR notice.
---

# Delivery

## Branches

- **Review units.** Split a change for reading: each PR coherent and runnable on its target, generated files with their source. Independent changes target the default branch; stack only real code dependencies.
- **Composition.** Before ready, prove the PRs apply cleanly in dependency order and beside each other; resolve a shared edit in its owning slice.
- **Current.** Fetch and rebase onto the target before the last Verify before a push, and on a conflict, so every PR stays current.

## Publish

1. **Push** only a head that passed lint-companion's Verify after its last rebase, opening each PR as a draft. A round of fixes is one push per affected PR, since each push starts a pipeline and cancels the last.
2. **Describe** the head per [Body](#body) at the first push and after any push that changes what the body says.
3. **Watch** the final head's pipeline to its end with the harness's pull request watcher, else the host CLI. A failure, someone else's review comment or a conflict gets a fix, Verify and one push.
4. **Ready** when required jobs pass, no P1 or P2 finding is open and review's Body reader finds no unsupported claim: `gh pr ready <n>` or `glab mr update <n> --ready`. A new commit on a ready PR returns it to draft in the same step (`gh pr ready <n> --undo`, `glab mr update <n> --draft`).

## Body

The reader reviews the diff without having been in the conversation, so the body gives what the diff cannot show:

- **Why** the change exists, first and in plain words.
- **What changes** for users or callers.
- **Decisions** a reviewer must agree with: a rejected alternative, a new boundary, an invariant across files, where to start reading.
- **Proof**: before and after, per [Captures](#captures).
- **Risk**: a migration, a required step, what could break.

**Short.** A reviewer reads it in under a minute: a why of one or two sentences, one line per bullet, under 150 words besides captures and tables. Use only the parts this change needs, and cut what a reviewer would not miss. Leave to the diff what it already shows: file lists, moves, renames, symbol tours. Describe the head as it is, never the history of the work; keep verified behavior apart from expectations; follow the repository template. Check a text body through the host CLI, a rendered embed in a browser.

A small fix:

```md
Tagged notes looked missing from search: after the schema rename, search matched only titles. It matches tags too now.

| Before                                          | After                                              |
| ----------------------------------------------- | -------------------------------------------------- |
| ![Searching "effect" finds 0 notes](before.png) | ![The same search finds 3 tagged notes](after.png) |
```

A structural change:

```md
Every auth change touched both a shared package and its server. Now the auth app issues tokens and the runtime only verifies them.

- **Start reading** at the runtime's auth service.
- **Before merge,** pause deploys and rename the data directory with its WAL files, or everyone is signed out.

<captures: an existing session after the rename, a missing session, a full sign-in>
```

## Captures

- **Before first.** Reproduce the bug or capture the current behavior through the same interface before changing code; a new capability's before is the state without it. The PR then shows before and after from the same input and data, side by side, without checking out the target later.
- **End to end.** A behavior change, backend, API, CLI and infrastructure included, shows its real input through its observable result in the consuming interface, terminal, requests or traces: a video for a sequence, screenshots for states, changed failure paths when they matter. A green suite, a description or a mock of the intended behavior is not proof.
- **Capture.** Representative data at the supported viewport and theme; native apps from a simulator. Wait for a condition, not a delay. Inspect each capture, embed it under its claim and check the published PR renders it; on GitHub an uploaded video URL stands alone in its paragraph. Command output supports feasible captures, never replaces them; when nothing can run, state the limit and show the strongest real evidence.

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

**GitLab stacks** target each predecessor branch with `glab mr create` and `glab mr update --target-branch`; never `glab stack`, which shares state across worktrees.
