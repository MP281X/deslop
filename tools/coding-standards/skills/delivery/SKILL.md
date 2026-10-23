---
name: delivery
description: Use before changing a behavior a PR will demonstrate, before the first commit or push, before creating, editing or readying a PR or MR, before writing a PR body, before a screenshot, recording, device session or video, and on every PR notice.
---

# Delivery

## Branches

- **Review units.** Split a change for reading: each PR coherent and runnable on its target, generated files with their source. Independent changes target the default branch; stack only real code dependencies.
- **Stacks.** Each dependent slice is one commit on its own branch, built on the branch it depends on. The host tracks the chain and retargets the next PR when one merges, and its stack commands under [Commands](#commands) restack and publish; retarget by hand only to adopt or reorder existing PRs.
- **Composition.** Before ready, prove the PRs apply cleanly in dependency order and beside each other; resolve a shared edit in its owning slice.
- **Current.** Fetch and rebase onto the target before the last Verify before a push, and on a conflict, so every PR stays current.

## Publish

1. **Push** only a head that passed lint-companion's Verify after its last rebase, opening each PR as a draft. A round of fixes is one push per affected PR, since each push starts a pipeline and cancels the last.
2. **Describe** the head per [Body](#body) at the first push and after any push that changes what the body says.
3. **Watch** the final head's pipeline to its end with the harness's pull request watcher, else the host CLI. A failure, someone else's review comment or a conflict gets a fix, Verify and one push.
4. **Ready** when required jobs pass, no P1 or P2 finding is open and review's Body reader finds no unsupported claim: `gh pr ready <n>` or `glab mr update <n> --ready`. A new commit on a ready PR returns it to draft in the same step (`gh pr ready <n> --undo`, `glab mr update <n> --draft`).

## Body

The reader reviews the diff without having been in the conversation, so the body gives what the diff cannot show:

- **Why** the change exists: a short heading or one-line problem.
- **What changes** for users or callers.
- **Decisions** a reviewer must agree with: a rejected alternative, a new boundary, an invariant across files, where to start reading.
- **Proof** per [Captures](#captures).
- **Risk**: a migration, a required step, what could break.

- **Shape.** Short headings, fragments and one-line bullets; under 150 prose words, code, captures and tables separate. Drop empty sections and prose repeating an example or visual, even implicitly.
- **Examples.** A code-rule change starts with minimal rejected/accepted code, in fenced blocks or a diff, plus a preserved case where the boundary matters. A description is not a substitute.
- **Ground.** Describe the head, not the work history; separate proof from expectations and follow the repository template. Check text through the host CLI, rendered embeds in a browser.

A rule change:

````md
## Direct branches

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
````

A small fix:

```md
The schema rename left search querying only titles.

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

- **Comparison.** Reproduce a bug or regression before changing code. Capture a baseline first when the claim depends on a difference, then compare the same input and data. Before/after is evidence for that claim, not a default presentation for every change.
- **End to end.** A behavior change, backend, API, CLI and infrastructure included, shows its real input through its observable result in the consuming interface, terminal, requests or traces: a video for a sequence, screenshots for states, changed failure paths when they matter. A green suite, a description or a mock of the intended behavior is not proof.
- **Capture.** Representative data at the supported viewport and theme; native apps from a simulator. Wait for a condition, not a delay. Inspect states and transitions, not just the last frame; embed the deciding captures under their claim and check the published PR renders them. On GitHub a video URL stands alone in its paragraph. Command output supports feasible captures, never replaces them; when nothing can run, state the limit and show the strongest real evidence.

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

```bash
# GitHub stacks
gh stack init <bottom> <next> <top>           # existing branches are adopted, bottom first
gh stack submit --auto                         # push, open drafts on their parents, link the stack
gh stack rebase --upstack                      # after amending a slice, restack the branches above it
gh stack rebase                                # after a merge or a target change: pull and restack onto the default branch
gh stack push                                  # every changed head, with --force-with-lease, after Verify
# GitLab stacks: the server links MRs by their targets and retargets a child once its parent merges with its branch deleted
glab mr create --draft --remove-source-branch --source-branch <slice> --target-branch <parent>
glab mr update <n> --target-branch <parent>                   # adopt or reorder an existing MR
git rebase --onto origin/<default> <old parent tip> <child>   # after a squash merge GitLab retargets but does not rebase
```

Never `glab stack`: its sync opens MRs ready, not as drafts.
