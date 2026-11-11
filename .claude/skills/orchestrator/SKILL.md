---
name: orchestrator
description: 'Load before planning, delegating or integrating work on a codebase, a question about it that needs delegates included. Not for schedules or T3 workflows.'
---

# Orchestrator

## Route

**Cheapest capable model.** Every delegate names its provider, model and effort.

| Step                                                         | Model                                             | Returns                                                         |
| ------------------------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------- |
| Find, read, search, logs, web                                | Cheap                                             | Cited findings with absolute paths; excerpts, never whole files |
| Scoped edit: owned files, fixed decisions, one proof command | Cheap; strong when it needs judgment across files | A commit and its proof                                          |
| Complex build: the design is still open in the code          | Opus 5.5                                          | A commit and its proof                                          |
| Verify, tests, builds, captures                              | Cheap                                             | Exit code, the failing lines, one line per capture it read      |
| Final review, a close decision                               | Strong, another family than the builder           | Findings with `path:line`                                       |

| Tier   | Model               | `target`                               | Effort                                                        | Median run, November 2026 |
| ------ | ------------------- | -------------------------------------- | ------------------------------------------------------------- | ------------------------- |
| Cheap  | DeepSeek V4.1 Flash | `opencode-zen` / `deepseek-v4.1-flash` | none to set                                                   | $0.20, 18 min             |
| Cheap  | GPT-6 Luna          | `codex` / `gpt-6-luna`                 | `reasoningEffort: xhigh`                                      | $0.01, 1 min              |
| Cheap  | Haiku 5.5           | `claudeAgent` / `claude-haiku-5-5`     | `effort: high`                                                | $0.05, 2 min              |
| Strong | GPT-6.1 Sol         | `codex` / `gpt-6.1-sol`                | `reasoningEffort: xhigh`                                      | $0.40, 5 min              |
| Strong | Sonnet 5.5          | `claudeAgent` / `claude-sonnet-5-5`    | `effort: medium`; `high` when the brief leaves decisions open | $0.90, 3 min              |
| Strong | Opus 5.5            | `claudeAgent` / `claude-opus-5-5`      | `effort: medium`; `high` for an open design or a final review | $1.80, 5 min              |
| Strong | Fable 5.2           | `claudeAgent` / `claude-fable-5-2`     | `effort: high`                                                | $4, 7 min                 |

- **Cost.** Every main-thread call re-reads the whole thread, about 300k tokens: $0.09 on Opus, $0.13 on Fable, and what it reads stays for every later call. A delegate starts from 11–19k tokens and costs its median run plus two main-thread calls, one to brief it and one to read its report. So batch: one delegate per piece of work with all its questions, never one per file; a strong delegate only where its judgment is the deliverable.
- **Removals.** Codex rejects `rm -f` and `rm -rf`: a delegate that removes files runs on DeepSeek or a Claude model.
- **Step up.** A delegate that fails or returns without its deliverable is rerun on another model; a second failure goes to a strong one. The user's standing choice: a quota failure moves it to the same tier on another provider.
- **Captures.** The main thread opens only the ones that go into the PR.

## Parallel

- **Fan out.** Split the work so each delegate owns different files, and start every ready one in the same turn. A delegate waits only for a result it needs.
- **Worktrees.** A delegate that writes works in its own worktree (`isolation: 'worktree'`) and commits there; the main thread merges. Read-only delegates share the checkout.
- **Follow-up.** Unfinished work continues in its delegate's thread with `t3_thread_send`; a review or a re-check is a new delegate.

## Brief

- **Context.** A delegate has the instructions, the skills and the repository at the parent's commit; it lacks this thread and uncommitted edits. Brief it on what only the thread knows: the objective, the settled decisions, the files it owns, what to leave alone, the command that proves it done and the report you want back. Never restate standing rules, and never "based on your findings".
- **Reports** open with `PASS`, `ISSUES` or `BLOCKED`, then the evidence: command, exit code, SHA, `path:line`.

## Integrate

- **Plan first.** A data model, a screen, an architecture change or work across several PRs starts with a plan the user approves before the build.
- **Steers re-plan.** A message that changes an entity, a screen or a delegate's work is planned again, carrying every settled decision forward.
- **Diffs, not summaries.** Read each delegate's diff against the plan. A missing proof is a gap, not a pass.
- **Order.** Merge in stack order, then run Verify on the integrated head.
