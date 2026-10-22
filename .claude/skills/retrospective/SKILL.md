---
name: retrospective
description: Use for a retrospective, and when the user asks why threads went wrong or how to improve the agents, their instructions or the lint rules.
---

# Retrospective

**Goal.** Improve the actual result, not a report about improving it: same or better outcomes with fewer corrections, Verify runs, words, tokens and minutes. Preserve discussion and read-only boundaries; implement and publish when authorized.

## Collect

Take the threads since the last merged retrospective PR (`gh pr list --state merged --search 'retrospective in:title' --limit 1`), or the threads the user names, on every running worker; query the other worker through `ssh mp281x@<worker>`. Real threads only: every provider instance except `eval*`.

```bash
db=~/.t3/userdata/statev2.sqlite since='<merged at>'
# The user's words; T3 stores PR wakes, child results and background exits as user rows.
sqlite3 -readonly $db "SELECT m.thread_id, m.created_at, json_extract(m.payload_json, '$.text') FROM orchestration_v2_projection_messages m JOIN orchestration_v2_projection_threads t USING (thread_id) WHERE m.role = 'user' AND m.created_at >= '$since' AND t.provider_instance_id NOT LIKE 'eval%' AND m.thread_id NOT LIKE 'thread:delegated-task:%' AND json_extract(m.payload_json, '$.text') NOT LIKE 'Update on pull request%' AND json_extract(m.payload_json, '$.text') NOT LIKE 'Delegated task%' AND json_extract(m.payload_json, '$.text') NOT LIKE 'Background %' AND json_extract(m.payload_json, '$.text') NOT LIKE '/compact%' ORDER BY m.created_at"
# Cost per thread, children included: runs, wall minutes, tool calls, input per tool call, tokens.
sqlite3 -readonly $db "WITH runs AS (SELECT p.thread_id, p.started_at, p.completed_at, json_extract(p.payload_json, '$.turnTokenUsage.inputTokens') AS input, json_extract(p.payload_json, '$.turnTokenUsage.cachedInputTokens') AS cached, json_extract(p.payload_json, '$.turnTokenUsage.outputTokens') AS output, (SELECT count(*) FROM orchestration_v2_projection_turn_items i WHERE i.provider_turn_id = p.provider_turn_id AND i.type IN ('command_execution', 'dynamic_tool', 'file_change')) AS calls FROM orchestration_v2_projection_provider_turns p) SELECT r.thread_id, count(*), round(sum(julianday(r.completed_at) - julianday(r.started_at)) * 1440, 1), round(1.0 * coalesce(sum(r.calls), 0) / count(*), 1), round(1.0 * coalesce(sum(r.input), 0) / max(1, coalesce(sum(r.calls), 0))), sum(r.input), sum(r.cached), sum(r.output) FROM runs r JOIN orchestration_v2_projection_threads t USING (thread_id) WHERE r.started_at >= '$since' AND t.provider_instance_id NOT LIKE 'eval%' GROUP BY 1 ORDER BY 6 DESC"
# Failed commands with their input and output.
sqlite3 -readonly $db "SELECT json_extract(payload_json, '$.input'), substr(json_extract(payload_json, '$.output'), 1, 300) FROM orchestration_v2_projection_turn_items WHERE thread_id = '<thread id>' AND type = 'command_execution' AND status = 'failed'"
```

- **Mining.** Select and batch delegated questions per orchestrator's Delegate. Define every counted member, such as a correction or Verify run; return counts as lower bounds with `path:line` witnesses.
- **Native transcripts** (`$.nativeThreadRef.nativeId` of `orchestration_v2_projection_provider_threads` under `~/.claude/projects` or `~/.codex/sessions`) hold what `turn_items` cut: skill loads, full Verify output, the instruction text the agent had then (`git log -p` at that time).

Measures, each with its counted member:

- **Corrections**, the ranking: a user message that rejects, repeats or restates a request, or sets a rule ("always", "never", "I want"), verbatim with thread and time. Retain the actual proposal behind a short approval so a substituted outcome is not mistaken for the agreed one.
- **Cost**: minutes, runs, tool calls per run, input tokens per tool call, uncached input and output tokens per thread and child; the share spent in child threads and in thread-to-thread messages; the same measures against the previous retrospective PR.
- **Verify loops**, for lint pairing: runs until the first pass; a rule that persists across runs; a cascade, a rule that first appears after a fix to another; the wrong fix, before and after.
- **Failed commands**: not found, a missing path, a denied command retried in another form.
- **Noise**: repeated facts across headings, pages and prose; status replies; questions a probe could answer; manually cached short output (not harness-created logs); children that wrote in any checkout or clone; delegation or repeated local runs costing more than they save.

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
- **`lint-companion` Write these shapes first:** only a rule whose wrong fix restructures code or trips another rule; the rest stays lint-only.
- **Repository `CODING_STANDARDS.md`:** a judgement call no lint rule can check, read at review.
- **`patterns` References:** a shape agents got wrong whose good version lives in an Effect 4 repository; a directory at its default branch, never a commit.
- **Team skill:** practice every teammate's repository shares; no person, machine, path or T3 tool name.
- **Repository `AGENTS.md`:** its scope, commands and canonical examples, the pointers every agent needs.
- **`pair.md`, `.codex/instructions.md` and `.opencode/agents/build.md`:** replies, T3 tools, harness; identical from `# Work` down.
- **`orchestrator`, `environment`:** the user's process, prompting semantics, machines and references. A phrase gets a fixed meaning only when the user defines it; corroborated usage informs interpretation, not a keyword parser. Keep personal habits out of team skills.

## Change

- **Replace, don't append.** A fix rewrites or deletes the rule it supersedes; the touched files shrink, unless a new user choice adds a row.
- **Leading word.** Each rule is `**Term.** value`: a word the model already knows, then only what it cannot carry: exact names, commands, numbers, the user's words; stated as the behavior to do. The writing reference is mattpocock/skills `skills/productivity/writing-for-agents/`.
- **Evidence.** Fewer bytes prove nothing: show the correction class or the Verify loop before and after on the same task.
- **No-op.** A rule that traces to no correction, failure or user choice goes.
- **Threshold.** A corroborated failure pattern or a rule the user stated; a single slip under a clear rule needs no additional instruction.
- **History.** Read `git log -p` of the touched files and the bodies of merged retrospective PRs first: a reverted or rejected change stays rejected unless new evidence beats its reason. Never adopt hooks that gate the agent, a reviewer per rule or per model family, an agent that validates another's review, or a model switch mid-thread.
- **T3.** Settle what T3 shows, notifies and offers from the installed bundle under `~/.t3/runtime/versions/<version>/`, never from memory; adopt a T3 feature that replaces a rule or a manual step.

## Ship

- **Workspace.** Use the thread's attached checkout per orchestrator; reading history on other workers does not distribute implementation.
- **PR** per delivery: final behavior, deciding evidence and material activation risks. Keep the mining, counts and diagnosis in the thread; do not copy the retrospective into the PR.
- **Nothing to change** ends with one line and no PR.
- **This skill.** A correction the user makes in a retrospective's own thread changes this skill in the same PR.
