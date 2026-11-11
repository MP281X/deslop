---
name: orchestrator
description: 'Load before planning, delegating or integrating work on a codebase, a question about it that needs delegates included. Not for schedules or T3 workflows.'
---

# Orchestrator

## Route

**Balance three subscriptions:** Claude ×20, Codex ×10, OpenCode Go. Claude models write and decide best and the user trusts them most: keep them for the main thread, architecture, UI/UX and decisions. Bulk work goes to Codex; DeepSeek takes what either cannot. Every delegate names its provider, model and effort.

| Step | Model | Returns |
| --- | --- | --- |
| Find, read, search, logs, web | Luna | Cited findings with absolute paths; excerpts, never whole files |
| Scoped edit: owned files, fixed decisions, one proof command | Luna; Sol when it spans packages; Sonnet 5.5 for UI | A commit and its proof |
| Build where the architecture or the UI/UX is still open | Opus 5.5 | A commit and its proof |
| Verify, tests, builds | Luna | Exit code and the failing lines |
| Browser, device and computer use, captures | Sol | One line per capture it read |
| Review, a second opinion on a close decision | Sol; Opus 5.5 when the builder or the main thread is GPT | Findings with `path:line` |
| Removals, work another model refuses | DeepSeek | What it removed or did, with the command |

| Model | `target` | Effort | Character |
| --- | --- | --- | --- |
| Fable 5.2 | `claudeAgent` / `claude-fable-5-2` | `effort: high` | Smartest and costliest: the main thread when the user picks it |
| Opus 5.5 | `claudeAgent` / `claude-opus-5-5` | `effort: high` | Best all-round: the best code and the best decisions |
| Sonnet 5.5 | `claudeAgent` / `claude-sonnet-5-5` | `effort: medium`; `high` when the brief leaves decisions open | Claude's taste on a settled design |
| Haiku 5.5 | `claudeAgent` / `claude-haiku-5-5` | `effort: high` | Luna's steps when Codex runs short |
| GPT-6.1 Sol | `codex` / `gpt-6.1-sol` | `reasoningEffort: xhigh` | Complete and deep by brute force |
| GPT-6 Luna | `codex` / `gpt-6-luna` | `reasoningEffort: xhigh` | The default for bulk work |
| DeepSeek V4.1 Flash | `opencode-zen` / `deepseek-v4.1-flash` | none to set | Between smart and cheap: the fallback, and less restricted on security work |

- **Cost.** Every main-thread call re-reads the whole thread, about 300k tokens, and what it reads stays for every later call. A delegate starts from about 15k tokens and costs the main thread two calls, one to brief it and one to read its report. So batch: one delegate per piece of work with all its questions, never one per file.
- **Removals.** Codex rejects `rm -f` and `rm -rf`.
- **Step up.** A delegate that fails or returns without its deliverable is rerun on another model; a second failure goes to Opus 5.5. The user's standing choice: a subscription that runs short hands its steps to DeepSeek.
- **Captures.** The main thread opens only the ones that go into the PR.

## Parallel

- **Fan out.** Split the work so each delegate owns different files, and start every ready one in the same turn. A delegate waits only for a result it needs.
- **Worktrees.** A delegate that writes works in its own worktree (`isolation: 'worktree'`) and commits there; the main thread merges. Read-only delegates share the checkout.
- **Follow-up.** Unfinished work continues in its delegate's thread with `t3_thread_send`; a review or a re-check is a new delegate.

## Brief

- **Context.** A delegate has the instructions, the skills and the repository at the parent's commit; it lacks this thread and uncommitted edits. Brief it on what only the thread knows: the objective, the settled decisions, the files it owns, what to leave alone, the command that proves it done and the report you want back. Never restate standing rules, and never "based on your findings".
- **Reports** open with `PASS`, `ISSUES` or `BLOCKED`, then the evidence: command, exit code, SHA, `path:line`.

## Integrate

- **Focus.** Plans, discussion and review weigh architecture, UI/UX and functionality, the only things the user weighs; lint owns the lines.
- **Plan first.** A data model, a screen, an architecture change or work across several PRs starts with a plan the user approves before the build.
- **Steers re-plan.** A message that changes an entity, a screen or a delegate's work is planned again, carrying every settled decision forward.
- **Diffs, not summaries.** Read each delegate's diff against the plan. A missing proof is a gap, not a pass.
- **Order.** Merge in stack order, then run Verify on the integrated head.
