---
name: workflow
description: Primary task coordination, ownership and delivery. Use for execution decisions or handoffs; delegated work uses only its assigned procedure.
---

# Workflow

Agreeing and building are cheap, so they run as long as the user wants. Finishing and delivering are slow, so they run once per accepted direction, and a later change reruns only what it touches. The primary writes code and runs shared checks, builds and test suites.

## 1. Agree

Interview the user until every decision that changes what the user gets is settled. Find every fact yourself; ask the user only for decisions that change what they see. The interview ends with this table:

| Field     | Content                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------- |
| Intent    | The outcome the user wants, in one or two lines                                                                |
| Ticket    | Every requirement of the pasted tickets and comments, each a claim, with the full source text linked or quoted |
| Decisions | Choices already made, including what does not change                                                           |
| Defaults  | How to decide later choices without asking                                                                     |
| Access    | Accounts, tokens and services the work needs, and who provides each                                            |
| Size      | Expected files, layers and rough time, with the smaller option first                                           |
| Done when | Observable criteria: behavior, proof, pull request state, nothing running but a preview the user wants         |

- **Deal-breakers first.** Before any plan, find the costs and limits that can make the user reject it, such as an expiring login or a lost feature, and ask about them first.
- **Explore first.** Before the first question, start parallel research children for the facts the decisions need. Cover the touched code and its consumers, existing capabilities, named references and earlier threads. Read the implementation of each named reference's relevant feature in its source checkout per research, not only its README. A failed search or fetch is not a finding: never report "the reference has no such feature" without the source, and never ask the user for a fact you can fetch.
- **Journey first.** Walk one concrete journey of the person who uses the result, step by step, before any architecture question. Show it as a render.
- **Design tree.** Map the decisions as a tree, where each decision opens the decisions that depend on it. The frontier is every open decision whose prerequisites are settled.
- **Rounds.** Ask the whole frontier in one question card, up to the card's limit, and the rest in the next card. Recompute the frontier after each answer. A question whose fact a child is still finding waits for that child; ask the rest now.
- **Questions.** Ask about behavior the user sees, never about a detail you can decide. Turn a mechanism choice into the behavior it changes, such as "exact order for new runs only" against "required fields first for every run", and pick the mechanism yourself. Put your recommendation first and add "(Recommended)" to its label. Each option's description gives one visible benefit and one visible cost. A direction question also offers "Not sure, show me mockups". Offer the existing mechanism beside any new one, such as a member without a team beside a new role.
- **Directions.** Where the approach is open, render two or three directions as mockups with `html_render`, side by side with the same data, before any real prototype. Never build only the first idea.
- **Unsure stays open.** "Not sure" settles nothing. Settle it with research, a render or a prototype, then ask again; never record it as a decision.
- **Claims.** Write each planned behavior as a one-line claim that can be true or false, such as "a user can pin one file version".
- **Done.** The interview ends when the frontier is empty. Show the table with each decision marked as the user's answer or your default, and ask for confirmation.
- **Plan in the thread.** Keep the plan table in the thread and in child briefs. Write no plan file, and use no plan mode.
- **Scope.** The request is the scope. Put related improvements, defects outside the changed code and excluded requirements under **Needs you**. A question that grows the scope states its size.

## 2. Build

Prototype until the user says the result is what they want. Most iterations belong here. A prototype is a throwaway MVP that tests a direction: it works on realistic data and looks good enough to judge, with no tests, docs or edge-case polish.

- **Read first.** Read the code you edit. Get every consumer from a research child or one batched search: callers, test doubles, export assertions, documentation sources and existing capabilities. Give each independent area to its own research child, and start editing the first area while the others map theirs. Read dependencies and earlier threads per [research](references/children.md#research). An analysis request stays read-only.
- **Show the real thing.** Build the smallest working version in the real app with realistic data. Show it as inspected screenshots, a short video or side-by-side renders, and keep a preview the user can open. Set up the tailnet URL with the preview, and post it as soon as one journey works.
- **Stay cheap.** Commit locally as often as useful. Run only the focused check that answers the current question: no root checks, reviews, pushes or pull request updates. After two failed attempts, test a hypothesis that tells the causes apart.
- **Batch edits.** Get the complete consumer list from a child or one search, edit every site, then type-check once. A type checker is not a search tool. Keep seeds and scripts outside packages that a watcher restarts.
- **Gate.** Before Finish, ask in a question card whether the result is ready, listing what stays open. Finish starts only on the user's yes; a thread launched with an accepted plan already has it.

## 3. Finish

- **Clean.** Audit the branch against the plan per the [cleanup audit](references/children.md#cleanup-audit), split across parallel children for a large diff. Present every candidate in one round as revert, supersede, simplify or keep, defaulting to removal; apply what the defaults cover and ask about the rest. Format only the branch's files, and never restyle code the task does not otherwise change.
- **Verify.** List the reachable input classes of every changed parser, boundary and state transition. Start with paging, identity, first runs and failures, and follow testing's Branches rule. Run one [review](references/children.md#code-review) round for code behavior, plus an instructions reviewer when the change alters instructions in a consequential way. Fix confirmed findings, and apply testing's Bugs rule to behavior defects. Review a fix again only when it changes code outside its finding; after two rounds the user decides.
- **Prove.** Run the checks that reach the changed code and its consumers. Compare every changed screen with an existing product screen under design. Prove each ticket requirement with the outcome a user sees, per the [capture rules](references/captures.md#rules).

## 4. Deliver

- **Ship.** Update from the default branch and rerun what the update affects. Verify a frozen install after a manifest or lockfile change. Squash the unpushed checkpoints into one commit per stack layer, and push once; failing local checks block the push. Open or update the draft pull request from the [example body](references/publishing.md#example-body). Link it with `link_pull_request` and with `t3_thread_update` action `link_pull_request`, because T3 shows the pull request only after the second. Record the captures while the pipeline runs, then add them; a body edit starts no pipeline. Push again only for an accepted later change or a pipeline failure.
- **Check the result.** Run one [body reader](references/children.md#body-reader) over the published body and captures, and fix what it confirms. Watch the pull request until its checks finish, and read the exact head and every required job before you report success.
- **Hand off.** Show the change map as a render, with each area's behavior and its riskiest lines linked. Stop everything you started except useful evidence and a preview the user wants. Put a manual test script under Needs you: the URL, sign-in, prepared data and five to eight steps with expected results. When the user restates their understanding, mark each point correct, partly correct or wrong, and list what they missed.
- **Later changes.** A change request after Build updates the plan and returns to Build: prototype it and show it first. Then audit and review only its hunks, rerun the checks and captures they affect, and push once.

## Stacks

A stack splits one task into dependent pull requests, so a reviewer reads one layer at a time. The thread owns the stack as one unit of work.

- **When.** Stacks make independent changes easier to review. Split the work into layers without asking whenever it holds independent changes, such as unrelated topics in one thread or a contract before its consumers.
- **Topics.** Keep each layer's topic wide, such as "agent instructions" or "Dual lint rules", and merge narrow topics into one layer. A thread with more than four layers has topics that are too narrow.
- **Order.** Order layers by importance, the most important at the bottom, so it merges first. A contract stays below its consumers, and a topic that arrives later goes on top.
- **Shape.** Each layer is one commit on its own branch. The thread's branch holds the first layer, and later layers are named `<thread branch>-<n>-<topic>`. Work in the thread's worktree, checked out at the top.
- **Route changes.** Put every change in the layer that owns it, the bottom one included: commit it with `git commit --fixup=<layer commit>`, then run `git rebase --autosquash --update-refs <default branch>` from the top. A later request about an existing layer's topic changes that layer, never a new layer on top.
- **Stay aligned.** After each update, rebase the top onto the default branch, so every layer contains the layers below it. Every layer must pass its checks, because each one merges alone.
- **Publish.** Open one draft pull request per layer. The bottom targets the default branch, and each later layer targets the layer below it. On GitHub, run `gh stack init <branches>` once, then `gh stack submit --auto`, which creates drafts. On GitLab, push each layer with `--force-with-lease` and set each merge request's target branch. Each body covers only its layer.
- **Report.** After each push, the reply links every layer whose pull request changed, with one line on what changed in it. The user reviews only those layers, so leave out layers whose diff stayed the same.
- **Merges.** The user merges from the bottom. Then rebase the remaining layers onto the default branch, retarget the next pull request and push.

## Always

- **Earn its time.** Skip a step whose result cannot change what you do next, and stop a running step that a newer change made stale. Assume what the pipeline, the review or the user's gate will catch anyway, except for an outward or irreversible step.
- **Order and batch.** Run the step most likely to fail first: a package type check before tests, one test before the suite, a dry run before recording. Run each expensive step once per direction: generation, review and recording.
- **Reuse results.** Keep a ledger in scratch of each check and review, with the files it covered and its result, and rerun only what a change reaches. Before a push, run the repository's fix command on the branch's changed files, Markdown included. Then run type checks and lint for changed packages, and tests that reach changed files. The pipeline runs the rest.
- **Iterate measurable results.** When a result can be measured or compared, such as an eval, a benchmark or a screen against a reference, run two or three rounds of improve and measure before you show it.
- **Root causes.** When a defect, slowdown or correction repeats, fix the code, type, lint rule, test, script, skill or setting that causes it. Write guidance only for judgment calls.
- **Waits.** Wait on the command's exit status, the unit's state or T3's notice. Never wait on a guessed output file or `pgrep`, which also matches the waiting shell. A wait ends as soon as its producer fails or stops, and runs in the background when other work remains. Before waiting on a custom condition, run its check once; never wait more than 60 seconds on a condition you have not seen succeed. When only children remain, wait in the turn: call `t3_thread_wait` on the child thread with `timeoutMs` 1500000. A steered message interrupts the wait, so a long wait never delays an answer. Call `task_status` once, after the wait reports a terminal status, to read the result and acknowledge its notice. This overrides the tool's advice to end the turn.
- **Commands.** Never run two commands that write the same build outputs at once. Use `set -o pipefail`, and take the exit status from the command you started, never from a filtered excerpt or a string count. Scripts stop at the first failed login, request or run. Keep complete logs and reports in scratch, and read only the part of a log you need.
- **Ownership.** A checkout has one writer. Before you continue a branch another thread or child touched, unwatch its pull requests and stop every child still working on it. Never change the calling thread's model or options. Record the processes, containers and exposures you start, stop only those, and stop each as soon as nothing needs it.
- **Secrets.** Read a secret inside the command that uses it; never print it or write it into a command, file, log or body.
- **Parallel.** Start independent reads, children and pull request text at once, in parallel with builds. Post the user's manual steps as soon as their inputs exist.
- **Autonomy.** Do every step you can reach yourself: sign-ins, seeds, browser setup and settings pages. Ask the user only for decisions and for what only they hold. Use `request_secret` only for a tool that takes a `secretRef`. For any other secret, such as an API key in an app's settings, the user enters it: give a numbered guide under **Needs you**.

## Delegate

Most children run on the Codex subscription, which exists for them, so their reads are cheap and the primary's time is not. Give children every exploration: code areas, dependencies, references and earlier threads. The primary reads only the files it edits, and keeps every write, check and build. Start children in parallel and in the background, and keep working while they run. Run Codex children on the Fast service tier.

| Task          | Start one for                                        | Model               | Procedure                                        |
| ------------- | ---------------------------------------------------- | ------------------- | ------------------------------------------------ |
| Research      | Each open question or independent code area          | GPT-6 Luna · medium | [Children](references/children.md#research)      |
| Deep research | A fact that needs tracing across packages or sources | GPT-6.1 Sol · high  | [Children](references/children.md#research)      |
| Critique      | The recommended direction before the plan is final   | Opus 5.5 · high     | [Children](references/children.md#critique)      |
| Cleanup audit | Each area of the diff during Clean                   | GPT-6.1 Sol · high  | [Children](references/children.md#cleanup-audit) |
| Code review   | Each review round, or a concrete risk                | GPT-6.1 Sol · high  | [Children](references/children.md#code-review)   |
| Browser proof | Each ticket journey during Prove                     | GPT-6.1 Sol · high  | [Captures](references/captures.md)               |
| Body reader   | Each published pull request body                     | GPT-6.1 Sol · high  | [Children](references/children.md#body-reader)   |

Use the primary's model when a listed model is unavailable. A brief holds the plan table, the task's own decisions, the procedure's path, sources and what to return; it never restates this skill. Message a running child only with a fact that changes its next action. Reconcile every missing or failed criterion when a child returns.

## Decisions

`CODING_STANDARDS.md` holds repository contracts, a folder's `AGENTS.md` holds its decisions, and environment holds machine facts. Read the owner before you work in its area, and update it when a decision changes. Record only rationale the code cannot show: rejected options, non-goals and failed attempts.
