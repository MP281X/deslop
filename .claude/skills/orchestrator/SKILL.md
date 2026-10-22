---
name: orchestrator
description: Use at task start, when requirements or direction change, and before delegating. Owns decisions, the evolving PR set and read-only delegation for this user's workflow.
---

# Orchestrator

## Decide

- **Outcome.** The cause of a bug and its siblings, the whole journey rather than one screen; a larger outcome beyond the request is a proposal.
- **Expert depth.** Before a consequential change: what would a top expert measure, from which raw material (logs, rows, traces, source), and what independently confirms it? Plan the deeper version; a hard target stays solvable until a measurement proves the limit.
- **Options.** A consequential open decision compares distinct approaches, reuse and doing less, against the user's criteria; test the deciding counterexample and stop when it settles the choice. A specified fix follows the existing pattern.
- **Oracle.** Before implementing a consequential design, ask the other model family for a second opinion: one read-only child with the request, the planned files, signatures and data flow, and the evidence so far. It returns objections and the alternative it would pick; you decide. A different model catches what the same one would rationalize.
- **Screens.** An open visual direction gets comparable mocks on the same data before implementation, and the user picks; an agreed direction or a local correction needs none. Measure the built result against the pick.
- **Measure, don't debate.** Options that differ in a result you can run (lint diagnostics, timing, behavior) run on the same input.
- **Tripwire.** Expanding scope, repeated failed fixes or a new mechanism (script, daemon, store, wrapper, protocol, reimplementation) prompts a check against the requested outcome before more implementation.
- **Process stays prose.** A step agents must take lives in the instruction that names it; the user rejected hooks, stamp files, generators and sync checks for it.
- **Steers.** Read a mixed prompt clause by clause before a consequential step. A replacement drops the named direction and its unmerged code, keeping valid work and proof; an addition ("also") extends the task. "I feel like" is feedback, not filler. A short acceptance approves the actual proposal with its names and contracts, not adjacent improvements; conditional or exploratory praise is not acceptance, and a tooling tradeoff does not change the approved outcome. Explicit "before" prerequisites set the order; "good enough" ends refinement and ships. One implementation, no flags for hypothetical revisions.
- **Side notes.** "As a side note" means deferred, not dropped: finish the main task first. Urgency, safety and a constraint on the main task override it.

## Build

Consult patterns for unfamiliar shapes or API gaps and lint-companion before writing. Capture the before per delivery, implement a coherent batch, prove it through the same interface and input, Verify, review, triage and fix in a batch, then Verify and publish per delivery. Reuse evidence whose covered state is unchanged; never rerun research, gates or captures to narrate progress.

## PR set

Plan the PR set at task start as one implementation split into review slices per delivery's Branches, and reshape it as the work changes.

- **Reshape.** Fix the owning slice; remove a rejected approach from every unmerged slice rather than adding and removing it across slices. Reuse existing PRs and branches; close only one the new shape makes redundant.
- **History.** Dependent slices form a stack per delivery's Stacks, whose top is the combined state for Verify and the preview; fix a slice by amending its branch and restacking the ones above. An independent PR branches from the default branch with only its own commit.
- **Publish.** Verify changed heads on their actual bases per delivery and publish with its stack commands; moving a ref to an already-verified commit needs no rebuild.
- **Merges.** The user merges a ready subset while work continues, bottom-up into the default branch; review each slice against its parent.
- **After merges.** Restack onto the default branch per delivery, Verify and republish changed heads, and unlink merged PRs from the thread with `unlink_pull_request`.

## Review

- **One complete round** on the verified unmerged PR set before the first push: one Sol child by default, more only for distinct risks or expertise. Each brief holds the goal, checkout, every slice's immutable base/head pair, the combined head, the user's requirements and approved proposals in their own words, unresolved deviations, and "Load review; apply its applicable evaluation questions." Reuse review and captures across retargets or hash-only rewrites only when patches and trees are unchanged; required CI still runs.
- **Triage** each finding against review's Keep yourself, since you hold the context the reviewer lacks; reject the rest with a one-line reason that a follow-up's brief carries. Fix every kept P1, P2 and trivial P3 in one batch. A follow-up, requested when the fixes need independent validation, checks only the fixes and the contracts they touch.

## Delegate

**Workspace.** If the attached checkout supplies global agent configuration per environment, first make one parent-only `t3_worktree_handoff` before editing. Then keep implementation, branches, preview and browser tab in that checkout on one worker.

**Economics.** Delegate a bounded read-only lookup, inventory, research, thread history, review, probe or mock only when it saves more than briefing and joining it, or adds independent judgment. One child by default, at most three per round, related questions batched per child rather than one child per file; parent and children never duplicate an investigation. Local work stays within environment's resource budget. Model IDs from `orchestrator_capabilities`, reasoning `high`.

| Work                                     | Model                                                               |
| ---------------------------------------- | ------------------------------------------------------------------- |
| Oracle                                   | The other family: GPT-6.1 Sol from Claude, Claude Opus 5.5 from GPT |
| Review, audit, critique, thread history  | GPT-6.1 Sol                                                         |
| Research, reference lookups, comparisons | Claude Sonnet 5.5                                                   |
| Probes, inventories, long commands       | GPT-6 Luna or Claude Haiku 5.5                                      |
| Runner-up screen mocks                   | Claude Sonnet 5.5                                                   |

**Brief.** Open with this block, then one labeled line per part with a blank line between parts and one instruction per line:

```text
**Child.** Read-only per Work: no source edits, fixes, checks, tests, builds, installs, commits or pushes. Scratch only under /tmp/repos/ and /tmp/<task>/. No delegation, preview, thread messages, questions or report files. Answer inline with deciding file, command or URL evidence; mark unverified claims.

**Goal.** <question and the decision it serves>

**User.** "<the user's words verbatim>"

**Scope.** <exact files, lines and commands you already checked; counted items; immutable base/head>

**Stop.** <when the question is settled>

**Return.** <shape>
```

A review or oracle brief adds "Load the review skill." and no author verdict. A mock brief names its hypothesis, the pick's, the shared data, states and copy, the reference files and the output path.
