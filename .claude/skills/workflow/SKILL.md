---
name: workflow
description: Primary task coordination, ownership and delivery. Use for execution decisions or handoffs; delegated work uses only its assigned procedure.
---

# Workflow

Agreeing and building are cheap, so they run as long as the user wants. Finishing and delivering are slow and expensive, so they run once, on a direction the user already accepted. The primary agent writes all code and runs the shared checks, builds and test suites. Children only read, with probes and focused existing tests.

## 1. Agree

Spend time here: brainstorm, compare directions and settle every decision before code. Settle this table with the user:

| Field     | Content                                                                   |
| --------- | ------------------------------------------------------------------------- |
| Intent    | The outcome the user wants, in one or two lines                           |
| Ticket    | Every requirement of the pasted source tickets and comments, each a claim |
| Decisions | Choices already made, including what does not change                      |
| Defaults  | How to decide later choices without asking                                |
| Access    | Accounts, tokens and services the work needs, and who provides each       |
| Size      | Expected files, children and rough time, with the smaller option first    |
| Done when | Observable criteria: behavior, proof, pull request state, nothing running |

- **Tickets.** Keep the full source tickets and follow-up comments in the plan, and split them into requirements.
- **Directions.** Where the approach is open, propose two or three directions with their tradeoffs, shown side by side when a picture is clearer.
- **Claims.** Write each planned behavior as a one-line claim that can be true or false, such as "a user can pin one file version".
- **One question card.** Ask every decision the work needs at once. Link each decision to the claim it changes, and mark your default. A default the user did not answer is not agreement.
- **Scope.** The request is the scope. Put related improvements, defects outside the changed code, test-only capabilities and excluded requirements under **Needs you**; never drop them silently. A question that grows the scope states its size, with the smaller option first.

## 2. Build

Prototype until the user says the result is what they want. Most iterations belong here, where they cost little.

- **Read first.** Read the code you touch and every consumer: runtime callers, test doubles, export assertions, documentation sources and existing capabilities. Reuse findings from named threads. An analysis request stays read-only.
- **Show the real thing.** Build the smallest working version in the real app with realistic data. Show it as inspected screenshots, short video or side-by-side renders, and keep a preview the user can open, per environment's preview rules. Raise every open question now.
- **Stay cheap.** Commit locally as often as useful. Run only the focused check that answers the current question: no root checks, review rounds, pushes, pipeline watches or pull request updates. Ask only about unknowable goals, access, scope or open taste, and keep working meanwhile. After two failed attempts, test a hypothesis that tells the causes apart.
- **Gate.** Before Finish, ask in a question card whether the result is ready, listing what stays open and any access you still need. Finish starts only on the user's yes to that card; a thread launched with an accepted plan already has it.

## 3. Finish

Post one line when Build, Finish or Deliver starts, saying what remains.

- **Clean.** Audit the branch against the plan per the [cleanup audit](references/children.md#cleanup-audit), split across parallel children for a large diff. Present every candidate in one round as revert, supersede, simplify or keep, defaulting to removal. Apply what the defaults cover and ask about the rest. Remove scratch code, format only the branch's files, and revert your own edits outside the task.
- **Verify.** List the reachable input classes of every parser, boundary and state transition the diff changes, starting with paging, identity, first runs and failures. Cover them per testing's Branches rule. Run one [review](references/children.md#code-review) round with one reviewer per lens: code behavior, and instructions and docs checked against each other. Split an area that one reviewer cannot read, and fix each confirmed finding with a test that fails first. Review fixes again only when they grew beyond the finding; after two rounds, the user decides. Fix each confirmed defect, or get the user's decision in the thread before the push.
- **Prove.** Run the checks that reach the changed code and its consumers. Compare every changed screen with an existing product screen under design, and fix what differs. Prove each ticket requirement with the outcome a user sees, per the [capture rules](references/captures.md#rules).

## 4. Deliver

- **Ship.** Update from the default branch and rerun what the update affects. Squash only the unpushed checkpoints and push once. Open or update the draft pull request from the [example body](references/publishing.md#example-body), and link it to the thread immediately. Record the captures while the pipeline runs, then add them; a body edit starts no pipeline. Push again only for an accepted later change or a pipeline failure. Failing local checks block the push, and other irreversible or outward actions need confirmation.
- **Check the result.** Run one [body reader](references/children.md#body-reader) over the published body and captures, and fix what it confirms. While checks remain, watch the pull request with T3 and end the turn. A T3 wake is a notification, not a verdict: check the exact head and every required job before you report success.
- **Hand off.** Recap each area at the level of behavior and mechanism: what a user or caller can now do, how it works and where it lives. Link the code and name the riskiest places to read. When the user restates their understanding, mark each point correct, partly correct or wrong, correct it, and list what they missed. Unwatch the pull request, and stop everything you started except useful evidence and a preview the user wants. Leave that preview running per environment's preview rules. Give a manual test script with the URL, sign-in, prepared data and five to eight steps with expected results.
- **Later changes.** A change request during Finish or Deliver, or after delivery, updates the plan and returns to Build: prototype it and show it first. Then Finish and Deliver run only for its hunks: audit and review the new hunks, rerun the checks and captures they affect, and push once.

## Always

- **Earn its time.** Before each step, ask whether its result can change what you do next, and skip it when it cannot. Stop a running step that a newer change made stale when finishing it brings nothing. Assume what a step that runs anyway will catch cheaply: the pipeline, the review round or the user's gate. Never assume for an outward or irreversible step.
- **Order and batch.** Run the smallest step most likely to fail first: a package type check before tests, one test before the suite, a dry-run before recording. Collect the changes of one direction, then run each expensive step once: generation, review and recording.
- **Reuse results.** Keep a ledger in scratch of each check and review: the files it covered and its result. After a change, rerun only what its inputs reach. Before a push, run type checks and lint for changed packages, plus tests that reach changed files. The pipeline runs the rest.
- **Root causes.** When a defect, slowdown or correction repeats, fix its cause rather than the single case. Change the owning code, type, lint rule, test, script, skill or setting; write guidance only for judgment calls. Use the repository's named scripts, and fix a script that keeps failing.
- **Wait, never poll.** Wait on one blocking command, a build's exit status, `t3_thread_wait` or T3's notice, never on a guessed output file or on `pgrep` of a command line, which matches the waiting shell itself. Run it in the background when independent work remains, and resume an interrupted wait instead of starting it again. Read a child's result once.
- **Checks.** Serialize checks that compete for resources or share outputs, per environment's heavy-command lock. Give every server you start a readiness probe. Use `set -o pipefail`, and take the exit status from the command you started.
- **Context.** Keep complete logs, reports and inventories in scratch, and read only the excerpt the next edit needs.
- **Ownership.** Record the process groups, containers, exposures and resources you start, and stop only those, never by name, port or image. Stop each as soon as nothing needs it, not only at handoff. Never write a secret's value in a command; read it inside the command. Never change the calling thread's model or options.
- **Parallel.** Writes stay serial in the primary. Start independent reads, children, recording and pull request text at once, in parallel with builds.

## Delegate

Delegate self-contained, read-only work when its result saves more than the brief and the join. Children read, run inline scripts and focused existing tests, and keep captures in their own scratch directory outside the repository. They never write tracked files, touch the primary's services, delegate or message threads. Run independent children in parallel and in the background.

| Task          | Worth it when                                       | Model               | Procedure                                        |
| ------------- | --------------------------------------------------- | ------------------- | ------------------------------------------------ |
| Cleanup audit | Each area of a large diff during Clean              | GPT-6.1 Sol · high  | [Children](references/children.md#cleanup-audit) |
| Code review   | Each review round, or a concrete risk               | GPT-6.1 Sol · high  | [Children](references/children.md#code-review)   |
| Body reader   | Each published pull request body                    | GPT-6.1 Sol · high  | [Children](references/children.md#body-reader)   |
| Browser proof | A substantial journey on a running host             | GPT-6.1 Sol · high  | [Captures](references/captures.md)               |
| Research      | A bounded investigation while the primary continues | GPT-6 Luna · medium | [Children](references/children.md#research)      |
| Critique      | Independent judgment that can change the direction  | Opus 5.5 · high     | [Children](references/children.md#critique)      |

Check each model against T3's live catalog and the user's budget, and use the primary's model when one is missing. A brief, to a child or a thread, holds the plan table, the task's own decisions, the procedure's path, sources and what to return. It never restates this skill. The model and its options go in tool fields. Message a running child only with a fact that changes its next action. Reconcile every missing or failed criterion when a child returns. A new round is a fresh task with the prior findings.

Commands for links, publishing, pipeline watches and baselines live in [publishing](references/publishing.md#commands).

## Decisions

`CODING_STANDARDS.md` holds repository contracts, a folder's `AGENTS.md` holds its decisions, and environment holds machine facts. Read the owner before you work in its area, and update it in place when a decision changes. Record only rationale the code cannot show: rejected options, non-goals and failed attempts.
