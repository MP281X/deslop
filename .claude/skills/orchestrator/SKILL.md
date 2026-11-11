---
name: orchestrator
description: "Load before the first delegate of a task and before integrating workers' results. Holds which model takes which step, where it runs and what a brief carries."
---

# Orchestrator

## Route

Each step goes to the cheapest model that does it well. Every delegate names its provider, model and effort: left unset, it inherits the main thread's.

| Step                                                         | Model                                             | Returns                                                          |
| ------------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------- |
| Find, read, search, logs, web                                | Cheap                                             | A cited report with absolute paths, never file contents          |
| Scoped edit: owned files, fixed decisions, one proof command | Cheap; strong when it needs judgment across files | A commit and its proof                                           |
| Complex build: the design is still open in the code          | Opus 5.5 medium or high                           | The same                                                         |
| Verify, tests, builds, captures                              | Cheap                                             | Exit code, the failing lines, one line per capture with its path |
| Final review, a close decision                               | Strong, another family than the builder           | Findings with `path:line`                                        |

- **Cheap:** DeepSeek V4.1 Flash (`opencode-zen` / `deepseek-v4.1-flash`), GPT-6 Luna high (`codex` / `gpt-6-luna`, `reasoningEffort: high`), Haiku 5.5 high (`claudeAgent` / `claude-haiku-5-5`, `effort: high`).
- **Strong:** GPT-6.1 Sol (`codex` / `gpt-6.1-sol`), Sonnet 5.5 (`claudeAgent` / `claude-sonnet-5-5`), Opus 5.5 (`claude-opus-5-5`), Fable 5.2 (`claude-fable-5-2`).
- **Step up.** A worker that fails or returns without its deliverable is rerun on another model; a second failure goes to a strong one. A quota failure moves the unit to another provider.
- **Captures.** The worker that captures reads each one; the main thread opens only those that go into the PR.
- **Where.** Main threads and their delegates run on `dev`; a delegate sent to `desktop` lands in that machine's `main` checkout, not this thread's branch. Verify, tests, builds and captures of a pushed head run on `desktop` while `t3_environment_links` shows it reachable: `t3_thread_launch` there with that machine's `projectId` and a worktree from the branch, then `t3_thread_wait`, and settle the thread once read. Unreachable, they run here.

## Brief

A worker starts with no history, so its brief carries everything: objective, owned files, fixed decisions, exclusions, the done command, the report's format and its line limit. Never "based on your findings".

- One worker takes a batch of small units. Units that touch the same file are one unit; parallel writers each get `isolation: 'worktree'`.
- Copied into every writing brief: edit only the owned files; run only the checks named here; commit on the branch; reply `PASS`, `ISSUES` or `BLOCKED` in at most 15 lines with command, exit code and SHA.

## Integrate

- **Plan first.** A data model, a screen, an architecture change or work across several PRs starts with a plan the user approves before the build.
- **Steers re-plan.** A message that changes an entity, screen, unit or acceptance criterion is planned again; rewrite the unmerged layer rather than stacking a fix.
- **Diffs, not summaries.** Read each worker's diff against the plan. A missing proof is a gap, not a pass.
- **Order.** Merge in stack order, then prove the integrated head.
