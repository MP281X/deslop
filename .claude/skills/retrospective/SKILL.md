---
name: retrospective
description: Analyze past agent threads for wasted time, wrong directions and unusable replies, then improve the agent configuration with measured evals. Use in the deslop repository when the user asks why threads were slow, what went wrong, how to improve the agents, or for a review of the agent configuration.
---

# Retrospective

Improve the prompts, skills and environment from evidence: what the agents did, step by step, and what the user corrected. This skill lives only in the deslop repository, which versions the configuration it changes. The user starts it and then steers; it runs from collection to install without a question card. Follow workflow for everything this skill does not cover, and read the [brief](../../README.md) first: a rejected approach stays rejected.

## 1. Collect

Analyze the threads the user names. Without names, take the top-level threads updated since the last retrospective on every running worker. A configuration review starts at [Find causes](#2-find-causes) with an [instruction review](../review/SKILL.md#instruction-review).

- **Copy.** Copy every primary and child transcript of those threads into `/tmp/retro/<date>/` in one command per worker, per [Transcripts](#transcripts).
- **Digest.** Turn each primary transcript into a digest with short inline Python. Write one line per thinking block, text, tool call and result, with the local time, step id, context size and call duration. Clip long values, and split a digest over 300 KB into parts.
- **Measure.** Compute the table below yourself over the raw transcripts, for every thread at once. Count Codex calls inside a batched `exec` one by one, and count `apply_patch` as an edit.
- **Read.** Start one research child per digest part and one per group of about ten child transcripts, all at once. Ask each for the user's corrections verbatim with times, the five biggest time sinks, unusable replies, and the instruction line behind each. Tell it which lines are the user's, because cheaper models read agent text as corrections. Read each result as it arrives.
- **Host facts.** Settle how T3 renders or limits something from the installed bundle under `~/.t3/runtime/versions/<version>/` and the upstream source, never from memory.

| Measure                                                                    | Signal                               |
| -------------------------------------------------------------------------- | ------------------------------------ |
| Steps with one tool call; text between tool calls                          | Rules the model ignores              |
| Sliced reads; shell writes against Edit, Write and `apply_patch` calls     | Habits a rule or setting fights      |
| Foreground minutes in polls, sleeps and failed browser walks               | Waits that block the user            |
| Question cards (`AskUserQuestion`, `request_user_input`) and their answers | Cards without the evidence they need |
| Commands that failed with "command not found" or a missing path            | Gaps the environment can close       |
| Child minutes, calls and answer lines; context tokens per step             | Slow or oversized work               |

## 2. Find causes

- **Rank.** Order findings by user corrections first, then by foreground minutes lost.
- **Root cause.** For each cause, give its evidence, the instruction line or machine gap behind it, and the smallest change. Prefer a machine fix, such as an installed tool or a setting, to a new rule.
- **Trim.** Remove one duplicate or no-op for each rule you add, so a build loads no more words.

## 3. Eval

Every instruction change gets a replay probe of old against new before install. A probe replays one real failure and scores it with a script, so the numbers come from transcripts, not from a judge's impression.

- **Probe.** Build each probe in `/tmp/retro/<date>/probes/<name>/` from one thread: the user's message verbatim, a snapshot of the repository at that time, and a context note of at most three lines. Add no footer that conflicts with the check, such as a ban on network commands for a fetch check.
- **Check first.** Before any run, write `check.sh`. It reads one run's transcript and diff, prints pass or fail, and quotes the transcript fact that decided it. Write the check from the user's correction, never from the new rule's words, so a run cannot pass by echoing the rule.
- **Reproduce.** Run the old variant three times. When it never fails, the probe cannot reach the change: drop it.
- **Compare.** Run the new variant three times on the same model and effort. A change counts only when the old variant failed at least twice and the new one passed three times. Two runs per side cannot tell a result from noise.
- **Guards.** Record wall time, question cards and steps for every run. A guard that gets worse on work both variants do blocks the install, even when the check passes; time spent on the behavior the change adds is the change itself.
- **Taste.** Use a judge only for taste, such as a design. Write its criteria before the runs, give it transcripts without paths, run ids, skill reads or label files, and keep its verdict beside the counts.
- **Both harnesses.** A change to a shared section runs on Claude and on Codex. A change to one harness section runs only on that harness.

### Runner

Eval runs are T3 children, so they load prompts and skills as production does and use the real T3 tools. A child gets no system prompt of its own, so each variant runs on its own provider instance with its own home. A child also inherits its parent's checkout, whose project settings and skills merge into every variant. Start the runs from a scratch thread instead: launch it with `t3_thread_launch` and `scratch: true`, and give it these steps and the probes.

1. **Homes.** Build `/tmp/retro/<date>/homes/<harness>-<variant>/` from `git archive` of `origin/main` for old and of the working tree for new. A Claude home holds `settings.json` with `"agent": "eval-pair"`, `agents/eval-pair.md` (pair.md renamed), every personal and shared skill in `skills/`, and a link to `~/.claude/.credentials.json`. A Codex home holds `config.toml`, `instructions.md`, `rules/`, every skill in `skills/`, and a link to `~/.codex/auth.json`.
2. **Instances.** Back up `~/.t3/userdata/settings.json`, then add one provider instance per home to its `providerInstances` map. T3 reloads the file without a restart. Command-line flags outrank this checkout's project settings, so pin the variant with them:

   ```json
   "evalClaudeNew": {"driver": "claudeAgent", "enabled": true, "config": {"binaryPath": "claude", "homePath": "<home>", "launchArgs": "--system-prompt-snapshot off --agent eval-pair --settings <home>/settings.json"}},
   "evalCodexNew": {"driver": "codex", "enabled": true, "config": {"binaryPath": "codex", "homePath": "<home>", "launchArgs": "-c model_instructions_file=<home>/instructions.md"}}
   ```

3. **Isolation check.** Before the probes, ask one Claude child per instance whether its prompt has a section that only one variant has, and to list each skill with its file path. Codex refuses to quote its instructions, so read them in the `session_meta` record under its home's `sessions` folder. Compare each with its home.
4. **Runs.** Start every run at once with `delegate_task`: `role: "general"`, `target.providerInstanceId` of the variant, and a `clientRequestId` per run. The task names the probe's snapshot as the only directory to work in. Answer a run's question card with `t3_pending_request_respond` only when the probe says how; otherwise the card ends the run.
5. **Score.** Read each run's transcript from its child thread per [Transcripts](#transcripts), run `check.sh`, and confirm with `git status` that this checkout did not change.
6. **Clean.** Remove the eval instances from the T3 settings and delete the homes.

## 4. Consistency pass

Run the [instruction review](../review/SKILL.md#instruction-review) in three parallel children: the prompts, the brief and the settings; workflow, explore, review and retrospective; environment with the shared skill sources in `tools/coding-standards/skills`. Fix every confirmed finding.

## 5. Ship

- **Publish.** Put each change in the thread's stack layer that owns it, as a draft pull request. Place each probe's counts under the change it proves: old failures, new passes and the guards.
- **Install.** Install every change whose probe held, per environment's [agent configuration](../environment/references/maintenance.md#agent-configuration), and drop the rest. Shared skills reach other repositories only through the published package, after the user merges.
- **Record** each rejected approach with its probe counts in the brief's decisions table: the thread, the check, old and new counts, the model and any guard that moved.
- **Report.** End with one reply: the time lost per cause as bars, each installed rule as a before and after, and the dropped changes under **Decided**.

## Transcripts

Find threads and query each worker per explore's [T3 history](../explore/SKILL.md#t3-history). Then locate a thread's native transcripts:

```bash
sqlite3 -readonly ~/.t3/userdata/statev2.sqlite "SELECT p.thread_id, json_extract(p.payload_json, '$.nativeThreadRef.nativeId') FROM orchestration_v2_projection_provider_threads p JOIN orchestration_v2_projection_threads t ON t.thread_id = p.thread_id WHERE t.updated_at >= '<since>' AND t.deleted_at IS NULL;"
find ~/.claude/projects ~/.codex/sessions -type f -name "*<session id>*.jsonl"
```

| Record                                | Where                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Claude tool calls, thinking and usage | `assistant` records: `message.content` blocks `tool_use`, `thinking`, `text`, and `message.usage`       |
| Claude tool results                   | `user` records: `tool_result` blocks with `tool_use_id` and `is_error`                                  |
| Claude harness notes                  | `attachment` records, such as `auto_mode` with its Bash steer                                           |
| Codex calls and results               | `response_item` records: `custom_tool_call` or `function_call` and their `_output`, joined by `call_id` |
| Codex reasoning and effort            | `response_item` records of type `reasoning`, and `turn_context.effort`                                  |
| Delegated child's result              | `task_status` of the task: its terminal `summary`, not the child thread's latest message                |
| User messages and card answers        | `orchestration_v2_projection_messages` rows with role `user`, and the card tools' results               |

- **Session choice.** One thread can have several sessions; take every session that covers the period.
- **Compaction.** A `compacted` record marks a compaction, not a task boundary.
- **Eval homes.** A run on an eval instance writes its transcript under that home's `projects` or `sessions` folder.
