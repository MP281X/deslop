---
name: orchestrator
description: Orchestrates implementation, councils and delegated work. Use for changes, pull request notices, brainstorms and open questions with many approaches; review owns audits, delivery owns publishing and captures, explore owns read-only lookup.
---

# Orchestrator

Keep sequencing, delegation and completion gates here. Load the skill that owns each procedure instead of repeating it.

## Decide

Both repositories move fast and requirements become clear while the user tries things. Decide yourself, build at once and show the decision; the user reports where he is not aligned and steers.

- **Brainstorm.** When the outcome, journey, architecture or taste is open, research facts first, then write several structurally different directions and challenge each with a concrete example and its consequence. Test or prototype the strongest two or three, and decide from that evidence and engineering's Taste, never from the first idea. A clear fix, approved pattern or specified change needs no brainstorm. Use a [Council](#council) only for a consequential unresolved tradeoff.
- **Prototype.** When a sketch decides a fork faster than code, show the cheapest one inline, never as a file in the repository or scratch; only a child's mock uses a file, the output path its brief names. Show a screen as an HTML mock per design's Mocks, passed to `html_preview` and `html_render`; code organization as a shape in the reply, with the file tree change, exported names with signatures, state owners and one operation's data flow; behavior as an experiment per testing's Throwaway. For a genuinely open direction, start 2–3 structurally different variants in parallel per [Delegate](#delegate) and show them side by side with the chosen one marked.
- **No gate.** Never wait for approval before product code. Start production-quality code at once with the chosen direction, in parallel with any prototype. Own architecture, code style, tests, cleanup and polish within that direction.
- **Real trial.** For a consequential behavior or taste choice, build the smallest complete journey in the real host first and share its preview before expansion and polish. A mock does not establish that the real experience matches the user's expectation.
- **Steers.** Read a new message before the next consequential action. A change of mind is expected feedback, not failed planning: stop incompatible work, cancel stale children, keep valid code and proof, and replace only the affected behavior; remove the rejected version once its replacement is proved. An additive instruction extends the scope without restarting independent work. Explore a tentative idea cheaply and decide its status yourself; never turn it silently into a requirement. When the user calls a pushed state good enough, stop refining: take that head to ready per delivery and drop the remaining work. Keep one implementation; add no feature flags, variant stores or extra worktrees for hypothetical revisions. Never rearrange the user's T3 message queue as a planning mechanism.

## Prepare

- **Intent.** Keep the user's outcome, relevant quoted requirements, settled choices, access, smallest scope and observable completion claims in the native task list or current plan, not another document. Child briefs carry the relevant facts.
- **Explore.** Use explore to settle touched code, consumers, capabilities and named references. Delegate every research question beyond the code you edit and its consumers per [Delegate](#delegate) before you read it yourself: inventories across features or packages, dependency behavior across several files, comparisons of approaches or packages, thread history, web and vendor research, and the consumer inventory of a pattern change. Split by independent question and start all children in one batch. Read only the deciding sources a child cites.
- **Plan.** At a milestone, retain the reviewed commit and scope, proof with its inputs, unresolved findings, owned resources, pending task IDs and next action. Replace stale entries instead of appending a diary. After compaction or a notice, resume from this state; reopen history only for a missing fact or contradiction.
- **Structure.** Load delivery to settle PR boundaries before the first commit.

## Build

- **Implement.** Reuse the existing feature shape and choose the smallest mechanism with architecture. Load engineering before the first edit of product or test code in a session, and again after a compaction; load design for visible output and testing for proof. Use environment for commands and the preview, delivery for captures.
- **Publish early.** Make the first working slice the smallest change the user can try, and push it and each later working step per delivery. Start the review and the captures at the first push; the user reviews and the pipelines run while you refine. A push invalidates only the review and proof that depend on it.
- **Review.** Use review for consequential code or instruction changes. Review the published PRs, the unit the user reviews, not the worktree diff. Each round is one background child on one PR layer that covers architecture, code, instructions and cleanup; give it the goal, the PR number, the last reviewed commit and the unresolved findings. Keep working, fix confirmed findings when they arrive, and tell the user only a finding that changes behavior he chose. Start a round for a new contract, mechanism or failure path, or for a batch of commits, never for each copy, name, style or test change or confirmed local fix. Before the stack goes ready, one overview round reads every layer together.
- **Agent configuration.** Before delivery of a base-config or personal-skill change, apply environment's agent-configuration procedure on every running worker and verify the installed copies.

Delivery owns rebasing, publishing, exact-head readiness, review guides and handoff. A later change returns to Build and keeps the proof and reviews that remain valid.

## Delegate

The primary owns intent, decisions, the thread's checkout and branches, its preview and its browser tab. Children run in parallel where independent; they can run commands, builds, tests, measurements and maintenance that cannot collide with what the primary owns. The primary infers what the user means; a child executes a precise brief.

| Work                                                        | Procedure                             | Model                   |
| ----------------------------------------------------------- | ------------------------------------- | ----------------------- |
| Lookup, inventory, dependency, history and web research     | explore                               | GPT-6 Luna, medium      |
| Screen mock variants                                        | [Prototype](#decide) and design       | Claude Sonnet 5.5, high |
| Code organization shape variants                            | [Prototype](#decide) and architecture | GPT-6.1 Sol, medium     |
| Code review, cleanup audit, critique and instruction review | review                                | GPT-6.1 Sol, high       |
| Council                                                     | [Council](#council)                   | GPT-6.1 Sol, high       |
| Maintenance and long commands outside the primary's scope   | environment                           | GPT-6.1 Sol, medium     |

- **Brief.** Write a brief that needs no inference: one question and the decision it serves, the worker, exact checkouts, paths, repositories with versions or search terms, the definition of each counted member, the stop condition and the return format. Ask for evidence and measurements with paths and lines, the files read, surprises and unresolved questions, not a recommendation; the primary judges. Include the relevant user requirements verbatim and settled decisions, never the whole conversation, transcript or tool catalog. A review or audit brief carries no author's plan or verdict as authority. Give a research child one bounded question over a named list of sources that exist on its worker; split a whole-system inventory into one child per source group, and keep judgment across files, such as overlap between instructions, in the primary or a review child. A variant brief names one direction, the reference files, the recorded taste and the output path for its one HTML mock or shape.
- **Boundary.** Every brief starts with "You are a child agent: never delegate, never spawn subagents and never launch threads." A child never edits the primary's checkout, commits or pushes, never stops or changes the primary's preview, units or containers, and never drives its browser tab; the brief lists what the primary uses now. It writes scratch under `/tmp/<task>/`, source checkouts under `/tmp/repos/` and only the system state its brief names. It never messages threads, schedules tasks, asks the user or changes thread settings. It returns all findings in one pass, answer first, and the covered part with its coverage when it cannot finish, never an empty result, at most 40 lines unless the procedure requires one row per item.
- **Models.** Keep the thread's selected model and options. Use Codex for delegated agents and agent-created evaluation threads, except Claude for screen mock variants. Take model IDs from `orchestrator_capabilities` and retain the selection; refresh only after a configuration change or a rejection that names a stale selection. Never use fast mode for a child; set `serviceTier: default` where the model offers it. When a result is wrong or incomplete, split or sharpen the brief and run it again on the same model.
- **Rounds.** Each review round is a new delegated task with the original brief, prior findings, verdicts and unresolved objections. Never continue a review through its backing thread.
- **Reconcile.** Resolve every missing or failed criterion. Fix confirmed defects in the user's code; a review of someone else's PR reports only.
- **Wait.** When only children remain, use `t3_thread_wait` with `timeoutMs: 1500000` on the backing thread whose result unblocks the most work, then act on it before you wait on the next one. A steer ends the wait: handle it, then resume. After terminal status, call `task_status` once to acknowledge the result; a repeated terminal notice needs no other read or review.

## Council

Use a council only when the user requests multiple independent perspectives or an unresolved choice needs competing technical approaches, never for settled preferences, routine implementation or a direct factual answer. Choose only the distinct perspectives that can change the decision. Write one scratch context file with the question verbatim and measured facts. Each brief names its path and one point of view: a skeptic who removes mechanisms, cost engineer, architecture critic, evals researcher, designer or the user as his messages show him. Withhold other members' conclusions.

Each member returns divergent ideas from its point of view in at most 30 lines: name, mechanism, deciding evidence and the smallest experiment that proves it right or wrong, then one idea the other views miss and one current practice to stop. Cluster the ideas and run the smallest experiment that decides between the strongest mechanisms; a vote settles neither a technical contract nor the user's taste.
