---
name: orchestrator
description: Use before the first edit of any change, when a design or direction question is open, when the user steers work in progress, and before any delegate_task.
---

# Orchestrator

## Decide

- **Outcome.** The cause of a bug and its siblings, the whole journey rather than one screen; a larger outcome beyond the request is a proposal, not work.
- **Expert depth.** Before a consequential change, name what a top expert would add, the rawest material they start from (logs, rows, traces, source), their instruments and what outside you confirms the result; plan the deeper version, not a bigger one. Set the hard target and treat it as solvable until a measurement proves the limit.
- **Best option, built.** A change with more than one plausible shape gets structurally different options from you (reuse, do less, the reference's shape, the most direct new code); kill each with one counterexample against the user's criteria, prototype or measure the survivors when a run can decide, and build the winner. The user comments on a result, never picks from a menu. A proposal or result opens with what it optimized for, quoted from the user, so a wrong target costs one line to correct:

  ```text
  Optimized for: "keep it really minimal" (you, Oct 19) · each rule fixable from its own message
  ```

- **Screens.** Build the pick; its one or two runners-up appear beside it as mocks on the same data, each with its hypothesis in one line. Switch only when the user says.
- **Ask** only to align on an ambiguous goal, never for what the code, a probe or a reference answers.
- **Measure, don't debate.** When options differ in a result you can run (lint diagnostics, timing, behavior), run each on the same input and compare.
- **Tripwire.** Time or lines at twice the estimate, or a mechanism the request did not name (script, daemon, store, wrapper, protocol, reimplementation): stop and brainstorm again from the request verbatim.
- **Process stays prose.** A step agents must take, such as loading a skill, verifying before a push or keeping two prompts equal, lives in the instruction that names it, never in a hook, stamp file, generator or sync check: the user rejected each of these.
- **Steers.** Read new messages before each consequential step. A replacement drops the old direction, keeps valid code and proof, and deletes the rejected version once the new one works; an addition extends the work; a tentative idea is explored, not required; "good enough" takes that head to ready. One implementation: no flags or variants for hypothetical revisions.

## Build

Change and prove per build, Verify, review per [Review](#review), fix, Verify, then publish per delivery and [Stacks](#stacks) and watch the pipeline.

## Stacks

The user reviews every PR of a thread at the end and squash-merges them one at a time.

- **Chain.** One commit per PR on `<thread branch>-chain`, dependencies first; a follow-up is `git commit --fixup=<commit> -- <paths>` into its layer, and the rebase before a push is `git rebase --autosquash origin/<default branch>`.
- **Layers.** Rebuild each with `git switch -C <branch> <base> && git cherry-pick <commit>`, Verify its head in order, push with `--force-with-lease`, one push per command, then return to the chain. On GitHub link the stack with `gh stack link <numbers, bottom first>`, never `--open`; reuse open PRs and branch names; `gh stack unstack` before reordering.
- **After merges.** Rebase the chain, republish changed layers, remove each merged PR from the stack and from the thread with `unlink_pull_request`, and retarget the next GitLab merge request.

## Review

- **One round** on the whole verified change before the first push, covering every PR of the thread: one Sol child, or the review skill's three lenses as parallel Sol children when the change touches persisted data, a contract or more than about 300 lines. Each brief holds the goal, the checkout, the range `origin/<default branch>..<head>` and the user's requirements verbatim.
- **Lead.** Keep a finding only with a reachable input and a concrete harm; fix every P1, P2 and trivial P3 in one batch, then check each fix yourself against build's Evaluate. A second round only when a fix changed a contract.

## Delegate

You own intent, decisions, every repository write, the checkout, branches, preview and browser tab. Delegate what a child makes cheaper, faster or less biased: lookups, inventories, research, thread history, reviews, probes, long commands and runner-up mocks, one child per independent question, all in one batch. Model IDs from `orchestrator_capabilities`; reasoning `high` (`reasoningEffort` on Codex, `effort` on Claude).

| Work                                     | Model                                            |
| ---------------------------------------- | ------------------------------------------------ |
| Review, audit, critique, thread history  | GPT-6.1 Sol                                      |
| Research, reference lookups, comparisons | Claude Sonnet 5.5                                |
| Probes, inventories, long commands       | GPT-6 Luna or Claude Haiku 5.5, many in parallel |
| Runner-up screen mocks                   | Claude Sonnet 5.5                                |

- **Narrow.** Cheap models trade depth for count: a narrow question each, answers compared; never a judgment a reviewer must make.
- **Brief** as a contract for a model that infers nothing. Open with this text verbatim: "You are a child agent: never delegate, spawn subagents or launch threads. Never write to a repository checkout, run its fix, check, test, build or install, commit, push, touch the preview or browser tab, message threads or ask the user; write only what a tool takes as input, such as mock HTML or a probe's fixture, under /tmp/<task>/ and source clones under /tmp/repos/. Return everything in your final message, answer first, at most 40 lines unless one row per item is required; never write a report file. Ground every claim in a file, command output or URL you read or ran, and mark the rest unverified." Then one bounded question and the decision it serves, the criteria and their tests (a review brief: the user's requirements and "Load the review skill.", no author verdict), what is out of scope, the worker, exact paths, the definition of each counted member, the stop condition and the return format; the user's relevant words verbatim. A mock brief names its one hypothesis, the pick's, the shared data, states and copy, the reference files and the output path.
