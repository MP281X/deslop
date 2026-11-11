---
name: orchestrator
description: 'Load when planning, delegating or integrating work on a codebase, questions about it that need workers included: which model takes each step, how units run in parallel and what a brief says. Not for schedules or T3 workflows.'
---

# Orchestrator

## Route

**Cheapest capable model.** Every delegate names its provider, model and effort; unset, it inherits the main thread's.

| Step                                                         | Model                                             | Returns                                                    |
| ------------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------- |
| Find, read, search, logs, web                                | Cheap                                             | A cited report with absolute paths, never file contents    |
| Scoped edit: owned files, fixed decisions, one proof command | Cheap; strong when it needs judgment across files | A commit and its proof                                     |
| Complex build: the design is still open in the code          | Opus 5.5 medium or high                           | A commit and its proof                                     |
| Verify, tests, builds, captures                              | Cheap                                             | Exit code, the failing lines, one line per capture it read |
| Final review, a close decision                               | Strong, another family than the builder           | Findings with `path:line`                                  |

- **Cheap:** DeepSeek V4.1 Flash (`opencode-zen` / `deepseek-v4.1-flash`), GPT-6 Luna high (`codex` / `gpt-6-luna`, `reasoningEffort: high`), Haiku 5.5 high (`claudeAgent` / `claude-haiku-5-5`, `effort: high`).
- **Strong:** GPT-6.1 Sol medium (`codex` / `gpt-6.1-sol`, `reasoningEffort: medium`), Sonnet 5.5 medium (`claudeAgent` / `claude-sonnet-5-5`, `effort: medium`), Opus 5.5 medium (`claude-opus-5-5`), Fable 5.2 high (`claude-fable-5-2`).
- **Effort.** Medium for a well-specified unit; high for a final review or a close decision.
- **Step up.** A worker that fails or returns without its deliverable is rerun on another model; a second failure goes to a strong one. A quota failure moves the unit to another provider.
- **Captures.** The main thread opens only the ones that go into the PR.

## Parallel

- **Fan out.** Split the work into units that own different files and start every ready unit in the same turn; a unit waits only for a result it needs.
- **Writers.** Each writing unit works in its own worktree and commits there; the main thread merges. Read-only units share the checkout.
- **Follow up** in the unit's own thread with `t3_thread_send`, which keeps its context; a new unit gets a new delegate.

## Brief

- **Context.** A worker loads the same instructions, skills and repository; it lacks only this thread. Brief it on what the thread knows: the objective, the settled decisions, the files it owns, what to leave alone, the command that proves it done and the report you want back. Never restate standing rules, and never "based on your findings".
- **Writers** are also told: edit only the owned files, run the checks named here, commit on the branch.
- **Reports** open with `PASS`, `ISSUES` or `BLOCKED`, then the evidence: command, exit code, SHA, `path:line`.

## Integrate

- **Plan first.** A data model, a screen, an architecture change or work across several PRs starts with a plan the user approves before the build.
- **Steers re-plan.** A message that changes an entity, a screen or a unit is planned again, carrying every settled decision forward.
- **Diffs, not summaries.** Read each worker's diff against the plan. A missing proof is a gap, not a pass.
- **Order.** Merge in stack order, then prove the integrated head.
