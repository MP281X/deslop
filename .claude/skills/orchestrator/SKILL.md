---
name: orchestrator
description: Orchestrates implementation, councils and delegated work. Use for changes, pull request notices, brainstorms and open questions with many approaches; review owns audits, delivery owns publishing and captures, explore owns read-only lookup.
---

# Orchestrator

Keep sequencing, delegation and completion gates here. Load the skill that owns each procedure instead of repeating it.

For a read-only brainstorm, use direct research, disposable inline code, Markdown or a small prototype as the question requires. Use design to choose the representation; do not impose HTML on a list or table. Keep prototypes outside the repository, without a new worktree. Use Council only for a consequential unresolved tradeoff. Answer settled and evidence-backed questions yourself.

## Approach

- **MVP.** Build the minimum that meets the request and preserves reachable existing contracts. Apply YAGNI to every file, branch, library, feature, control, setting, check and rule. Remove superseded owned code and empty directories; preserve the shared preview environment keeps.
- **Choices.** Keep one way to do each thing and use the library feature that fits. Handle reachable cases, not impossible inputs. Settle tuning values yourself; the user never operates a tuning tool.
- **Steers.** Read a new message before the next consequential action. An explicit replacement changes the current direction immediately: stop incompatible work, cancel stale children and invalidate only the affected proof. An additive instruction extends the current scope without restarting independent work. Explore a tentative idea cheaply; do not silently turn it into a requirement or block settled work on it. Ask only when its status changes a user-visible outcome or persisted contract. Never rearrange the user's T3 message queue as a planning mechanism.

## Decide together

- **Trigger.** Plan with the user when the outcome, journey, consequential architecture or taste remains open. A clear bug fix, approved pattern or fully specified change needs no planning ceremony.
- **Grill.** Research facts first, then challenge one consequential assumption at a time with a concrete example and its consequence. Cover the task, what remains unchanged, the failure the user must understand and the tradeoff that changes the result. Ask the smallest user-only question in the final thread body; never ask a generic questionnaire or make the user choose routine technical details.
- **Prototype.** Show the smallest working example that decides the fork: real data, a T3 HTML sketch or a disposable `vp node -e '<script>'` or `vp env exec bun -e '<script>'` experiment. Start with one representative state or operation. Do not build a custom application, worktree, controls or polished variants before they answer a real question. Limit the first explanatory sketch to a few minutes; simplify its representation when it takes longer.
- **Gate.** For an open direction, get the user's provisional approval of the outcome and representative prototype before product implementation. Approval authorizes the next trial, not an immutable specification. Showing a prototype is not approval. Carry approved choices forward until the user replaces them; do not request approval again for routine technical work.
- **Build autonomously.** Own architecture, code style, tests, cleanup and polish within the current direction. Use architecture for mechanisms, engineering for code, testing for useful proof and design for visible behavior. Expect the user to revise that direction after trying the real feature; return only the affected choice to planning.

## Try and revise

- **Real trial.** For a consequential behavior or taste choice, build the smallest complete journey in the real host after provisional approval. Share its tested preview before expensive expansion and polish. A mock does not establish that the real experience matches the user's expectation. Complete specified fixes and approved-pattern work with focused proof, without a user-trial checkpoint.
- **While trying.** Continue independent proof, cleanup and settled implementation while the user explores. Pause only work that depends on an unanswered outcome or taste question. Do not schedule a default, demand a complete specification or report a trial as final delivery.
- **Revision cost.** Keep one implementation and local decisions easy to replace. Prefer existing modules and owners; do not add speculative abstractions, feature flags, variant stores or extra worktrees to support hypothetical revisions.
- **New direction.** Treat a change of mind as expected feedback, not failed planning or permission to restart everything. Stop incompatible work, preserve valid code and evidence, and replace only the affected behavior. Remove the rejected version once its replacement is proved. Respect data, access and published-contract permission boundaries throughout.

## Prepare

- **Intent.** Keep the user's outcome, relevant quoted requirements, settled choices, access, smallest scope and observable completion claims in your notes. Child briefs carry the relevant facts, not a second plan file.
- **Tasks.** For multi-step work, keep the harness's native task list current when that tool is available.
- **Explore.** Use explore to settle touched code, consumers, capabilities and named references. Read inline only a known file or fact, the code you will edit and its direct consumers. Delegate every other research question per [Delegate](#delegate) before you read it yourself: inventories across features or packages, dependency behavior across several files, comparisons of approaches or packages, thread history, web and vendor research, and the consumer inventory of a pattern change. Split by independent question and start all children in one batch. Read only the deciding sources a child cites; never repeat its exploration.
- **Plan.** Keep the current outcome, settled decisions and genuine open questions in the native task list or current plan, not another document. At a milestone, retain the reviewed commit and scope, proof with its inputs and dependencies, unresolved findings, owned resources, pending task IDs and next action. Replace stale entries instead of appending a diary. After compaction or a notice, resume from this state; reopen history only for a missing fact or contradiction. Show only a visual that makes the pending choice clearer. Follow Decide together; a visual plan does not need interaction when an automatic animation or static comparison states the message.
- **Structure.** Load delivery to settle PR boundaries before the first commit. A later change returns an affected ready PR to draft before editing.

## Build

- **Implement.** Reuse the existing feature shape and choose the smallest mechanism with architecture. Load engineering for code, design for visible output and testing for proof. Use environment for commands and a shared built preview when available, delivery for captures. Keep the tested preview visible and running for the user.
- **Normalize.** Run Oxfmt and deterministic lint autofix on owned code before manual analysis, independent review and check-only lint. Use the repository's fix command when it runs both. These static corrections need no model loop; judge and repair the remaining structural errors and behavior.
- **Review.** Use review for consequential code or instruction changes. Combine architecture, code, instruction and cleanup review in one focused task when they share context. Give the reviewer the goal, artifact, prior covered commit and scope, and unresolved findings, not the author's verdict. Split only independent technical questions; never delegate routine formatting or artifact checks. Reuse completed coverage until changed code, consumers or contracts invalidate it; a notification alone starts no review round.
- **Prove.** Record each settled journey, not just the final screen. Testing owns evidence validity; delivery owns captures and their presentation. Use focused checks during iteration.

## Finish

- **Cover.** Account for review of consequential code and instructions. Reuse coverage that still applies; review only uncovered changes and their consumers. Apply review's Later rounds rule to confirmed fixes: new contracts, mechanisms or failure paths need uncovered review, not a restart of covered work.
- **Simplify.** Include cleanup of the whole diff in the focused review, not another task. Remove mechanisms without a reaching caller or required contract. Retain requested outcomes, necessary dependencies, reachable existing contracts, security, accessibility and useful regression protection. Fix the root cause across its real variants; do not add another workaround.
- **Gate.** Continue only when the claims hold, findings are resolved, root fix, check and test commands pass, and the evidence matches the final code. Never run concurrent commands that write the same build outputs.
- **Agent configuration.** Before delivery of a base-config or personal-skill change, apply environment's agent-configuration procedure on every running worker and verify the installed copies.

## Deliver

Run delivery only after Finish. It owns rebasing, publishing, exact-head readiness, review guides and handoff. A later change returns to Build; retain proof and reviews that remain valid. Put process and PR detail in their T3 surfaces, not the thread reply.

## Delegate

The primary owns writes, commands, builds, browser sessions, intent and decisions. Children are read-only and run in parallel where independent. The primary infers what the user means; a child executes a precise brief, so a cheap model does most child work.

| Work                                                        | Procedure           | Model              |
| ----------------------------------------------------------- | ------------------- | ------------------ |
| Lookup, inventory, dependency, history and web research     | explore             | GPT-6 Luna, medium |
| Code review, cleanup audit, critique and instruction review | review              | GPT-6.1 Sol, high  |
| Council                                                     | [Council](#council) | GPT-6.1 Sol, high  |

- **Brief.** Write a research brief that needs no inference: one question and the decision it serves, the worker, exact checkouts, paths, repositories with versions or search terms, the definition of each counted member, the stop condition and the return format. Ask for evidence and measurements with paths and lines, the files read, surprises and unresolved questions, not a recommendation; the primary judges. Include the relevant user requirements verbatim and settled decisions. Do not copy the whole conversation, transcript or tool catalog. A review or audit brief carries no author's plan as authority.
- **Boundary.** A child writes only scratch files under `/tmp/<task>/` and source checkouts under `/tmp/repos/`. It never writes other files, touches the primary's services, messages threads, schedules tasks, asks the user or changes thread settings. Only the primary delegates, one level deep. Every brief starts with "You are a child agent: never delegate or launch threads." Return all findings in one pass, answer first, at most 40 lines unless the procedure requires one row per item, never in details or a file.
- **Models.** Keep the thread's selected model and options. Use Codex for delegated agents and agent-created evaluation threads; no Claude fallback. Choose each child's model and effort from the table, with model IDs from `orchestrator_capabilities`. Retain the selected provider, model and supported options; refresh only after a configuration change or a rejection that identifies a stale selection. Never use fast mode for children, research, reviews, councils or evaluations; set `serviceTier: default` explicitly. When a research result is wrong or incomplete, sharpen the brief first; move that question to GPT-6.1 Sol only when a precise brief still fails. Use a distinct perspective, not merely another model, when a council needs independent judgment.
- **Evaluation cleanup.** Always preserve required evidence, then automatically delete owned evaluation threads, projects and provider registrations when their use ends, including failed, cancelled and superseded runs. Stop their owned services and remove authentication links. Verify the cleanup; never delete unrelated threads or providers.
- **Rounds.** Each review round is a new delegated task with the original brief, prior findings, verdicts and unresolved objections. Never continue a review through its backing thread.
- **Reconcile.** Resolve every missing or failed criterion. Fix confirmed defects in the user's code; a review of someone else's PR reports only.
- **Wait.** When only children remain, use `t3_thread_wait` on each backing thread with `timeoutMs: 1500000`. A steer ends the wait: handle it, then resume. After terminal status, call `task_status` once to acknowledge the result. Retain the task ID and resolved findings; a repeated terminal notice does not require another status read or review. Read again only when the notice identifies later work or the retained result is incomplete.

## Council

Use a council only when the user requests multiple independent perspectives or an unresolved choice needs competing technical approaches. Do not use it for settled preferences, routine implementation, formatting or a direct factual answer. Choose only the distinct perspectives that can change the decision; no fixed-size fan-out. Use the Council model from [Delegate](#delegate), and decide from evidence rather than a vote.

Write one scratch context file with the question verbatim and measured facts. Each brief names its path and one point of view: a skeptic who removes mechanisms, cost engineer, architecture critic, evals researcher, designer or the user as his messages show him. Withhold other members' conclusions. Cluster the ideas and run the smallest experiment that decides between the strongest mechanisms. A vote does not settle a technical contract or the user's taste.

Each member returns divergent ideas from its point of view in at most 30 lines: name, mechanism, deciding evidence and the smallest experiment that proves it right or wrong. End with one idea the other views miss and one current practice to stop.
