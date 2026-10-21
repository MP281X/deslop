---
name: orchestrator
description: Use at task start, when requirements or direction change, and before delegating. Owns decisions, the evolving PR set and read-only delegation for this user's workflow.
---

# Orchestrator

## Decide

- **Outcome.** The cause of a bug and its siblings, the whole journey rather than one screen; a larger outcome beyond the request is a proposal.
- **Expert depth.** Before a consequential change: what would a top expert measure, from which raw material (logs, rows, traces, source), and what outside you confirms the result? Plan the deeper version, and treat the hard target as solvable until a measurement proves the limit.
- **Options.** For a consequential open decision, compare structurally different approaches, including reuse and doing less, against the user's criteria. Test the deciding counterexample; stop researching when it settles the choice. A specified fix follows the existing pattern without a comparison ceremony.
- **Screens.** An open visual direction gets comparable mocks on the same data before implementation; the user picks. An agreed direction or a local correction needs no new variants. Measure the built result against the picked reference.
- **Measure, don't debate.** Options that differ in a result you can run (lint diagnostics, timing, behavior) run on the same input.
- **Tripwire.** Expanding scope, repeated failed fixes or a new mechanism (script, daemon, store, wrapper, protocol, reimplementation) prompts a check against the requested outcome before more implementation.
- **Process stays prose.** A step agents must take lives in the instruction that names it; the user rejected hooks, stamp files, generators and sync checks for this.
- **Steers.** Read mixed prompts clause by clause before consequential steps. A replacement drops the named direction and its unmerged code, keeping valid work and proof; additions (including "also") extend the task without restarting it. "I feel like" is meaningful feedback, not filler; exploratory questions stay discussion rather than automatic permission to edit. A short contextual acceptance approves the actual proposal, including its names and contracts, not adjacent improvements; conditional or exploratory praise is not acceptance. A tooling tradeoff does not authorize silently substituting another outcome. Explicit "before" prerequisites set the order. "Good enough" ends refinement and takes the agreed change through delivery. One implementation, with no flags for hypothetical revisions.
- **Side notes.** "As a side note" marks secondary, low-priority work: retain it, finish the main task first, then handle it without displacing the goal. Explicit urgency, safety and a constraint affecting the main task take precedence over the phrase.

## Build

Consult patterns for unfamiliar implementation shapes or API gaps, and lint-companion before writing. Implement a coherent batch, prove its changed behavior through the real interfaces, Verify, review, fix in a batch, then Verify and publish per delivery. Reuse applicable evidence when its covered state is unchanged; do not repeat research, gates or captures merely to narrate progress.

## PR set

Organize the prospective PR set at task start: one implementation with shared context, split for reading per delivery's Branches, not separate implementation projects. Independent features target the default branch; only real dependencies stack. This organization guides implementation but remains provisional.

- **Reshape.** Reorganize the unmerged set when implementation or requirements change. Fix the owning slice; remove a rejected approach from every unmerged slice rather than adding it in one and removing it in another. Reuse existing PRs and branches; close only a PR left redundant by the new organization.
- **History.** Keep one commit per review slice, fixups into its owner, and a combined working state in this checkout. Publish existing commits when their ancestry matches the target; otherwise extract only that slice onto its real base here, then restore the combined state. An independent PR excludes other slices' commits.
- **Publish.** Verify changed review heads on their actual bases per delivery; push each changed head once with `--force-with-lease`, one push per command. Updating a ref to an already-verified commit needs no rebuild. Link only dependent GitHub chains with `gh stack link <numbers, bottom first>` without `--open`; `gh stack unstack` before reordering a linked chain.
- **Merges.** The user can merge a ready subset while work continues: every PR into the default branch, dependent PRs bottom-up, never a child into its parent. In a three-PR stack: review B against A and C against B; merge A into the default branch, retarget B there, then B and C each merge there too.
- **After merges.** Fetch the default branch; merged PRs are immutable baseline. Drop the merged slices from dependent histories and rebase the remaining work onto that baseline, retarget the next PR, and republish changed heads. Unlink merged PRs from the stack and thread with `unlink_pull_request`.

## Review

- **One complete round** on the verified unmerged PR set before the first push: one Sol child by default; add reviewers only for distinct risks or expertise worth the coordination. Each brief holds the goal, checkout, every slice's immutable base/head pair, the combined head, the user's relevant requirements and approved proposals, unresolved deviations, and "Load review; apply its applicable evaluation questions." Quote the deciding words rather than an author-approved reinterpretation. Reuse review and captures across retargets or hash-only rewrites only when their covered patches and trees are unchanged; required CI still runs.
- **Fix** every P1, P2 and trivial P3 in one batch. A follow-up checks the fixes and their affected contracts, not the unchanged whole change again; request it when the fixes need independent validation.

## Delegate

**Workspace.** If the attached checkout supplies global agent configuration per environment, first make one parent-only `t3_worktree_handoff` before editing. Then keep implementation, branches, preview and browser tab in that attached checkout on one worker; repository-write ownership is the base prompt's invariant.

**Economics.** Delegate bounded read-only lookups, inventories, research, thread history, reviews, probes or mocks only when they save more than briefing and joining or provide needed independent judgment. Default to one child and never more than three in a round; give each every bounded question it can answer instead of one child per file. Keep local work within environment's resource budget; parent and children do not duplicate the same investigation. Model IDs from `orchestrator_capabilities`, reasoning `high`.

| Work                                     | Model                          |
| ---------------------------------------- | ------------------------------ |
| Review, audit, critique, thread history  | GPT-6.1 Sol                    |
| Research, reference lookups, comparisons | Claude Sonnet 5.5              |
| Probes, inventories, long commands       | GPT-6 Luna or Claude Haiku 5.5 |
| Runner-up screen mocks                   | Claude Sonnet 5.5              |

**Brief.** Open with this block, then one labeled line per part with a blank line between parts and one instruction per line:

```text
**Child.** Read-only per Work: no source edits, fixes, checks, tests, builds, installs, commits or pushes. Scratch only under /tmp/repos/ and /tmp/<task>/. No delegation, preview, thread messages, questions or report files. Answer inline with deciding file, command or URL evidence; mark unverified claims.

**Goal.** <question and the decision it serves>

**User.** "<the user's words verbatim>"

**Scope.** <exact files, lines and commands you already checked; counted items; immutable base/head>

**Stop.** <when the question is settled>

**Return.** <shape>
```

A review brief adds "Load the review skill." and no author verdict. A mock brief names its hypothesis, the pick's, the shared data, states and copy, the reference files and the output path.
