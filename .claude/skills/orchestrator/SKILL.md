---
name: orchestrator
description: Load for code work: plan, decide, delegate small units, integrate and prove.
---

# Orchestrator

This skill is for code. Schedules, workflows, general research and non-code tasks use T3's own tools, not this loop.

The main thread owns ambiguous design, user interaction, diff review, integration and proof. Cheap workers own small, well-defined units.

## Thread and plan

- **One code thread.** One thread per code task; never suggest a new one for context. After compaction, read the task list and thread before asking.
- **Plan card.** A data model, screen, architecture change or multi-PR task starts with one plan card, approved before the build. Output owns the page; the card shows the choices and the units.
- **Steers re-plan.** A message that changes an entity, screen, unit or acceptance criterion is planned again; rewrite the unmerged layer rather than stacking a fix.

## Split by strength

- The main thread keeps ambiguous work, architecture, user interaction, diff review, integration and proof.
- A worker gets a bounded file set, one objective and one proof command. One worker handles a batch of small units and stays alive for follow-ups; a new batch gets a new worker only when it needs a different proof.
- Workers never talk to the user and never spawn. If one needs a peer, it returns; the main thread starts it.
- Workers: `opencode-zen` / `deepseek-v4.1-flash`, no other model. A quota failure is not retried on the same provider; take the unit over.
- Write the brief: objective, owned files, fixed decisions, exclusions, done command, report format. Never "based on your findings".
- Worker rules: edit only owned files; run only the checks the brief names; commit; reply `PASS`, `ISSUES` or `BLOCKED` in at most 15 lines with command, exit code and SHA.
- Use the desktop only when it is reachable; a failed target never blocks the task.

## Integrate and prove

- Read each worker's diff against the card, not its summary. A missing proof is a gap, not a pass.
- Merge in stack order, run the repository's Verify once, then prove the integrated head with `verification`.
- Before handback every worker is settled; no worker outlives the answer. A late completion that changes nothing gets no reply.
- Remove scratch files, servers, worktrees and finished workers; keep the shared preview.

## Decide

- The user owns taste, product, access, money and irreversible actions. If the repository, thread or an installed dependency answers a middle decision, don't ask. Otherwise gather the deciding source or run a time-boxed probe in `/tmp/<task>/`.
- If it is still close, give a fresh-context worker the question, the evidence and the criteria without your verdict; adopt its answer unless it shows a flaw you can check. No rounds, votes or scores.

## Research

- Read the installed dependency's source; versions differ. Do not rely on memory or a web summary when the source is available.
