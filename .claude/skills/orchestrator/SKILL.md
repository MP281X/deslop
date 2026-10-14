---
name: orchestrator
description: Orchestrates implementation, councils and delegated work. Use for changes, pull request notices, brainstorms and open questions with many approaches; review owns audits, delivery owns publishing and captures, explore owns read-only lookup.
---

# Orchestrator

Keep sequencing, delegation and completion gates here. Load the skill that owns each procedure instead of repeating it.

For a read-only brainstorm, use Council and Delegate only; do not start the implementation lifecycle. Answer a settled or evidence-backed question yourself.

## Approach

- **MVP.** Build the minimum that meets the request. Apply YAGNI to every file, branch, library, feature, control, setting, check and rule. Delete what the change leaves unused, including your own earlier code, previews and branches.
- **Choices.** Keep one way to do each thing and use the library feature that fits. Handle reachable cases, not impossible inputs. Settle tuning values yourself; the user never operates a tuning tool.
- **Steers.** Run long commands in the background so new messages can change the next action. Handle each idea yourself or put it in the native task list; delegate only an unresolved technical question that benefits from independent work. Stop current work only when it conflicts. Name a differently handled steer under Decided.

## Prepare

- **Intent.** Keep the user's outcome, quoted ticket requirements, settled choices, access, smallest scope and observable completion claims in your notes. Child briefs carry the relevant facts, not a second plan file.
- **Tasks.** For multi-step work, keep the harness's native task list current when that tool is available.
- **Explore.** Use [explore](../explore/SKILL.md) to settle touched code, consumers, capabilities and named references. Read directly when the evidence is accessible; do not create a lookup child for a question one source read answers.
- **Plan.** Before product code, show an interactive plan per design: journeys, reachable states, what changes and stays, and decisions beside their consequences. Keep the request as the scope; leave unrelated improvements out. Start once the pair prompt leaves no user-only question.
- **Structure.** Load [delivery](../delivery/SKILL.md) to settle PR boundaries before the first commit. A later change returns an affected ready PR to draft before editing.

## Build

- **Implement.** Load engineering for code, design for visible output and testing for proof. Use environment for repository commands and previews, delivery for captures. Build in the real host with realistic data and share the working preview.
- **Review.** Use [review](../review/SKILL.md) for consequential code or instruction changes. Combine code review, instruction review and cleanup in one focused task when they share context. Split only independent technical questions; never delegate routine formatting or artifact checks.
- **Prove.** Record each settled journey, not just the final screen. Testing owns evidence validity; delivery owns captures and their presentation. Use focused checks during iteration.

## Finish

- **Cover.** Account for review of consequential code and instructions. Reuse coverage that still applies; review only uncovered changes and their consumers. A direct fix of a confirmed finding needs no new round.
- **Simplify.** Include cleanup of the whole diff in the focused review, not another task. Apply confirmed removals and simplifications unless the user's words require the part; name a retained choice under Decided.
- **Gate.** Continue only when the claims hold, findings are resolved, root fix, check and test commands pass, and the evidence matches the final code. Never run concurrent commands that write the same build outputs.
- **Agent configuration.** Before delivery of a base-config or personal-skill change, apply environment's [agent configuration](../environment/references/maintenance.md#agent-configuration) procedure on every running worker and verify the installed copies.

## Deliver

Run [delivery](../delivery/SKILL.md) only after Finish. It owns rebasing, publishing, exact-head readiness, review guides and handoff. A later change returns to Build; retain proof and reviews that remain valid.

## Delegate

The primary owns writes, commands, builds and browser sessions. Children are read-only and run in parallel where independent.

| Work                                                        | Procedure                      |
| ----------------------------------------------------------- | ------------------------------ |
| Lookup                                                      | [explore](../explore/SKILL.md) |
| Council                                                     | [Council](#council)            |
| Code review, cleanup audit, critique and instruction review | [review](../review/SKILL.md)   |

- **Brief.** Include the user's words verbatim, settled decisions, sources, checkout, one procedure and return format. A review or audit brief carries no author's plan as authority.
- **Boundary.** A child never writes files, touches the primary's services, messages threads, schedules tasks, asks the user or changes thread settings. Only the primary delegates, one level deep. Every brief starts with "You are a child agent: never delegate or launch threads." Return all findings in one pass, answer first, at most 40 lines unless the procedure requires one row per item, never in details or a file.
- **Models.** The primary runs on Claude Opus 5.5 or GPT-6.1 Sol at high effort. Every agent uses high effort. Get model IDs from `orchestrator_capabilities`: GPT-6 Luna for lookups, GPT-6.1 Sol for reviews, audits and critiques. If Codex is unavailable, use Claude Haiku 5.5 for lookups and Claude Sonnet 5.5 for reviews.
- **Rounds.** Each review round is a new delegated task with the original brief, prior findings, verdicts and unresolved objections. Never continue a review through its backing thread.
- **Reconcile.** Resolve every missing or failed criterion. Fix confirmed defects in the user's code; a review of someone else's PR reports only.
- **Wait.** When only children remain, use `t3_thread_wait` on each backing thread with `timeoutMs: 1500000`. A steer ends the wait: handle it, then resume. After terminal status, call `task_status` once to acknowledge the result.

## Council

Use a council only when the user requests multiple independent perspectives or an unresolved choice needs competing technical approaches. Do not use it for settled preferences, routine implementation, formatting or a direct factual answer. Choose only the distinct perspectives that can change the decision; no fixed-size fan-out. Use Claude Haiku 5.5 and GPT-6 Luna at high effort, and decide from evidence rather than a vote.

Write one scratch context file with the question verbatim and measured facts. Each brief names its path and one point of view: a skeptic who deletes half, cost engineer, evals researcher, tools builder, designer or the user as his messages show him. Cluster the ideas and test the strongest against the evidence.

Each member returns divergent ideas from its point of view in at most 30 lines: name, mechanism, deciding evidence and the smallest experiment that proves it right or wrong. End with one idea the other views miss and one current practice to stop.
