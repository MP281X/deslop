---
name: orchestrator
description: Load for code work only: before planning, splitting, delegating, integrating or proving a code change.
---

# Orchestrator

This skill is for code. Schedules, workflows, general research and non-code tasks use T3's own tools, not this loop.

The main thread owns ambiguous design, user interaction, diff review, integration and proof. Cheap workers own small, well-defined units.

## Thread and plan

- **One code thread.** One thread per code task; never suggest a new one for context. After compaction, read the task list, this thread and every live worker's latest result before re-planning.
- **Plan card.** A data model, screen, architecture change or multi-PR task starts with one plan card, approved before the build. The card is one rendered page; it shows the choices and units.
- **Steers re-plan.** A message that changes an entity, screen, unit or acceptance criterion is planned again; rewrite the unmerged layer rather than stacking a fix.

## Split by strength

- The main thread keeps ambiguous work, architecture, user interaction, diff review, integration and proof.
- A worker gets a bounded file set, one objective and one proof command. One worker handles a batch of small units and stays alive for follow-ups; a new batch gets a new worker only when it needs a different proof.
- Workers never talk to the user and never spawn. If one needs a peer, it returns; the main thread starts it.
- Workers: cheap models own bounded units: DeepSeek V4.1 Flash (`opencode-zen` / `deepseek-v4.1-flash`), GPT-6 Luna high (`codex` / `gpt-6-luna`, `reasoningEffort: high`) or Haiku 5.5 high (`claudeAgent` / `claude-haiku-5-5`, `effort: high`); prefer a provider other than the main thread's. A unit that needs cross-file judgment, a final review or repeated correction runs on a stronger model (`gpt-6.1-sol`, `claude-sonnet-5-5`, `claude-opus-5-5` or `claude-fable-5-2`). A quota failure is not retried on the same provider; take the unit over.
- Write the brief: objective, owned files, fixed decisions, exclusions, done command, report format. Never "based on your findings".
- Worker rules: edit only owned files; run only the checks the brief names; commit; reply `PASS`, `ISSUES` or `BLOCKED` in at most 15 lines with command, exit code and SHA.
- Use the desktop only when it is reachable; a failed target never blocks the task.

## Integrate and prove

- Read each worker's diff against the card, not its summary. A missing proof is a gap, not a pass.
- Merge in stack order, run the repository's Verify once, then prove the integrated head.
- Before handback every worker is settled; no worker outlives the answer. A late completion that changes nothing gets no reply.
- Remove scratch files, servers, worktrees and finished workers; keep the shared preview.

## Decide

- The user owns taste, product, access, money and irreversible actions. If the repository, thread or an installed dependency answers a middle decision, don't ask. Otherwise gather the deciding source or run a time-boxed probe in `/tmp/<task>/`.
- If it is still close, give a fresh-context worker on a stronger model the question, the evidence and the criteria without your verdict; adopt its answer unless it shows a flaw you can check. No rounds, votes or scores.

## Research

- Read the installed dependency's source; versions differ. Do not rely on memory or a web summary when the source is available.
