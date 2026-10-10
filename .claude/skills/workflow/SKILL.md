---
name: workflow
description: Coordination of work that changes and ships code or configuration, from plan to hand-off, with stacks and delegation. Use for implementation tasks; plain questions use explore, reviews use review, and delegated work uses only its assigned procedure.
---

# Workflow

Get code right on the first write, because fix loops are slow and expensive. Research, review and cleanup are read-only, so they run deep, in parallel and in the background. The user steers at any time, and the merge is the user's only gate.

## 1. Prepare

Keep this table in your notes and in child briefs, never in a plan file or a message:

| Field     | Content                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------- |
| Intent    | The outcome the user wants, in one or two lines                                                                |
| Ticket    | Every requirement of the pasted tickets and comments, each a claim, with the full source text linked or quoted |
| Decisions | Choices already made, including what does not change                                                           |
| Defaults  | How to decide later choices without asking                                                                     |
| Access    | Accounts, tokens and services the work needs, and who provides each                                            |
| Size      | Expected files, layers and rough time, with the smaller option first                                           |
| Done when | Observable criteria: behavior, proof, pull request state, nothing running but the previews environment keeps   |

- **Explore first.** Before the first question, start parallel research children per [explore](../explore/SKILL.md) on the touched code and its consumers, existing capabilities, named references and earlier threads.
- **Deal-breakers first.** Find the costs and limits that can make the user reject the plan, such as an expiring login or a lost feature. Ask about them first.
- **Journey first.** Walk one concrete journey of the person who uses the result, step by step, as a render, before any architecture choice.
- **Ask little.** Ask only what a prototype cannot settle: scope, deal-breakers and what only the user holds. Ask each question about behavior the user sees, with your recommendation first and one visible benefit and cost per option. Offer the existing mechanism beside any new one. A question whose fact a child is still finding waits for that child.
- **Directions.** Where the approach is open, try two or three directions on the same data, as `html_render` mockups or quick prototypes. Propose the combination of their best parts. "Not sure" settles nothing: settle it with research or a prototype.
- **Start.** Write each planned behavior as a one-line claim that can be true or false, and start Build without waiting for a confirmation.
- **Scope.** The request is the scope. Put related improvements, defects outside the changed code and excluded requirements under **Needs you**, with their size.

## 2. Build

Iterate until the result meets the plan's claims. A prototype tests a direction on realistic data; docs and edge-case polish wait until the direction holds.

- **Read first.** Give each independent area to its own research child, and start editing the first area while the others map theirs. Read dependencies and earlier threads per [explore](../explore/SKILL.md). An analysis request stays read-only; [review](../review/SKILL.md) decides what follows a review.
- **Show the real thing.** Build the smallest working journey in the real app with realistic data. Inspect its captures and share its preview as soon as it works.
- **Background quality.** When an iteration settles a layer's code, start one deep [code review](../review/SKILL.md#code-review) and one [cleanup audit](../review/SKILL.md#cleanup-audit) of that layer in the same response as its commit, split by area. A layer under 50 hand-written lines gets one child that follows both procedures. Keep building, apply confirmed findings and cleanup defaults in the next iteration, and skip findings on code a later steer replaced.
- **Stay cheap.** Commit locally when useful. Run only the focused check that settles the current question. After two failed attempts, test a hypothesis that tells the causes apart. Find consumers by search, never through type errors. Keep seeds and scripts outside packages that a watcher restarts.
- **Ready.** When the result meets the plan's claims and its findings are applied, continue to Finish without asking; the user steers if they disagree.

## 3. Finish

- **Cover.** Every hand-written hunk of each layer needs a review and a cleanup audit of its final code. Reuse the background rounds, and start one more round only for the hunks they missed. A direct fix to a confirmed finding needs no new review. List cleanup candidates you kept under **Decided**. Add an [instruction review](../review/SKILL.md#instruction-review) for a consequential instruction or configuration change. A layer gets one more review only when a fix changes code outside its finding.
- **Prove.** List the reachable input classes of every changed parser, boundary and state transition per testing's Branches rule, and apply testing's Bugs rule to defects. Run the checks that reach the changed code and its consumers. Compare every changed screen with an existing product screen under design. Prove each ticket requirement with the outcome a user sees, per the [capture rules](references/captures.md#rules).

## 4. Deliver

- **Ship.** Fetch, rebase onto `origin/<default branch>` and rerun what the update affects. Verify a frozen install after a manifest or lockfile change. Publish only layers whose final code is reviewed and tested, per [Stacks](#stacks); failing local checks block the push. Write each body from the [example body](references/publishing.md#example-body), and link every pull request with `link_pull_request`, never `t3_thread_update`, which replaces the earlier link. Record captures while the pipeline runs, then add them; a body edit starts no pipeline.
- **Check the result.** Watch every pushed pull request with `watch_pull_request`. Run one [body reader](../review/SKILL.md#body-reader) over each published body and its captures, and fix what it confirms. When only the pipeline remains, end the turn. On T3's notice, read the exact head and every required job before you report success. A notice about an older head changes nothing: end that turn with one line.
- **Hand off.** Check `list_thread_pull_requests`, link any missing pull request from this work, and unwatch every pull request. For more than five changes, show the change map as a render, with each area's behavior and its riskiest lines linked. Stop everything you started except useful evidence and the previews environment keeps, and link those previews in the final reply. Give a manual test guide only for what you did not prove. When the user restates the result, mark each point correct, partly correct or wrong, and name what they missed.
- **Later changes.** A later request updates the plan and returns to Build: prototype it and show it first. Review and audit only its hunks and their consumers, rerun the checks and captures they affect, and push only the changed layers.

## Stacks

A thread's work splits into pull requests that a reviewer reads one at a time. Unrelated changes become independent pull requests on the default branch, which the user merges in any order. A change that builds on another stacks on it. The thread owns all of them as one unit of work.

- **Layers.** Plan the layers before the first commit, without asking. Split unrelated topics and parts a reviewer can read apart, such as a feature and the code it supersedes, or seeds and demos. Keep each topic wide and each layer under 1,500 hand-written lines; generated files stay with their source and do not count. A cleanup layer, when the task needs one, holds the root fix command's changes, removed superseded code, removed suppressions and fixes for checks that fail on every layer.
- **Independent.** Give each independent layer only the changes it needs to apply to the default branch alone. Stack a layer only when it needs another layer's code. Before each publish, run `git merge-tree --write-tree <layer> <other layer>` for every pair of independent layers. A conflict moves the conflicting change into one layer, so the user never needs a rebase between merges.
- **Chain.** Build all layers as one local chain of commits on `<thread branch>-chain` in the thread's worktree, dependencies before their consumers. Put every change in the layer that owns it with `git commit --fixup=<layer commit>`, then `git rebase --autosquash origin/<default branch>`. A later request about an existing layer's topic changes that layer.
- **Publish.** Rebuild each layer's branch from its base and its commit: `git switch -C <branch> origin/<default branch> && git cherry-pick <layer commit>`, or its dependency's branch for a stacked layer. Name the first branch after the thread and the rest `<thread branch>-<n>-<topic>`, open each as a draft that targets its base, and switch back to the chain. Push with `--force-with-lease`.
- **Testing.** The preview runs the whole chain, so the user tests every layer together. Each step of a manual test guide names the pull request it proves. Each pipeline checks its layer against its base. Start a preview of one layer only when the user asks.
- **Merges.** The user squash-merges any layer at any time. When the thread resumes after a merge, first fetch and rebase the chain onto `origin/<default branch>`, which drops the merged commit. Then republish the layers whose base or diff changed, retarget a stacked pull request whose base merged, and unlink the merged one with `unlink_pull_request`.

## Always

- **Earn its time.** Skip a step whose result cannot change what you do next, and stop a running step that a newer change made stale. Never skip a required review, check or proof.
- **Order.** Run the step most likely to fail first: a package type check before tests, one test before the suite, a dry run before recording.
- **Reuse results.** Keep a ledger in scratch of each check and review, with the files it covered and its result, and rerun only what a change reaches. Before a push, run the repository's root fix, check and test commands; the check and test caches skip what did not change, so the pipeline only confirms.
- **Measure.** When a result can be measured, such as an eval or a benchmark, measure before and after with the same command and inputs.
- **Root causes.** When a defect, slowdown or correction repeats, fix the code, type, lint rule, test, script, skill or setting that causes it. Write guidance only for judgment calls.
- **Waits.** Wait on the command's exit status, the unit's state or T3's notice; never poll files, processes or pipelines. A wait ends as soon as its producer fails, and runs in the background while other work remains. Run a custom condition's check once before waiting on it, and never wait more than 60 seconds on a condition you have not seen succeed. When only children remain, wait in the turn with `t3_thread_wait` on the child thread and `timeoutMs` 1500000. A steer ends the wait with an error that reads like a refusal: answer the steer, then wait again. After a terminal status, call `task_status` once to read the result.
- **Commands.** Never run two commands that write the same build outputs at once. Use `set -o pipefail`, and take the exit status from the command you started. Scripts stop at the first failed login, request or run. Keep complete logs in scratch.
- **Ownership.** A checkout has one writer. Never change the calling thread's model or options. Record the processes, containers and exposures you start, and stop each as soon as nothing needs it.
- **Secrets.** Read a secret inside the command that uses it. Never print a secret or put its value in command text, a file, a log or a body. Use `request_secret` only for a tool that takes a `secretRef`; the user enters any other secret through a guide under **Needs you**.

## Delegate

Give children every exploration and every read-only check: code areas, dependencies, references, earlier threads, reviews and audits. The primary keeps every write, check, build and browser session. Prefer two deep rounds to many shallow ones. Start children in parallel and in the background, and keep working while they run. Use a fast tier, Claude's Fast Mode or Codex's priority tier, only for a child the user waits on with nothing else running.

| Task               | Start one for                                                   | Procedure and model                             |
| ------------------ | --------------------------------------------------------------- | ----------------------------------------------- |
| Research           | Each open question, independent code area or cross-package fact | [explore](../explore/SKILL.md)                  |
| Critique           | The recommended direction                                       | [review](../review/SKILL.md#critique)           |
| Cleanup audit      | Each area of a layer whose code settled                         | [review](../review/SKILL.md#cleanup-audit)      |
| Code review        | Each area of a layer whose code settled, or a risk              | [review](../review/SKILL.md#code-review)        |
| Both, one child    | A layer under 50 hand-written lines                             | Code review, then cleanup audit                 |
| Body reader        | Each published pull request body                                | [review](../review/SKILL.md#body-reader)        |
| Instruction review | Each consequential instruction or configuration change          | [review](../review/SKILL.md#instruction-review) |

Pick each child's provider, model, effort and tier from `orchestrator_capabilities` per its procedure, and use the primary's model when that model is unavailable. A brief holds the plan table, the task's own decisions, the procedure's path, the checkout and how to reach it, sources and what to return; it never restates this skill. Message a running child only with a fact that changes its next action. Start each review round with a new `delegate_task` and `clientRequestId`, and list every earlier finding in its brief, confirmed or rejected, with every open objection. Reconcile every missing or failed criterion when a child returns.

## Decisions

`CODING_STANDARDS.md` holds repository contracts, a folder's `AGENTS.md` holds its decisions, and environment holds machine facts. Read the owner before you work in its area, and update it when a decision changes. Record only rationale the code cannot show: rejected options, non-goals and failed attempts.
