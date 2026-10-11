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
- **Read.** Start one research child per digest part and one per group of about ten child transcripts, all at once. Ask each for the user's corrections verbatim with times, the five biggest time sinks, unusable replies, and the instruction line behind each. Mark which lines are the user's, because cheaper models read agent text as corrections.
- **Host facts.** Settle what T3 shows, folds, limits and notifies from the installed bundle under `~/.t3/runtime/versions/<version>/` and the upstream source, never from memory. Before you adopt a mechanism, check what the user sees and whether it notifies him; an in-turn wait looked right and sent no notification.

| Measure                                                                | Signal                          |
| ---------------------------------------------------------------------- | ------------------------------- |
| Steps with one tool call; text between tool calls                      | Rules the model ignores         |
| Sliced reads; shell writes against Edit, Write and `apply_patch` calls | Habits a rule or setting fights |
| Foreground minutes in polls, sleeps and failed browser walks           | Waits that block the user       |
| Questions to the user and their answers                                | Questions the code could answer |
| Commands that failed with "command not found" or a missing path        | Gaps the environment can close  |
| Child minutes, calls and answer lines; context tokens per step         | Slow or oversized work          |

## 2. Change

- **Rank.** Order causes by user corrections first, then by foreground minutes lost.
- **Root cause.** For each cause, give its evidence, the instruction line or machine gap behind it, and the smallest change. Prefer a machine fix, such as an installed tool or a setting, to a new rule.
- **Trim.** For each rule you add, remove a duplicate or a sentence that does not change an agent's action. Put each fact in one owner file.
- **Rewrite review.** After a trim or rewrite, run one [instruction review](../software-factory/references/review.md#instruction-review) child that compares each file with its previous version for lost rules, changed meaning and ambiguous sentences. Fix every confirmed finding before the eval. A compact rewrite on 10-11 lost 13 rules that agents need.
- **Consistency.** Run one instruction review child over the whole configuration, and fix every confirmed finding.

## 3. Eval

Every instruction change gets an eval before install. Use Codex for runs and judges; run Claude for a Claude-only section, and for a shared section when old and new Codex results differ by one run or less.

- **Replay probe.** For a fix, replay one real failure: the user's message verbatim, a snapshot of the repository at that time, and a context note of at most three lines, in `/tmp/retro/<date>/probes/<name>/`. Add no footer that conflicts with the check.
- **Check first.** Before any run, write `check.sh`: it reads one run's transcript and diff, prints pass or fail, and quotes the deciding fact. Write it from the user's correction, never from the new rule's words.
- **Reproduce.** Run the old variant three times. When it never fails, the probe cannot reach the change: drop it.
- **Compare.** Run the new variant three times on the same model and effort. A fix counts only when the old variant failed at least twice and the new one passed three times.
- **Trims.** A change that only deletes, merges, moves or rewords rules has no failure to reproduce. Run old and new three times each on two existing probes, or twice each on the three [example builds](#example-builds). Install only when no check, judge score or guard gets worse.
- **Guards.** Record wall time, questions to the user and steps for every run. A guard that gets worse on work both variants do blocks the install, even when the check passes; time spent on the behavior that the change adds is the change itself.
- **Fakes.** Replace outward-facing tools in a probe with fakes that log their calls, such as a fake `gh` with ten draft pull requests, so a run cannot touch real pull requests.

### Example builds

Taste and code quality need a judge, not a script. Run the same user requests on the old and the new configuration, at least two runs each:

| Probe  | Request, verbatim                                                                                                                                                                                                                                     |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| design | "I want to see my stash notes from the Mac too, not only on the iPhone. Something in the browser served by the stash server: the list with search and the tag filter, and opening a note. Show me what it would look like before you build anything." |
| code   | "add a stash export command to the cli: it writes every note as a markdown file into a folder I pick, so I can keep a copy in obsidian"                                                                                                               |
| tool   | "I need a small tool I can run with vpx that checks the links in my markdown files (READMEs, skills, docs) and tells me which ones are broken: dead urls and relative links or #anchors that point to nothing"                                        |

- **Brief.** "Act as the primary agent of this thread: the message at the end comes from the user, and your skills apply." Name the snapshot as the only directory, forbid commits, pushes, publishing and scheduled tasks, and ask for every render as an HTML file under `out/`.
- **Judge.** Write the criteria before the runs: MVP fit, code quality, file organization, and for design the page itself, each 0 to 10, plus every part the request did not need. Give the judge letters, diffs and pages without paths, run ids or the key, and keep the key in a separate file. Also record whether the root check and tests pass.

### Runner

Eval runs are T3 children, so they load prompts, skills and T3 tools as production does. Each variant runs on its own provider instance with its own home. A child inherits its parent's checkout settings and skills, so start the runs from a scratch thread: launch it with `t3_thread_launch` and `scratch: true`, and give it these steps and the probes.

1. **Homes.** Build `/tmp/retro/<date>/homes/<harness>-<variant>/` from `git archive` of the old and the new commit. A Codex home holds `config.toml`, `instructions.md`, `rules/`, every personal and shared skill in `skills/`, and a link to `~/.codex/auth.json`. A Claude home holds `settings.json` with `"agent": "eval-pair"`, `agents/eval-pair.md` (pair.md renamed), every skill in `skills/`, and a link to `~/.claude/.credentials.json`. Put the variant's shared skills in each probe snapshot too.
2. **Instances.** Back up `~/.t3/userdata/settings.json`, then add one provider instance per home to its `providerInstances` map; T3 reloads the file. Pin the variant with command-line flags, which outrank project settings:

   ```json
   "evalCodexNew": {"driver": "codex", "enabled": true, "config": {"binaryPath": "codex", "homePath": "<home>", "launchArgs": "-c model_instructions_file=<home>/instructions.md"}},
   "evalClaudeNew": {"driver": "claudeAgent", "enabled": true, "config": {"binaryPath": "claude", "homePath": "<home>", "launchArgs": "--system-prompt-snapshot off --agent eval-pair --settings <home>/settings.json"}}
   ```

3. **Isolation check.** Before the probes, check that each instance loads its own variant: read a Codex run's instructions and skill list in the `session_meta` record under its home's `sessions` folder; ask a Claude child which prompt sections it has and to list its skills with their paths.
4. **Runs.** Start every run at once with `delegate_task`: `role: "general"`, the variant's `target.providerInstanceId`, and one `clientRequestId` per run. The task names the probe's snapshot as the only directory to work in. Never answer a run's question; score the run as it ended.
5. **Score.** Read each run's transcript per [Transcripts](#transcripts), run `check.sh` or the judge, and confirm with `git status` that this checkout did not change.
6. **Clean.** Remove the eval instances from the T3 settings, and delete the homes and snapshots.

## 4. Improve this skill

Each retrospective makes the next one need fewer steers.

- **Own thread.** Before you ship, collect this retrospective's own thread as in [Collect](#1-collect): every user steer and correction, verbatim.
- **Anticipate.** For each steer that this skill could have anticipated, change the skill so the next run does it unasked: a standing pass, a step, a probe or a check. Record the change in [Decisions](references/decisions.md) with the steer that caused it, and eval and ship it with the rest.
- **Standing passes.** Every retrospective runs these passes without being asked, and adds each new recurring request to the list:
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
