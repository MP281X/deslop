---
name: workflow
description: Load at task start, when the user changes direction, before a plan card, a design or architecture choice, research into unfamiliar APIs, and before splitting or delegating work.
---

# Workflow

## Orchestrate

The main thread is the orchestrator: it owns the plan, the decisions, the integrated diff and the proof. Wide reads, inventories, logs, searches and web facts go to a worker, which returns a cited report.

- **Delegate by default.** Every unit that can be specified goes to a worker, even a small one; write it yourself only when a brief would cost more than the change.
- **One persistent worker per unit.** Start it with a brief; send follow-ups to the same thread; a new unit gets a new worker. Start independent units together and integrate when a result is needed.
- **One level.** A worker never starts a subagent. If it needs one, it returns with the evidence and the orchestrator starts a peer. Root threads may start workers; workers do not.
- **Workers.** Only `opencode-zen` / `deepseek-v4.1-flash`. A read-only audit shares this checkout; a writing unit gets `isolation:'worktree'`.
- **Where.** Run on the current worker by default. Check `t3_environment_links`; send a heavy writing unit to `desktop` only when it is reachable. If it is down or the delegate fails for the target, retry the same brief on this worker; never block on a sleeping desktop.
- **Quota.** `orchestrator_capabilities` lists providers and models but no remaining quota; a quota failure appears only when a run fails. Retry the same brief once on the next allowed provider, then take the unit over. Never retry an exhausted provider.
- **Brief.** Objective, plan card path, owned files, fixed decisions, exclusions, done command, report format. Write the spec yourself; never "based on your findings".
- **Worker rules**, in every writing brief: edit only owned files; run scoped checks (`vp lint <paths>`, `vp test <files>`), never `vp run verify`, `vp run fix` or another repo-wide fix; commit on the branch; clone only under `/tmp/repos/`; reply `PASS`, `ISSUES` or `BLOCKED` in at most 15 lines with command, exit code, capture path and commit SHA.
- **Context budget.** Keep decisions, reviewed diffs and proof in the main thread; keep reports and logs out of it.

## Plan card

A data model, a screen, an architecture change, or work spanning more than one PR starts with a plan card: one `html_render` page in this thread that the user approves before the real build.

- **Architecture.** A diagram of the parts and how data moves between them, before and after side by side, the changed parts in `--accent`.
- **Data.** Entities and their relations with one worked example.
- **Screens.** Mocks drawn in the page itself, phone and desktop, with the app's theme tokens and font so they look like the app: 2–3 variants side by side when the direction is open, each with a stable id like `nav-A`, and its states from empty to error to long. Mocks never go into the app's source or its preview.
- **Choices.** The recommended option marked; rejected ones with the reason.
- **Units.** The PRs or stack layers, and what each proves.
- **Done.** The journeys the proof will show.

Map causes before showing options. Approval freezes the card; an unanswered card is unapproved, never called approved or chosen. Record durable app decisions in the app's `AGENTS.md`.

**Steers re-plan.** A message that changes an entity, a screen, a unit or an acceptance criterion is planned like the first request: redraw the card around it, carry every settled decision over without asking it again, and rewrite the unmerged layers it reshapes rather than stacking a fix on top. A steered screen shows its mock before any edit. Workers on parts the steer doesn't touch keep going.

## Decide

A middle decision has a better answer that more evidence reveals. Gather the deciding source, probe or a time-boxed spike in `/tmp/<task>/`. If it is still close, give one fresh-context worker the question, the evidence and the criteria without your verdict, and adopt its answer unless it shows a flaw you can check. No rounds, votes or scores.

## Integrate

Read each worker's diff once against the card, not its summary, for what Verify cannot check: the card, ownership and behavior; a missing proof is a gap, not a pass. Send a gap back once with the failing evidence, then take the unit over. Merge units in stack order, run full Verify once, then prove the integrated head with the verification skill.

## Research

API questions resolve in the installed dependency's source: versions differ, especially Effect 3 and 4. When the repository has no canonical example, [references/repos.md](references/repos.md) lists the outside repositories to read, by shape.
