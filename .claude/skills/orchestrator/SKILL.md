---
name: orchestrator
description: 'Load before delegating or integrating delegated work. Not for schedules or T3 workflows.'
---

# Orchestrator

## Route

A main-thread call re-reads the whole thread, often 300k tokens; a delegate starts near 15k but costs the main thread a brief and a report. Codex quota is underused while Claude main threads dominate the bill, so aim for Codex at about a quarter of usage.

| Work                                              | Model       | `target`                            |
| ------------------------------------------------- | ----------- | ----------------------------------- |
| Main thread                                       | Opus 5.5    | `claudeAgent` / `claude-opus-5-5`   |
| Default: edits, browser walks, research, captures | GPT-6.1 Sol | `codex` / `gpt-6.1-sol`             |
| UI code, quick reads                              | Sonnet 5.5  | `claudeAgent` / `claude-sonnet-5-5` |
| A build whose UI or architecture is still open    | Opus 5.5    | `claudeAgent` / `claude-opus-5-5`   |
| Only when the user picks it                       | Fable 5.2   | `claudeAgent` / `claude-fable-5-2`  |

- **Effort.** Medium (`effort` on Claude, `reasoningEffort` on Codex); high when the task needs it, such as a hard architecture turn on the main thread; never low, xhigh or above.
- **Not used.** Luna gave up on 59% of its runs; Haiku and DeepSeek are out too.
- **Removals.** Codex rejects `rm -f` and `rm -rf`, so a removal goes to Sonnet.
- **Step up.** A delegate that returns without its deliverable reruns once on another model, then on Opus 5.5.

## Batch

- **One delegate per deliverable.** It owns its files and no sibling touches them, so independent deliverables start together in one turn and merge without conflicts.
- **Worktrees.** A writing delegate works in its own worktree (`isolation: 'worktree'`) and commits there; the main thread merges. Read-only delegates share the checkout.
- **Surveys** run once; save the result to a file outside the checkout and cite its path in later briefs.
- **Reruns** carry only what was missing.

## Brief

About 1,500 characters, since the delegate already has the instructions, the skills and the repository at the parent's commit. It lacks the thread and uncommitted edits, so give it only: the objective, the settled decisions, the files it owns, what to leave alone, the command that proves it done and the report you want.

**Reports** are short and open with `PASS`, `ISSUES` or `BLOCKED`, then evidence (command, exit code, SHA, `path:line`), not narration.

## Integrate

Read each delegate's diff against the decisions rather than its summary; a missing proof is a gap, not a pass. Merge in stack order.
