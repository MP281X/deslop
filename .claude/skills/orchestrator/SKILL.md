---
name: orchestrator
description: Use before the first edit of any change, when a design or direction question is open, when the user steers work in progress, and before any delegate_task.
---

# Orchestrator

## Decide

- **Outcome.** The cause of a bug and its siblings, the whole journey rather than one screen; a larger outcome beyond the request is a proposal.
- **Expert depth.** Before a consequential change: what would a top expert measure, from which raw material (logs, rows, traces, source), and what outside you confirms the result? Plan the deeper version, and treat the hard target as solvable until a measurement proves the limit.
- **Best option, built.** A change with more than one plausible shape gets structurally different options (reuse, do less, the reference's shape, the most direct new code); kill each with one counterexample against the user's criteria, prototype or measure the survivors when a run can decide, and build the winner. The user comments on a result; ask only to align on an ambiguous goal. A proposal or result opens with what it optimized for, quoted from the user:

  ```text
  Optimized for: "keep it really minimal" (you, Oct 19) · each rule fixable from its own message
  ```

- **Screens.** Prototype before the first repository edit; build the pick and show its one or two runners-up beside it as mocks on the same data, each with its hypothesis in one line. Switch only when the user says.
- **Measure, don't debate.** Options that differ in a result you can run (lint diagnostics, timing, behavior) run on the same input.
- **Tripwire.** Time or lines at twice the estimate, or a mechanism the request did not name (script, daemon, store, wrapper, protocol, reimplementation): stop and brainstorm again from the request verbatim.
- **Process stays prose.** A step agents must take lives in the instruction that names it; the user rejected hooks, stamp files, generators and sync checks for this.
- **Steers.** Read new messages before each consequential step. A replacement drops the old direction, keeps valid code and proof, and deletes the rejected version once the new one works; an addition extends the work; a tentative idea is explored; "good enough" takes that head to ready. One implementation, with no flags or variants for hypothetical revisions.

## Build

Change and prove per build, Verify, one review round per [Review](#review), fix, Verify, publish per delivery and [Stacks](#stacks).

## Stacks

The user reviews every PR of a thread at the end and squash-merges them one at a time.

- **Chain.** One commit per PR on `<thread branch>-chain`, dependencies first; a follow-up is `git commit --fixup=<commit> -- <paths>` into its layer, and the rebase before a push is `git rebase --autosquash origin/<default branch>`.
- **Layers.** Rebuild each with `git switch -C <branch> <base> && git cherry-pick <commit>`, Verify its head in order, push with `--force-with-lease`, one push per command, then return to the chain. On GitHub link the stack with `gh stack link <numbers, bottom first>`, without `--open`; reuse open PRs and branch names; `gh stack unstack` before reordering.
- **After merges.** Rebase the whole chain, republish every changed layer, unlink each merged PR from the stack and the thread with `unlink_pull_request`, and retarget the next GitLab merge request.

## Review

- **One round** on the whole verified change before the first push, covering every PR of the thread: one Sol child, or one per review lens in parallel when the change touches persisted data, a contract or more than about 300 lines. Each brief holds the goal, the checkout, the range `origin/<default branch>..<head>` and the user's requirements verbatim.
- **Fix** every P1, P2 and trivial P3 in one batch; a second round only when a fix changed a contract.

## Delegate

You own intent, decisions, every repository write, the checkout, branches, preview and browser tab. Delegate what a child makes cheaper, faster or less biased: lookups, inventories, research, thread history, reviews, probes, long commands and runner-up mocks, one child per independent question, all in one batch. Model IDs from `orchestrator_capabilities`, reasoning `high`.

| Work                                     | Model                                            |
| ---------------------------------------- | ------------------------------------------------ |
| Review, audit, critique, thread history  | GPT-6.1 Sol                                      |
| Research, reference lookups, comparisons | Claude Sonnet 5.5                                |
| Probes, inventories, long commands       | GPT-6 Luna or Claude Haiku 5.5, many in parallel |
| Runner-up screen mocks                   | Claude Sonnet 5.5                                |

**Brief.** Open with this line verbatim, then the question and the decision it serves, the user's words verbatim, what each counted item is, scope, exact paths, the stop condition and the return shape:

```text
**Child.** Read-only: write only under /tmp/<task>/ and clones under /tmp/repos/; no delegation, commits, pushes, repository checks, preview, thread messages or questions. Answer first, inline, at most 40 lines. Ground every claim in a file, command or URL you read; mark the rest unverified.
```

A review brief adds "Load the review skill." and no author verdict. A mock brief names its hypothesis, the pick's, the shared data, states and copy, the reference files and the output path.
