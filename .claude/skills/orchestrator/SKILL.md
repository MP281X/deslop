---
name: orchestrator
description: 'Load before delegating or integrating delegated work. Not for schedules or T3 workflows.'
---

# Orchestrator

## Route

A main-thread call re-reads the whole thread, often 300k tokens; a delegate starts near 15k but costs the main thread a brief and a report. The user picks the main thread's model and effort. The routing below applies only to delegates.

| Work                                              | Model       | `target`                            |
| ------------------------------------------------- | ----------- | ----------------------------------- |
| Default: edits, browser walks, research, captures | GPT-6.1 Sol | `codex` / `gpt-6.1-sol`             |
| UI code, quick reads                              | Sonnet 5.5  | `claudeAgent` / `claude-sonnet-5-5` |
| A build whose UI or architecture is still open    | Opus 5.5    | `claudeAgent` / `claude-opus-5-5`   |
| Only when the user picks it                       | Fable 5.2   | `claudeAgent` / `claude-fable-5-2`  |

- **Delegate effort.** Medium (`effort` on Claude, `reasoningEffort` on Codex); high when the task needs it; never low, xhigh or above.
- **Not used.** Luna stopped early with partial work in most failed runs; Haiku is out too.
- **Trial.** GPT-6.1 Terra for bounded reads, searches, runs and checks; compare its reports with Sol's before it becomes a default.
- **Removals.** Codex rejects `rm -f` and `rm -rf`, so a removal goes to Sonnet.
- **Step up.** A delegate that returns without its deliverable reruns once on another model, then on Opus 5.5.
- **Machines.** Main threads and delegates run on dev. Validation (the repository's checks and tests, without fixers, since fixes happen on dev) runs on desktop, about three times faster, whenever `ssh -o ConnectTimeout=3 mp281x@desktop true` succeeds; otherwise in place in the thread's worktree on dev. The main thread commits, then runs one background command, no delegate:

  ```bash
  ssh mp281x@desktop 'cd ~/<repo> && w=/tmp/validate/<repo>-<dev worktree name> && git fetch -q ssh://mp281x@dev<dev worktree path> <sha> && { git -C $w checkout -q --detach <sha> 2>/dev/null || git worktree add -q --detach $w <sha>; } && cd $w && vp install && <checks> && <tests>'
  ```

  Each thread owns one validation worktree, reused every iteration so dependencies and the `vp` cache stay warm (Deslop: 29 s cold, 7 s warm), and never shared, so threads need no locks. Nothing is pushed and no branch is created; maintenance removes a settled thread's validation worktree.

- **Long jobs.** Long or overnight delegates use GPT-6.1 Sol, since Codex's prompt cache does not expire the way Claude's does.

## Batch

- **What to delegate.** One outcome that finishes independently per delegate; coupled edits stay in one thread, since split halves come back for the main thread to reconcile. A procedure is a skill, not a child agent.
- **One owner per file.** A delegate owns its files and no sibling touches them, so siblings merge without conflicts.
- **Parallel.** Delegates that can run together start with `mode: 'async'` in one turn, then the main thread ends its turn; their completions wake it. `mode: 'wait'` calls run one after another, so wait only on a single delegate whose result the next step needs.
- **Worktrees.** A writing delegate works in its own worktree (`isolation: 'worktree'`) and commits there; the main thread merges. Read-only delegates share the checkout.
- **Surveys** run once; save the result to a file outside the checkout and cite its path in later briefs.
- **Reruns** carry only what was missing.

## Brief

About 1,500 characters, since the delegate already has the instructions, the skills and the repository at the parent's commit. It lacks the thread and uncommitted edits, so give it only: the objective, the settled decisions, the files it owns, what to leave alone, the command that proves it done and the report you want.

**Reports** are short and open with `PASS`, `ISSUES` or `BLOCKED`, then evidence (command, exit code, SHA, `path:line`), not narration.

## Integrate

Read each delegate's diff against the decisions rather than its summary; a missing proof is a gap, not a pass. Merge in stack order.
