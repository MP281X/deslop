---
name: retrospective
description: Analyze past agent threads for wasted time, wrong directions and unusable replies, then improve the agent configuration with measured evals. Use in the deslop repository when the user asks why threads were slow, what went wrong, or how to improve the agents.
---

# Retrospective

Improve the prompts, skills and environment from evidence: what the agents did, step by step, and what the user corrected. This skill lives only in the deslop repository, which versions the configuration it changes. The user starts it and then steers; it runs from collection to install without a question card. Follow workflow for everything this skill does not cover.

## 1. Collect

Analyze the threads the user names. Without names, take the top-level threads updated since the last retrospective on both workers. `desktop` runs only during the day, so collect while it is on.

- **Copy.** Copy every primary and child transcript of those threads into `/tmp/retro/<date>/` in one command per worker, per [Transcripts](#transcripts).
- **Digest.** Turn each primary transcript into a digest with short inline Python: one line per thinking block, text, tool call and result, with the local time, the step id, the context size and the call's duration. Clip long values, and split a digest over 300 KB into parts.
- **Measure.** Compute the table below yourself over the raw transcripts, for every thread at once.
- **Read.** Start one research child per digest part and one per group of about ten child transcripts, all at once. Ask each for the user's corrections verbatim with times, the five biggest time sinks, unusable replies, and the instruction line behind each. Tell it which lines are the user's, because cheaper models read agent text as corrections. Read each result as it arrives, not in launch order.
- **Host facts.** Settle how T3 renders or limits something from the installed bundle under `~/.t3/runtime/versions/<version>/` and the upstream source, never from memory.

| Measure                                                                      | Signal                               |
| ---------------------------------------------------------------------------- | ------------------------------------ |
| Steps with one tool call; text between tool calls                            | Rules the model ignores              |
| `sed -n`, `head` or `tail` slices; shell writes against Edit and Write calls | Habits a rule or setting fights      |
| Foreground minutes in polls, sleeps and failed browser walks                 | Waits that block the user            |
| Question cards and answers that ask back instead of picking an option        | Cards without the evidence they need |
| Commands that failed with "command not found" or a missing path              | Gaps the environment can close       |
| Child minutes, calls and answer lines; context tokens per step               | Slow or oversized work               |

## 2. Find causes

- **Rank.** Order findings by user corrections first, then by foreground minutes lost.
- **Root cause.** For each cause, give its evidence, the instruction line or machine gap behind it, and the smallest change. Prefer a machine fix, such as an installed tool or a setting, to a new rule.
- **Settled.** Check `.claude/AGENTS.md` before proposing: a rejected approach stays rejected.
- **Trim.** Remove one duplicate or no-op for each rule you add, so a build loads no more words.

## 3. Eval

Every instruction change gets an eval of old against new before install. Run all sessions in parallel, each in its own directory under `/tmp/retro/<date>/eval/r/<id>/` with a label file.

- **Prompt.** Start with `.claude/agents/pair.md` without front matter. Append the workflow, design and engineering bodies, each under `# Loaded skill: <name>`, and copy every skill with its references into the run. Build the old variant from `git archive` of main and the new one from the working tree.
- **Snapshots.** Take Dual snapshots from a `desktop` worktree with `ssh mp281x@desktop 'cd <worktree> && git archive <branch>'`, because `dev`'s clone is stale and GitLab needs the VPN. Extract a snapshot per run and commit it once, so the run sees a clean tree.
- **Scenarios.** Reuse the [scenario table](#scenarios) and add one scenario per new correction, built from the real thread. End each scenario with a note that T3 tools are unavailable: write T3 calls as fenced blocks named after the tool, stop at a question card, and start no services, installs or network commands.
- **Runs.** Two runs per variant and scenario, each under `timeout 1500`, started as one background batch while you keep working. Run a second round only for a variant that failed its measure. A scenario's inputs, such as a commit, a capture or a lint report, must exist in its snapshot, or the runs only report the mismatch.

```bash
cd "$copy" && claude -p "$scenario" --system-prompt "$(cat system.md)" --settings settings.json --disable-slash-commands \
  --model claude-opus-5-5 --effort high --disallowedTools AskUserQuestion --dangerously-skip-permissions \
  --output-format stream-json --verbose > run.jsonl 2> err.log < /dev/null
codex exec --cd "$copy" --skip-git-repo-check --ephemeral --dangerously-bypass-approvals-and-sandbox \
  -m gpt-6.1-sol -c model_reasoning_effort=medium --json "$procedure $question" < /dev/null > child.jsonl
```

- **Settings.** Test a setting through `--settings`, never by editing this repository's `.claude/settings.json`, which applies live. Bypass-mode attachments appear only with `--permission-mode bypassPermissions`.
- **Measure.** Count each scenario's measure from the transcripts and the diff, taken with `git add -A && git diff --cached`, because a plain diff leaves out new files. Compare wall time, steps, single-call share and context tokens.
- **Judge.** Give blinded transcripts, with shuffled labels and a key file, to a GPT-6.1 Sol judge at medium effort with the user's criteria. Keep working while it runs.

## 4. Consistency pass

Audit all of `.claude` and `.codex`, with the shared skill sources in `tools/coding-standards/skills`, across three parallel review children: the prompts and AGENTS.md, workflow and retrospective, and environment with the shared skills. Fix every finding:

- the same rule in two places, or a fact owned by two files;
- contradictions between files, and between the shared sections of `pair.md` and `.codex/instructions.md`;
- no-ops: rules no agent can act on, or that restate a harness default;
- unclear wording, hedges, and stale paths, links, tools or decision rows.

## 5. Ship

- **Install.** Install every change that held or improved its measures, per environment's [agent configuration](../environment/references/maintenance.md#agent-configuration), and drop the rest. Shared skills reach other repositories only through the published package, after the user merges.
- **Publish.** Put the change in the thread's stack layer that owns it, with the eval numbers first in the body; the user reviews by merging.
- **Record** each rejected approach and its measured reason in the `.claude/AGENTS.md` decisions table.
- **Report.** End with one reply: the time lost per cause as bars, each installed rule as a before and after, and the dropped variants under **Decided**.

## Scenarios

| Scenario                                                                       | Snapshot                  | Measure                                                      |
| ------------------------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------ |
| Plan DOS-368 with me: after a change, only Cancel closes the Add trigger popup | Dual master               | Evidence before the card; the app's own behavior read first  |
| MR 391 and MR 396 are pushed and pipelines take 15 minutes; continue delivery  | Dual Apps branch          | Every layer watched and linked; no poll; no status text      |
| Make every Dual Apps loading state use the shadcn Spinner                      | Dual Apps branch          | All states covered; no status text; Edit, not shell writes   |
| A Dual App frame that fails to load stays on "Loading app…"; fix it            | Dual Apps branch          | Data code moved to Effect Atom; no runner in React           |
| A working DOS-368 iteration is committed and I am testing it; continue         | Dual master on a branch   | Background review and cleanup started at once; no card       |
| The Dual Apps list feels static; make it a product people open every morning   | Dual Apps branch          | Directions tried and combined; choices listed under Decided  |
| I squash-merged the bottom layer and the next one conflicts; fix it            | deslop with #105 and #106 | Rebase onto main dropping the old commit; merged PR unlinked |
| A small edit plus four questions about Dual's tooling in one message           | Dual Apps branch          | Every question answered in visible text                      |
| The MR passed and I marked it ready; add the captures and hand off             | Dual master on a branch   | No `--draft` on the body update; preview kept and linked     |
| The generated morning-briefing app looks like default cards; redesign it       | Dual Apps branch          | Blind judge: distinct composition, workflows kept            |

## Transcripts

Find threads and query both workers per explore's [T3 history](../explore/SKILL.md#t3-history). Then locate a thread's native transcripts:

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
| Delegated child's final answer        | Last assistant row of its thread in `orchestration_v2_projection_messages`                              |
| User messages and card answers        | `orchestration_v2_projection_messages` rows with role `user`, and `AskUserQuestion` tool results        |

- **Session choice.** One thread can have several sessions; take every session that covers the period.
- **Compaction.** A `compacted` record marks a compaction, not a task boundary.
