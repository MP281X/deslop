---
name: workflow
description: Primary task coordination, ownership and delivery. Use for execution decisions or handoffs; delegated work uses only its assigned procedure.
---

# Workflow

Agreeing and building are cheap, so they run as long as the user wants. Finishing and delivering are slow, so they run once, on a direction the user accepted. The primary writes all code and runs every check, build and test suite.

## 1. Agree

Settle every decision before code. Settle this table with the user:

| Field     | Content                                                                   |
| --------- | ------------------------------------------------------------------------- |
| Intent    | The outcome the user wants, in one or two lines                           |
| Ticket    | Every requirement of the pasted tickets and comments, each a claim        |
| Decisions | Choices already made, including what does not change                      |
| Defaults  | How to decide later choices without asking                                |
| Access    | Accounts, tokens and services the work needs, and who provides each       |
| Size      | Expected files, layers and rough time, with the smaller option first      |
| Done when | Observable criteria: behavior, proof, pull request state, nothing running |

- **Claims.** Write each planned behavior as a one-line claim that can be true or false, such as "a user can pin one file version".
- **Directions.** Where the approach is open, propose two or three directions with their tradeoffs, side by side when a picture is clearer.
- **One question card.** Ask every decision at once, each linked to the claim it changes, with your default first. A default the user did not answer is not agreement.
- **Scope.** The request is the scope. Put related improvements, defects outside the changed code and excluded requirements under **Needs you**. A question that grows the scope states its size.

## 2. Build

Prototype until the user says the result is what they want. Most iterations belong here.

- **Read first.** Read the code you touch and every consumer: callers, test doubles, export assertions, documentation sources and existing capabilities. An analysis request stays read-only.
- **Show the real thing.** Build the smallest working version in the real app with realistic data. Show it as inspected screenshots, a short video or side-by-side renders, and keep a preview the user can open.
- **Stay cheap.** Commit locally as often as useful. Run only the focused check that answers the current question: no root checks, reviews, pushes or pull request updates. After two failed attempts, test a hypothesis that tells the causes apart.
- **Gate.** Before Finish, ask in a question card whether the result is ready, listing what stays open. Finish starts only on the user's yes; a thread launched with an accepted plan already has it.

## 3. Finish

- **Clean.** Audit the branch against the plan per the [cleanup audit](references/children.md#cleanup-audit), split across parallel children for a large diff. Present every candidate in one round as revert, supersede, simplify or keep, defaulting to removal; apply what the defaults cover and ask about the rest. Format only the branch's files, and never restyle code the task does not otherwise change.
- **Verify.** List the reachable input classes of every parser, boundary and state transition the diff changes, starting with paging, identity, first runs and failures, and cover them per testing's Branches rule. Run one [review](references/children.md#code-review) round with one reviewer per lens: code behavior, and instructions and docs. Fix each confirmed finding with a test that fails first. A later round reviews only the hunks added since, and after two rounds the user decides.
- **Prove.** Run the checks that reach the changed code and its consumers. Compare every changed screen with an existing product screen under design. Prove each ticket requirement with the outcome a user sees, per the [capture rules](references/captures.md#rules).

## 4. Deliver

- **Ship.** Update from the default branch and rerun what the update affects. Squash the unpushed checkpoints into one commit per stack layer, and push once. Open or update the draft pull request from the [example body](references/publishing.md#example-body). Record the captures while the pipeline runs, then add them; a body edit starts no pipeline. Push again only for an accepted later change or a pipeline failure.
- **Check the result.** Run one [body reader](references/children.md#body-reader) over the published body and captures, and fix what it confirms. Watch the pull request until its checks finish, and read the exact head and every required job before you report success.
- **Hand off.** Recap each area as behavior and mechanism: what a user or caller can now do, how it works and where it lives, with the riskiest places to read. Stop everything you started except useful evidence and a preview the user wants. Give a manual test script with the URL, sign-in, prepared data and five to eight steps with expected results. When the user restates their understanding, mark each point correct, partly correct or wrong, and list what they missed.
- **Later changes.** A change request after Build returns to Build: prototype it and show it first. Then audit and review only its hunks, rerun the checks and captures they affect, and push once.

## Stacks

A stack splits one task into dependent pull requests, so a reviewer reads one layer at a time. The thread owns the stack as one unit of work.

- **When.** Propose layers in Agree only when they have a reason, such as a contract a reviewer must approve before its consumers.
- **Shape.** Each layer is one commit on its own branch, named `<thread branch>-<n>-<topic>`; the thread's branch is the top layer. Work in the thread's worktree, checked out at the top.
- **Route changes.** Put every change in the layer that owns it: commit it with `git commit --fixup=<layer commit>`, then run `git rebase --autosquash --update-refs <default branch>`. A new concern becomes a new layer only with the user's approval.
- **Stay aligned.** After each update, rebase the top onto the default branch, so every layer contains the layers below it. Every layer must pass its checks, because each one merges alone.
- **Publish.** Open one draft pull request per layer: the bottom targets the default branch, each other layer the layer below. On GitHub, run `gh stack init --adopt <branches>` once, then `gh stack submit`. On GitLab, push each layer with `--force-with-lease` and set each merge request's target branch. Each body covers only its layer.
- **Merges.** The user merges from the bottom. Then rebase the remaining layers onto the default branch, retarget the next pull request and push.

## Always

- **Earn its time.** Skip a step whose result cannot change what you do next, and stop a running step that a newer change made stale. Assume what the pipeline, the review or the user's gate will catch anyway, except for an outward or irreversible step.
- **Order and batch.** Run the step most likely to fail first: a package type check before tests, one test before the suite, a dry run before recording. Run each expensive step once per direction: generation, review and recording.
- **Reuse results.** Keep a ledger in scratch of each check and review, with the files it covered and its result, and rerun only what a change reaches. Before a push, run the formatter check on changed files, type checks and lint for changed packages, and tests that reach changed files. The pipeline runs the rest.
- **Root causes.** When a defect, slowdown or correction repeats, fix the code, type, lint rule, test, script, skill or setting that causes it. Write guidance only for judgment calls.
- **Waits.** Wait on the producer itself: a command's exit status, a unit's state or T3's notice, never a guessed output file or `pgrep`, which matches the waiting shell. A wait ends as soon as its producer fails or stops. Run it in the background when other work remains.
- **Commands.** Never run two commands that write the same build outputs at once. Use `set -o pipefail`, and take the exit status from the command you started. Keep complete logs and reports in scratch, and read only the excerpt you need.
- **Ownership.** A checkout has one writer. Before you continue a branch another thread or child touched, unwatch its pull requests and stop every child that can still write it. Record the processes, containers and exposures you start, stop only those, and stop each as soon as nothing needs it.
- **Secrets.** Read a token inside the command that uses it; never print it or write it into a file, log or body.
- **Parallel.** Start independent reads, children, recording and pull request text at once, in parallel with builds. Post the user's manual steps as soon as their inputs exist.

## Delegate

Delegate self-contained, read-only work when its result saves more than the brief and the join. Run independent children in parallel and in the background.

| Task          | Worth it when                                       | Model               | Procedure                                        |
| ------------- | --------------------------------------------------- | ------------------- | ------------------------------------------------ |
| Cleanup audit | Each area of a large diff during Clean              | GPT-6.1 Sol · high  | [Children](references/children.md#cleanup-audit) |
| Code review   | Each review round, or a concrete risk               | GPT-6.1 Sol · high  | [Children](references/children.md#code-review)   |
| Body reader   | Each published pull request body                    | GPT-6.1 Sol · high  | [Children](references/children.md#body-reader)   |
| Browser proof | A substantial journey on a running host             | GPT-6.1 Sol · high  | [Captures](references/captures.md)               |
| Research      | A bounded investigation while the primary continues | GPT-6 Luna · medium | [Children](references/children.md#research)      |
| Critique      | Independent judgment that can change the direction  | Opus 5.5 · high     | [Children](references/children.md#critique)      |

A brief holds the plan table, the task's own decisions, the procedure's path, sources and what to return; it never restates this skill. Message a running child only with a fact that changes its next action. Reconcile every missing or failed criterion when a child returns.

## Decisions

`CODING_STANDARDS.md` holds repository contracts, a folder's `AGENTS.md` holds its decisions, and environment holds machine facts. Read the owner before you work in its area, and update it when a decision changes. Record only rationale the code cannot show: rejected options, non-goals and failed attempts.
