---
name: planning
description: Load at the start of every task, at each user message that changes, extends or approves the direction, before choosing between approaches or showing mocks, and before starting a child.
---

# Planning

## Decide

- **Outcome.** The cause of a bug and its siblings, the whole journey rather than one screen; a larger outcome beyond the request is a proposal. A repository named only for analysis stays read-only: no branch, PR, MR or ticket.
- **Expert depth.** Resolve a consequential uncertainty with the deciding trace, profile, query, reference or real interaction, per environment's Diagnostics and the references skill; analysis without evidence stays a hypothesis. Compare runnable options on the same input; a benchmark reports before and after medians of wall time, CPU time and peak RAM. A hard target stays solvable until a measurement proves the limit.
- **Oracle.** Before implementing a consequential design, ask the other model family for a second opinion: one read-only child with the request, the planned files, signatures and data flow, and the evidence so far. It returns objections and the alternative it would pick; you decide. A different model catches what the same one would rationalize.
- **Done.** Before a long or open-ended run, state the exit condition as a checkable predicate; stop when it holds, not when progress plateaus, and never relax it to declare victory.
- **Screens.** A new screen or an open visual or mental-model direction gets distinct variants side by side through `html_render` before any UI code, one with the fewest concepts, on realistic data and copy, in the app's own theme and components, not T3's; let the user try the deciding journey before implementation. An agreed direction or local correction needs no new choice. Measure the built result against the pick.
- **Tripwire.** Expanding scope, repeated failed fixes or a new mechanism (script, daemon, store, wrapper, protocol, reimplementation) prompts a check against the requested outcome before more implementation.
- **Process stays prose.** A step agents must take lives in the instruction that names it; the user rejected hooks, stamp files, generators and sync checks for it.
- **Steers.** Read a mixed prompt clause by clause before a consequential step. A replacement drops the named direction and its unmerged code, keeping valid work and proof; an addition ("also") extends the task. "I feel like" is feedback, not filler. A short acceptance approves the actual proposal with its names and contracts, not adjacent improvements; conditional or exploratory praise is not acceptance, and a tooling tradeoff does not change the approved outcome. A stated goal ("delete the useless tests", "fix the pipeline") covers every instance found later, so act on them; reversing non-default configuration someone set on purpose is discussed point by point first. Explicit "before" prerequisites set the order; "good enough" ends refinement and ships. One implementation, no flags for hypothetical revisions.
- **Side notes.** "As a side note" means deferred, not dropped: finish the main task first. Urgency, safety and a constraint on the main task override it.

## Build

Capture the before, implement a coherent batch, prove it through the same interface and input, Verify, review, fix in a batch, Verify and publish per pull-requests. Reuse evidence whose covered state is unchanged; never rerun research, gates or captures to narrate progress.

## PR set

Plan the PR set at task start as one implementation split into review slices per pull-requests' Branches, and reshape it as the work changes.

- **Reshape.** Remove a rejected approach from every unmerged slice rather than adding and removing it across slices. Reuse existing PRs and branches; close only one the new shape makes redundant.
- **Top.** The preview runs the stack's top; a ref moved to an already-verified commit needs no local rerun, while a rebase that brings in new commits reruns Verify.
- **After merges.** Restack and republish per pull-requests, and unlink merged PRs from the thread with `unlink_pull_request`.

## Review

- **One complete round** on the verified unmerged PR set before the first push: one reviewer child by default, more only for distinct risks or expertise. Each brief holds the goal, checkout, every slice's immutable base/head pair, the combined head, the user's requirements and approved proposals in their own words, and unresolved deviations. Reuse review and captures across retargets or hash-only rewrites only when patches and trees are unchanged; required CI still runs.
- **Triage** each finding against review's Keep yourself, since you hold the context the reviewer lacks; reject the rest with a one-line reason that a follow-up's brief carries. Fix every kept P1, P2 and trivial P3 in one batch, each slice in its own layer. Pre-existing findings go in the reply for the user to pick up later, never into this PR set.
- **Follow-up**, when the fixes need independent validation: only the PRs whose head changed, each against its parent, and only the fixes and the contracts they touch. A second follow-up that still finds a P1 or P2 means the approach is wrong: rethink it with the user instead of patching again.

## Delegate

**Workspace.** If the thread's checkout is `~/deslop`, whose `main` every worker's installed agent configuration links to (environment's Maintenance), first make one parent-only `t3_worktree_handoff` before editing. Then keep implementation, branches, preview and browser tab in that checkout on one worker.

**Economics.** Delegate a bounded read-only lookup, inventory, research, thread history, review, probe or mock only when it saves more than briefing and joining it, or adds independent judgment. One child per independent question, related questions batched in one child; parent and children never duplicate an investigation. Model IDs from `orchestrator_capabilities`, reasoning `high`. A provider steer for quota ("use claude code subagents") replaces the table for every later child in the thread until the user lifts it.

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
