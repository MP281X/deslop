---
name: retrospective
description: Use for a retrospective, and when the user asks why threads went wrong or how to improve the agents.
---

# Retrospective

Improve the agent configuration from the user's real threads: the same or better results with fewer words, tokens, tool calls and minutes. Run from collection to a ready PR without the user; the workers load it once the user merges.

## Collect

Take the threads since the last merged retrospective PR (`gh pr list --state merged --search 'retrospective in:title' --limit 1`), or the threads the user names, on every running worker; query the other worker through `ssh mp281x@<worker>`. Real threads only: provider instances `codex` and `claudeAgent`, never `eval*`.

```bash
db=~/.t3/userdata/statev2.sqlite since='<merged at>'
# The user's words; T3 stores PR wakes, child results and background exits as user rows.
sqlite3 -readonly $db "SELECT m.thread_id, m.created_at, json_extract(m.payload_json, '$.text') FROM orchestration_v2_projection_messages m JOIN orchestration_v2_projection_threads t USING (thread_id) WHERE m.role = 'user' AND m.created_at >= '$since' AND t.provider_instance_id IN ('codex', 'claudeAgent') AND m.thread_id NOT LIKE 'thread:delegated-task:%' AND json_extract(m.payload_json, '$.text') NOT LIKE 'Update on pull request%' AND json_extract(m.payload_json, '$.text') NOT LIKE 'Delegated task %' AND json_extract(m.payload_json, '$.text') NOT LIKE 'Background command completed%' ORDER BY m.created_at"
# Cost per thread, children included: turns, wall minutes, tokens.
sqlite3 -readonly $db "SELECT p.thread_id, count(*), round(sum(julianday(p.completed_at) - julianday(p.started_at)) * 1440, 1), sum(json_extract(p.payload_json, '$.turnTokenUsage.inputTokens')), sum(json_extract(p.payload_json, '$.turnTokenUsage.cachedInputTokens')), sum(json_extract(p.payload_json, '$.turnTokenUsage.outputTokens')) FROM orchestration_v2_projection_provider_turns p JOIN orchestration_v2_projection_threads t USING (thread_id) WHERE p.started_at >= '$since' AND t.provider_instance_id IN ('codex', 'claudeAgent') GROUP BY 1 ORDER BY 4 DESC"
# Tool calls per thread by type and status; failed commands with their input and output.
sqlite3 -readonly $db "SELECT thread_id, type, status, count(*) FROM orchestration_v2_projection_turn_items WHERE thread_id = '<thread id>' GROUP BY 2, 3"
sqlite3 -readonly $db "SELECT json_extract(payload_json, '$.input'), substr(json_extract(payload_json, '$.output'), 1, 300) FROM orchestration_v2_projection_turn_items WHERE thread_id = '<thread id>' AND type = 'command_execution' AND status = 'failed'"
```

- **Corrections.** Keep each user message that corrects, rejects, repeats or restates a request after an agent reply, or sets a rule ("always", "never", "I want"), verbatim with its thread and time.
- **Cause.** For each correction, read the agent's turn before it in `turn_items`; open the native transcript (`orchestration_v2_projection_provider_threads.payload_json` `$.nativeThreadRef.nativeId` under `~/.claude/projects` or `~/.codex/sessions`) only when the item text does not show the cause.
- **Measure** with the queries above, never from memory:

| Measure                                                                                        | Signal                             |
| ---------------------------------------------------------------------------------------------- | ---------------------------------- |
| Per thread and child: minutes, turns, uncached input and output tokens                         | Where the cost goes                |
| The same kind of task compared across threads, such as a one-file fix or a PR body             | A habit that makes a thread costly |
| Failed commands: "command not found", a missing path, a denied command retried in another form | A gap the machine can close        |
| Files written only to be read back, scripts and reports the agent wrote for itself             | Wasted tokens                      |
| Questions to the user that the code, a probe or a council could answer                         | Missing autonomy                   |
| Pipeline failures a local gate would have caught                                               | A skipped gate                     |
| Replies that report status, process or superseded facts                                        | Noise the user reads               |
| Children that edited a repository, and expensive models on lookups                             | Wrong delegation                   |

## Change

- **Rank** causes by the user's corrections first, then by minutes and tokens lost. A change that saves cost keeps the result: show both before and after on the same task.
- **Cause.** Apply review's Instruction review to each cause.
- **Machine first.** Prefer a lint rule, a setting, a deny rule or an installed tool to a sentence, then delete the rule it replaces.
- **Threshold.** Change for a pattern in two threads or a rule the user stated; a single slip with a clear rule needs nothing.
- **Trim.** For each sentence added, remove a duplicate or a sentence that changes no action; each fact keeps one owner.
- **History.** Read `git log -p` of the touched instruction files and the bodies of merged retrospective PRs before you change a rule: a reverted or rejected change stays rejected unless new evidence beats its reason.
- **T3.** Settle what T3 shows, notifies and offers from the installed bundle under `~/.t3/runtime/versions/<version>/`, never from memory, and adopt a new T3 feature that replaces a rule or a manual step.

## Ship

- **Worktree.** In `~/deslop`, call `t3_worktree_handoff` first, with a `continuationPrompt` naming this skill.
- **PR** per orchestrator and delivery: one `###` per changed rule with the before and after, under a table of its threads, the user's words and the cause.
- **Nothing to change** ends with one line and no PR.
- **This skill.** A correction the user makes in a retrospective's own thread changes this skill in the same PR.
