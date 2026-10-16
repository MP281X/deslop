---
name: retrospective
description: Use for the daily retrospective, and when the user asks why threads went wrong or how to improve the agents.
---

# Retrospective

Improve the agent configuration from the user's real threads: the same or better results with fewer words, tokens, tool calls and minutes. Run from collection to install without the user. This skill stays in the deslop repository and is never installed on the workers.

## Collect

Take the last 24 hours, or the threads the user names, on every running worker; query the other worker through `ssh mp281x@<worker>`.

```bash
sqlite3 -readonly ~/.t3/userdata/statev2.sqlite "SELECT m.thread_id, m.created_at, json_extract(m.payload_json, '$.text') FROM orchestration_v2_projection_messages m WHERE m.role = 'user' AND julianday(m.created_at) >= julianday('now', '-1 day') AND m.thread_id NOT LIKE 'thread:delegated-task:%' AND json_extract(m.payload_json, '$.text') NOT LIKE 'Update on pull request%' AND json_extract(m.payload_json, '$.text') NOT LIKE 'Delegated task %' ORDER BY m.created_at"
sqlite3 -readonly ~/.t3/userdata/statev2.sqlite "SELECT thread_id, json_extract(payload_json, '$.nativeThreadRef.nativeId') FROM orchestration_v2_projection_provider_threads WHERE thread_id = '<thread id>'"
find ~/.claude/projects ~/.codex/sessions -type f -name '*<native id>*.jsonl'
```

- **Corrections.** Keep each user message that corrects, rejects, repeats or restates a request after an agent reply, or sets a rule ("always", "never", "I want"), verbatim with its thread and time.
- **Transcripts.** Read the agent's turn before each correction in its native transcript, with the thread's children. Delegate one research child per group of about ten threads per orchestrator; its brief says which lines are the user's, because a cheaper model reads agent text as corrections.
- **Measure** from the raw transcripts, not from memory:

| Measure                                                                                                                                                                                                                         | Signal                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Per thread and per child: wall minutes from the first to the last timestamp, tool calls, input, cached and output tokens (Claude `message.usage`, Codex `token_count` events' `total_token_usage`) and their cost at list price | Where the cost goes, task by task  |
| The same kind of task compared across threads, such as a one-file fix or a PR body                                                                                                                                              | A habit that makes a thread costly |
| Shell writes against Edit, Write and `apply_patch`; sliced or repeated reads                                                                                                                                                    | A habit a rule or setting fights   |
| Foreground minutes in polls, sleeps and failed browser actions                                                                                                                                                                  | Waits that block the user          |
| Questions to the user that the code or a probe could answer                                                                                                                                                                     | Missing autonomy                   |
| Commands failing with "command not found" or a missing path                                                                                                                                                                     | A gap the machine can close        |
| Pipeline failures a local gate would have caught                                                                                                                                                                                | A skipped gate                     |
| Replies that report status, process or superseded facts                                                                                                                                                                         | Noise the user reads               |
| Child minutes and lines; children that edited a repository                                                                                                                                                                      | Oversized or wrong delegation      |

## Change

- **Rank** causes by the user's corrections first, then by minutes and cost lost. A change that saves cost keeps the result: show both before and after on the same task.
- **Cause.** Apply review's Instruction review to each cause.
- **Machine first.** Prefer a lint rule, a setting, a deny rule or an installed tool to a sentence, then delete the rule it replaces.
- **Threshold.** Change for a pattern in two threads or a rule the user stated; a single slip with a clear rule needs nothing.
- **Trim.** For each sentence added, remove a duplicate or a sentence that changes no action; each fact keeps one owner.
- **History.** Read `git log -p` of the touched instruction files and the bodies of merged retrospective PRs before you change a rule: a reverted or rejected change stays rejected unless new evidence beats its reason.
- **T3.** Settle what T3 shows, notifies and offers from the installed bundle under `~/.t3/runtime/versions/<version>/`, never from memory, and adopt a new T3 feature that replaces a rule or a manual step.

## Ship

- **Worktree.** A run that starts in `~/deslop` moves into its own worktree with `t3_worktree_handoff` before any edit.
- **PR** per orchestrator and delivery: one `###` per changed rule with the before and after, under a table of its threads, the user's words and the cause.
- **Install** per environment's agent configuration.
- **Nothing to change** ends with one line and no PR.
- **This skill.** A correction the user makes in a retrospective's own thread changes this skill in the same PR.
