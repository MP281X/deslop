---
name: retrospective
description: Use for a retrospective, and when the user asks why threads went wrong or how to improve the agents, their instructions or the lint rules.
---

# Retrospective

**Goal.** The same or better results from the user's real threads with fewer corrections, Verify runs, words, tokens and minutes. Run from collection to a ready PR without the user; the workers load it once the user merges.

## Collect

Take the threads since the last merged retrospective PR (`gh pr list --state merged --search 'retrospective in:title' --limit 1`), or the threads the user names, on every running worker; query the other worker through `ssh mp281x@<worker>`. Real threads only: every provider instance except `eval*`.

```bash
db=~/.t3/userdata/statev2.sqlite since='<merged at>'
# The user's words; T3 stores PR wakes, child results and background exits as user rows.
sqlite3 -readonly $db "SELECT m.thread_id, m.created_at, json_extract(m.payload_json, '$.text') FROM orchestration_v2_projection_messages m JOIN orchestration_v2_projection_threads t USING (thread_id) WHERE m.role = 'user' AND m.created_at >= '$since' AND t.provider_instance_id NOT LIKE 'eval%' AND m.thread_id NOT LIKE 'thread:delegated-task:%' AND json_extract(m.payload_json, '$.text') NOT LIKE 'Update on pull request%' AND json_extract(m.payload_json, '$.text') NOT LIKE 'Delegated task%' AND json_extract(m.payload_json, '$.text') NOT LIKE 'Background %' AND json_extract(m.payload_json, '$.text') NOT LIKE '/compact%' ORDER BY m.created_at"
# Cost per thread, children included: turns, wall minutes, tokens.
sqlite3 -readonly $db "SELECT p.thread_id, count(*), round(sum(julianday(p.completed_at) - julianday(p.started_at)) * 1440, 1), sum(json_extract(p.payload_json, '$.turnTokenUsage.inputTokens')), sum(json_extract(p.payload_json, '$.turnTokenUsage.cachedInputTokens')), sum(json_extract(p.payload_json, '$.turnTokenUsage.outputTokens')) FROM orchestration_v2_projection_provider_turns p JOIN orchestration_v2_projection_threads t USING (thread_id) WHERE p.started_at >= '$since' AND t.provider_instance_id NOT LIKE 'eval%' GROUP BY 1 ORDER BY 4 DESC"
# Failed commands with their input and output.
sqlite3 -readonly $db "SELECT json_extract(payload_json, '$.input'), substr(json_extract(payload_json, '$.output'), 1, 300) FROM orchestration_v2_projection_turn_items WHERE thread_id = '<thread id>' AND type = 'command_execution' AND status = 'failed'"
```

- **Delegate the mining** per orchestrator's Delegate, one child per measure below, all in one batch. Each brief defines every counted member, such as a correction or a Verify run, and the child returns counts as lower bounds with `path:line` witnesses.
- **Native transcripts** (`$.nativeThreadRef.nativeId` of `orchestration_v2_projection_provider_threads` under `~/.claude/projects` or `~/.codex/sessions`) hold what `turn_items` cut: skill loads, full Verify output, the instruction text the agent had then (`git log -p` at that time).

Measures, each with its counted member:

- **Corrections**, the ranking: a user message that rejects, repeats or restates a request, or sets a rule ("always", "never", "I want"), verbatim with thread and time.
- **Cost**: minutes, turns, uncached input and output tokens per thread and child; the same kind of task across threads.
- **Verify loops**, for lint pairing: runs until the first pass; a rule that persists across runs; a cascade, a rule that first appears after a fix to another; the wrong fix, before and after.
- **Failed commands**: not found, a missing path, a denied command retried in another form.
- **Noise**: status replies, questions a probe could answer, files written to be read back, children that wrote, expensive models on lookups.

## Diagnose

**Cause**, one per correction class, from the agent's turn before it, and its fix:

- **Not loaded:** the skill's description names the observable trigger.
- **Ignored:** a better place or form (an example, a required slot), never more words.
- **Missing:** one rule in its owner.
- **Conflict:** delete the losing rule, never an exception on top.
- **Default:** a leading term or one example that counters the model's habit.
- **Harness:** a setting, deny rule, installed tool or T3 feature.

**Owner**, one per fix:

- **Lint rule:** a code form; its message names one fix that satisfies every other rule, proved by a probe.
- **`build` Write these shapes first:** only a rule whose wrong fix restructures code or trips another rule; the rest stays lint-only.
- **`build` References:** a shape agents got wrong whose good version lives in an Effect 4 repository; a directory at its default branch, never a commit.
- **Team skill:** practice every teammate's repository shares; no person, machine, path or T3 tool name.
- **Repository `AGENTS.md`:** its decisions, commands and canonical examples.
- **`pair.md`, `.codex/instructions.md` and `.opencode/agents/build.md`:** replies, T3 tools, harness; identical from `# Work` down.- **`orchestrator`, `environment`:** the user's process, machines and references.

## Change

- **Replace, don't append.** A fix rewrites or deletes the rule it supersedes; the touched files shrink, unless a new user choice adds a row.
- **Leading word.** Each rule is `**Term.** value`: a word the model already knows, then only what it cannot carry: exact names, commands, numbers, the user's words; stated as the behavior to do. The writing reference is mattpocock/skills `skills/productivity/writing-for-agents/`.
- **Evidence.** Fewer bytes prove nothing: show the correction class or the Verify loop before and after on the same task.
- **No-op.** A rule that traces to no correction, failure or user choice goes.
- **Threshold.** A pattern in two threads or a rule the user stated; a single slip under a clear rule needs nothing.
- **History.** Read `git log -p` of the touched files and the bodies of merged retrospective PRs first: a reverted or rejected change stays rejected unless new evidence beats its reason.
- **T3.** Settle what T3 shows, notifies and offers from the installed bundle under `~/.t3/runtime/versions/<version>/`, never from memory; adopt a T3 feature that replaces a rule or a manual step.

## Ship

- **Worktree.** In `~/deslop`, call `t3_worktree_handoff` first, with a `continuationPrompt` naming this skill.
- **PR** per orchestrator and delivery: a table of correction classes with count, the user's words, cause and owner, then one `###` per changed rule with its before and after.
- **Nothing to change** ends with one line and no PR.
- **This skill.** A correction the user makes in a retrospective's own thread changes this skill in the same PR.
