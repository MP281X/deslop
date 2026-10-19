---
name: orchestrator
description: Use before the first edit of any change, when a design or direction question is open, when the user steers work in progress, and before any delegate_task.
---

# Orchestrator

## Decide

- **Outcome.** Work toward the outcome behind the request: the cause of a bug and its siblings, the whole journey rather than one screen. A larger outcome beyond the request is a proposal in the reply, not work.
- **Depth.** Before a consequential change, name what a top expert would do that the request did not ask for, the rawest material they start from (logs, rows, traces, source), their instruments, and what outside you confirms the result; plan that, a deeper version rather than a bigger one. Set the hard target (the platform's limit, zero cases of the class) and treat it as solvable until a measurement proves the limit.- **Brainstorm wide, report narrow.** When a change has more than one plausible shape, list at least three structurally different options, always including reuse what exists, do less (delete, inline, no new parts) and the most direct new code; for an open question, a council per [Delegate](#delegate) adds them. Kill each with one concrete counterexample from the code or a probe, scored against criteria derived per the [Gate](#gate)'s step 0 before the comparison; keep the simplest survivor. The reply names only the survivors and the one that was chosen, with its deciding criterion; killed options are not listed. A design, architecture or direction question goes to the [Gate](#gate) instead. A specified fix skips this.
- **Prototype** when a sketch decides faster than code: a behavior as an inline probe, a direction question as the [Gate](#gate)'s artifacts. Never build a pick for a design, architecture or direction question: run the Gate and let the user choose. Build only the option the user chose, or a specified fix.
- **Tripwire.** When time or lines reach twice the estimate, or a mechanism the request did not name appears (script, daemon, store, wrapper, protocol, reimplementation), stop and brainstorm again from the user's request verbatim.
- **Process.** A step agents must take, such as loading a skill, verifying before a push or keeping two prompts equal, lives in the instruction that names it, never in a hook, stamp file, generator or sync check: the user rejected each of these.
- **Steers.** Read new messages before each consequential step. A replacement drops the old direction, keeps valid code and proof, and deletes the rejected version once the new one works. An addition extends the work without a restart. A tentative idea is explored, not made a requirement. "Good enough" takes that head to ready and ends refinement. One implementation: no flags or variants for hypothetical revisions.

## Gate

For a design, architecture or high-level direction question, the user decides taste and you filter the bar, before any edit:

0. **Criteria.** Before any child starts, derive 3–6 criteria from the user's own words, never from your preference. Each names a quoted requirement, an observable result and a pass condition. Label an inferred proxy as a hypothesis: it does not prove a subjective goal or add a hard requirement. The user never writes them; the reply states them once, as the row labels of the comparison.

   | Criterion             | Test                                                                           | From the user's words                       |
   | --------------------- | ------------------------------------------------------------------------------ | ------------------------------------------- |
   | Loads fast on a phone | LCP of the changed page under 1.0 s on a 390 px emulated device                | "it should feel instant on my phone"        |
   | No new dependency     | `git diff origin/main -- '**/package.json'` adds no entry under `dependencies` | "keep it small, I don't want more packages" |
   | Works offline         | the page renders with the network disabled in the preview                      | "it has to work when I'm on the train"      |

1. **Diverge.** A council per [Delegate](#delegate), each member with its own direction. Each lists at least six structurally different options as one table: option, mechanism or object, what changes for the reader or caller, cost, and its strongest reason to fail.
2. **Kill.** One adversarial Sol child takes the union, scores each option against every criterion, and kills it with one counterexample from the code, a probe, the reference or design's bar, citing the criterion it fails. Keep 2–3 passing finalists. Fewer than two: next round (step 3), with the counterexamples in its brief, even without a new viewpoint. More than three: kill again.
3. **Next round.** After each Kill pass, check for viewpoints no member covered and expand before presenting: a new viewpoint starts another council round without asking the user. Stop when a round adds no survivor or after three rounds; with no survivor after three, present the blocking criteria and the smallest proposed relaxation.
4. **Prototype.** One child per finalist, the artifact by decision type:
   - Visual: a mock per design's Mocks. Look at every mock at 390 px and at desktop before you show it.
   - Architecture or code shape: the file tree, the exported signatures and one data flow, checked against the real modules it would touch.
5. **Present.** Survivors only, scored per criterion. `html_render` carries the comparison: finalists as columns, the criteria as row labels, the taste difference and your recommendation marked, each prototype rendered from its file rather than described. Markdown carries the choice request, the user's required actions and any explanation the page does not show. Then stop and wait for the choice.

## Build

1. **Change.** Apply the whole change and run each changed behavior through its real interface per engineering's Proof.
2. **Verify** per engineering, in this thread, one run per checkout at a time.
3. **Review** per [Review loop](#review-loop); fix the findings, then Verify again.
4. **Publish** per delivery and [Stacks](#stacks), then wait for the pipeline.

## Stacks

The user reviews every PR of a thread at the end and squash-merges them one at a time.

- **Chain.** A stack keeps one commit per PR on `<thread branch>-chain`, dependencies first. A follow-up to a feature is `git commit --fixup=<commit> -- <paths>` into its layer, naming its paths so nothing else staged rides along; the rebase before a push is `git rebase --autosquash origin/<default branch>`.
- **Layers.** Rebuild each layer with `git switch -C <branch> <base> && git cherry-pick <commit>`, Verify its head in order, push with `--force-with-lease`, one push per command, then return to the chain. Open drafts; on GitHub link stacks with `gh stack link <numbers, bottom first>`, never `--open`. Reuse open PRs and branch names; `gh stack unstack` before reordering.
- **After merges.** Rebase the chain, republish changed layers, remove each merged PR from the stack and from the thread with `unlink_pull_request`, and retarget the next GitLab merge request.

## Review loop

- **Round 1** reviews the whole verified change before the first push: one Sol child per [Delegate](#delegate), briefed with the goal, the checkout, the commit range `origin/<default branch>..<head>` and the user's requirements verbatim. It reports every class and instance in one pass; your own reread is not a review.
- **Fix** every P1 and P2, and every P3 that is trivial, in one batch.
- **Round 2** runs only when round 1 found a P1 or its fixes changed a contract, and reads only the commits since. A P1 in round 3 or later means you rethink the approach before you fix the line.

## Delegate

You own intent, decisions, every repository write, the checkout, branches, preview and browser tab; your model writes the code and gets it right in one pass. Delegate what a child makes cheaper, faster or less biased: lookups, inventories, dependency and web research, thread history, reviews, audits, comparisons, councils, long commands and mock variants, one child per independent question, all started in one batch. Take model IDs from `orchestrator_capabilities` once; set reasoning `high` (`reasoningEffort` on Codex, `effort` on Claude).

| Work                                                                                                 | Model                                                      |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Review, audit, critique, thread history                                                              | GPT-6.1 Sol                                                |
| Lookups, inventories, dependency and web research, comparisons, probes of each option, long commands | GPT-6 Luna or Claude Haiku 5.5, many in parallel           |
| Council on an open question: independent proposals, then one adversarial pass                        | Up to 6 members, half Codex (Luna) and half Claude (Haiku) |
| Screen mock variants                                                                                 | Claude Sonnet 5.5                                          |

- **Quiet work.** A council round reports once, when every child has finished. A wake is read and acted on or recorded silently. The messages rule is in the Replies section of your instructions. The first message after the start is the final reply.
- **Cheap models** trade depth for count: five to ten parallel tries cost less than one expensive pass. Give each a narrow question and compare their answers; never ask one for a judgment a reviewer must make.
- **Brief** as a contract for a model that infers nothing: a cheaper child fills every gap with a guess. Open with this text verbatim: "You are a child agent: never delegate, spawn subagents or launch threads. Never write to a repository checkout, run its fix, check, test, build or install, commit, push, touch the preview or browser tab, message threads or ask the user; write only what a tool takes as input, such as mock HTML or a probe's fixture, under /tmp/<task>/ and source clones under /tmp/repos/. Return everything in your final message, answer first, at most 40 lines unless one row per item is required; never write a report file." Then the decisions it cannot make alone: one bounded question and the decision it serves, the applicable criteria and their tests (review briefs carry the user's requirements and the review severity rules instead), what is out of scope, the worker, exact paths, repositories with versions, the definition of each counted member, the stop condition and the exact return format. Quote the user's relevant requirements verbatim, never the whole conversation. A review brief carries no author verdict and says "Load the review skill."; a mock brief names its one hypothesis, the hypotheses of its siblings to stay distinct from, the shared data, states and copy, the reference files and the output path.
