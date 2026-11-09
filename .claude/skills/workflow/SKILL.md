---
name: workflow
description: Load at task start, when the user changes direction, before a plan card, a design or architecture choice, research into unfamiliar APIs, and before splitting or delegating work.
---

# Workflow

## Plan card

A data model, a screen, an architecture change, or work spanning more than one PR starts with a plan card: one `html_render` page in this thread that the user approves before the real build.

- **Architecture.** A diagram of the parts and how data moves between them, before and after side by side, the changed parts in `--accent`.
- **Data.** Entities and their relations with one worked example.
- **Screens.** Mocks drawn in the page itself, phone and desktop, with the app's theme tokens and font so they look like the app: 2–3 variants side by side when the direction is open, each with a stable id like `nav-A`, and its states from empty to error to long. Mocks never go into the app's source or its preview.
- **Choices.** The recommended option marked; rejected ones with the reason.
- **Units.** The PRs or stack layers, and what each proves.
- **Done.** The journeys the proof will show.

Map causes before showing options. Approval freezes the card; an unanswered card is unapproved, never called approved or chosen. Record durable app decisions in the app's `AGENTS.md`.

**Steers re-plan.** A message that changes an entity, a screen or a unit is planned like the first request: redraw the card around it, carry every settled decision over without asking it again, and rewrite the unmerged layers it reshapes rather than stacking a fix on top. A screen change shows its mock before any edit. Workers on parts the steer doesn't touch keep going.

## Decide

A middle decision has a better answer that more evidence reveals; taste and product stay with the user. Gather the deciding source, probe or a time-boxed spike in `/tmp/<task>/`. If it is still close, give one model from another family the question, the evidence and the criteria without your verdict, and adopt its answer unless it shows a flaw you can check. No rounds, votes or scores.

## Split and delegate

- **Units.** Each owns files and a proof command. Units touching the same file are one; dependent units form a stack.
- **Who.** A cheap model from another provider than the main thread's for clear units: DeepSeek V4.1 Flash (`opencode-zen`), GPT-6 Luna (`codex`) or Haiku 5.5 (`claudeAgent`), for building to an approved card, sweeps, codemods, tests, inventories, exploration and research. GPT-6.1 Sol (`codex`) or Opus 5.5 (`claudeAgent`) for units that need judgment and as the other family for review. The main thread writes a unit itself only when briefing it costs more than doing it, and never reads logs, the web or a wide code search itself: a cheap worker reads them and returns a cited report.
- **Where.** `isolation:'worktree'` for a unit that writes; `target.environmentId` of `dev` to run it on the other worker. Read-only units share the checkout.
- **Brief.** Objective, card or its path, owned files, fixed decisions, exclusions, done command, report format. Write the spec yourself; never "based on your findings".
- **Worker rules**, copied into every writing brief: edit only the owned files; run checks scoped to them (`vp lint <paths>`, `vp test <files>`), never `vp run verify`, `vp run fix` or another repo-wide fix; commit on the branch; clone only under `/tmp/repos/`; reply `PASS`, `ISSUES` or `BLOCKED` in at most 15 lines with evidence: command and exit code, capture paths, commit SHA.
- **Persistent.** A follow-up for the same unit goes to its thread with `t3_thread_send`; the worker keeps its context and its completion wakes you. A new unit gets a new delegate.
- **Overlap.** Work independently until a result is needed.

## Integrate

Read each worker's diff once against the card, not its summary, for what Verify cannot judge: the card, ownership and behavior; a missing proof is a gap, not a pass. Send a gap back once with the failing evidence, then take the unit over. Merge units in stack order, run full Verify once, then prove the integrated head with the verification skill.

## Research

API questions resolve in the installed dependency's source: versions differ, especially Effect 3 and 4. When the repository has no canonical example, [references/repos.md](references/repos.md) lists the outside repositories to read, by shape.
