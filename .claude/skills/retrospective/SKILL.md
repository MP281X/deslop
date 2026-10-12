---
name: retrospective
description: Analyze past agent threads for wasted time, wrong directions and unusable replies, then improve the agent configuration with measured evals. Use in the deslop repository when the user asks why threads were slow, what went wrong, how to improve the agents, or for a review or trim of the agent configuration.
---

# Retrospective

Improve the prompts, skills and environment from evidence: what the agents did and what the user corrected. The target is the same or better results with fewer words. Run from collection to install without waiting on the user, and follow software-factory for the rest.

Read [Decisions](references/decisions.md) first. A rejected approach stays rejected unless new evidence beats its reason. Record every adopted and rejected change there, with the evidence.

## 1. Collect

Analyze the threads the user names. Without names, take the top-level threads updated since the last retrospective on every running worker. A configuration review or trim starts at [Change](#2-change).

- **Copy.** Copy every primary and child transcript of those threads into `/tmp/retro/<date>/`, in one command per worker, per [Transcripts](#transcripts).
- **Digest.** Turn each primary transcript into a digest with short inline Python: one line per thinking block, text, tool call and result, with the local time, step id, context size and call duration. Clip long values, and split a digest over 300 KB into parts.
- **Measure.** Compute the table below yourself over the raw transcripts. Count Codex calls inside a batched `exec` one by one, and count `apply_patch` as an edit.
- **Read.** Start one research child on GPT-6.1 Sol at high effort per digest part and one per group of about ten child transcripts, all at once. Ask each for the user's corrections verbatim with times, the five biggest time sinks, unusable replies, and the instruction line behind each. Mark which lines are the user's, because cheaper models read agent text as corrections.
- **Host facts.** Settle what T3 shows, folds, limits and notifies from the installed bundle under `~/.t3/runtime/versions/<version>/` and the upstream source, never from memory. Before you adopt a mechanism, check what the user sees and whether it notifies him; an in-turn wait looked right and sent no notification.

| Measure                                                                | Signal                          |
| ---------------------------------------------------------------------- | ------------------------------- |
| Steps with one tool call; text between tool calls                      | Rules the model ignores         |
| Sliced reads; shell writes against Edit, Write and `apply_patch` calls | Habits a rule or setting fights |
| Foreground minutes in polls, sleeps and failed browser walks           | Waits that block the user       |
| Questions to the user and their answers                                | Questions the code could answer |
| Commands that failed with "command not found" or a missing path        | Gaps the environment can close  |
| Child minutes, calls and answer lines; context tokens per step         | Slow or oversized work          |
| Final replies that report pipelines, checks, commits or progress       | Noise the user reads            |
| Pull requests opened against those linked at the end; pushes per layer | Lost links and pipeline cost    |

## 2. Change

- **Rank.** Order causes by user corrections first, then by foreground minutes lost.
- **Root cause.** For each cause, give its evidence, the instruction line or machine gap behind it, and the smallest change. Prefer a machine fix, such as an installed tool or a setting, to a new rule.
- **Trim.** For each rule you add, remove a duplicate or a sentence that does not change an agent's action. Put each fact in one owner file.
- **Rewrite review.** After a trim or rewrite, run one [instruction review](../software-factory/references/review.md#instruction-review) child that compares each file with its previous version for lost rules, changed meaning and ambiguous sentences. Fix every confirmed finding before the eval. A compact rewrite on 10-11 lost 13 rules that agents need.
- **Consistency.** Run one instruction review child over the whole configuration, and fix every confirmed finding.

## 3. Eval

Every instruction change gets an eval before install, on the [eval library](evals/). Runs use cheap models at high effort: Claude Haiku 5.5 for the Claude prompt and GPT-6 Luna for the Codex prompt. A cheap model follows the text literally, so consistent runs prove the instructions; a strong model fills their gaps and hides them. Judges use GPT-6.1 Sol at high effort.

The measure is how a run worked: minutes, tokens, steps, tool-result characters, children and their models, and the spread of each across runs. The behavior check comes after them, because a well-prompted model reaches the goal; the instructions decide how fast and how cheaply.

- **Probes.** Each probe in `evals/probes/<name>/task.md` holds the user's message verbatim and a context note of at most three lines. A replay of a real failure also holds a snapshot of the repository at that time, and no footer that conflicts with the check. Its check in [score.py](evals/score.py) encodes the user's correction, never the new rule's words, and is written before any run. A probe without a check gets the blind judge with [rubric.md](evals/rubric.md); never match free text for a judgment.
- **Read-only.** Probes never write to Dual or Jira: Dual stays read-only, and GitHub and Jira run only through the fakes.
- **New probe.** For a new failure, add a probe and its check. Its fixture shows the real change: captures and data that a reviewer would accept. Outward-facing tools are fakes in `evals/fakebin/` that log their calls.
- **Compare.** Run each probe six times per variant on the same models; cheap models vary by one or two runs in six. `score.py` prints each check's rate per variant. A fix counts only when its check rises by at least three of six, no other check falls by more than one, and minutes, tokens, steps and mid-turn texts grow only by the work the change adds. When the old variant never fails, the probe cannot reach the change: drop the change.
- **Trims.** A change that only deletes, merges, moves or rewords rules has no failure to reproduce. Run old and new six times each on two existing probes, or twice each on the `design`, `code` and `tool` probes. Install only when no check, judge score or guard gets worse.
- **Guards.** A mean or a spread of minutes, tokens or steps that gets worse on work both variants do blocks the install, even when the check passes. Also record the questions to the user, and whether the root check and tests pass.

### Runner

Eval runs are T3 children, so they load prompts, skills and T3 tools as production does. A child inherits its parent's checkout settings and skills, so the runs start from a scratch thread.

1. **Prepare.** Commit the new variant, then run `evals/prepare.sh <old ref> <new ref> <probe>[:<runs>] ...`; `HARNESS=Claude` limits it to the Claude prompt and `EVAL=<name>` keeps a second eval apart. It builds both variants' homes, one folder per run and `runs/manifest.tsv` under `/tmp/retro/<date>/eval`, and adds the `evalClaude*` and `evalCodex*` instances to T3's settings, which T3 reloads.
2. **Isolation check.** Launch a scratch thread with `t3_thread_launch` and `scratch: true`. For each Claude instance, it asks one child to call the Skill tool for software-factory and quote the "Base directory for this skill" line, which must name the instance's home; a child that searches the disk instead reports `~/.claude/skills` falsely. For each Codex instance, read the instructions and skill paths in the `session_meta` record under its home's `sessions` folder after its first run.
3. **Runs.** The scratch thread starts every manifest row at once with `delegate_task`: `role: "general"`, the row's instance, Claude Haiku 5.5 for `*Claude*` instances and GPT-6 Luna for `*Codex*` ones at high effort, the run id as `clientRequestId` and title, and the task file's text. It never answers a run's question and waits until every run is terminal.
4. **Score.** Run `python3 -I evals/score.py [eval folder]`, then give the judge folders it prints to one judge child with the rubric; keep `judge-key.txt` from the judge. Confirm with `git status` that this checkout did not change.
5. **Clean.** Remove this eval's four instances from T3's settings, stop their app servers, delete its folder, and archive the scratch thread with `t3_thread_organize` as soon as its last batch ends.

## 4. Improve this skill

Each retrospective makes the next one need fewer steers.

- **Own thread.** Before you ship, collect this retrospective's own thread as in [Collect](#1-collect): every user steer and correction, verbatim.
- **Anticipate.** For each steer that this skill could have anticipated, change the skill so the next run does it unasked: a standing pass, a step, a probe or a check. Record the change in [Decisions](references/decisions.md) with the steer that caused it, and eval and ship it with the rest.
- **Standing passes.** Every retrospective runs these passes without being asked, and adds each new recurring request to the list:
  - Add each new user correction to [corrections](evals/corrections.md) under its class; give a class without an enforcer a lint rule or a probe check.
  - Distill the user's decisions from every thread: the defaults he always takes and the questions that changed a direction. Update the pair prompt's Questions rule from them.
  - Read what the installed T3 version added since the last retrospective, such as settings and tools, and adopt each one that replaces a rule or a manual step on every worker.
  - Remove duplicates and overlaps, and move each fact to its owner file.
  - Trim every sentence that does not change an agent's action, and rewrite unclear text in compact, explicit ASD-STE100 English with established terms.
  - Show cuts and words you are unsure of in a render, and ask per the pair prompt's Questions rule; take the scheduled default and continue.
  - Prove with an eval that the trimmed configuration gives the same or better results.
  - Render the current workflow for the user when it changed.
  - Install on every running worker, and record each decision.

## 5. Ship

- **Publish.** Put each change in the thread's draft pull request that owns it, with its eval counts under the change.
- **Install.** Install every change whose eval held, per environment's [agent configuration](../environment/references/maintenance.md#agent-configuration), and drop the rest. Shared skills reach other repositories only through the published package.
- **Record** each adopted and rejected change in [Decisions](references/decisions.md): the evidence, the counts, the model and any guard that moved.
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
| User messages                         | `orchestration_v2_projection_messages` rows with role `user`                                            |

- **Sessions.** One thread can have several sessions; take every session that covers the period. A `compacted` record marks a compaction, not a task boundary.
- **Eval homes.** A run on an eval instance writes its transcript under that home's `projects` or `sessions` folder.
