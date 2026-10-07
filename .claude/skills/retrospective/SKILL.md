---
name: retrospective
description: Analyze past agent threads for wasted time, wrong directions and replies the user could not use, then improve the agent configuration with measured evals. Use in the deslop repository when the user asks why threads were slow, what went wrong, or how to improve the agents.
---

# Retrospective

Improve the prompts and skills from evidence: what the threads did, where the time went and what the user corrected. This skill lives only in the deslop repository, which versions the configuration it changes. Follow workflow for everything this skill does not cover.

## 1. Collect

- **Scope.** Analyze the threads the user names. Without names, take the top-level threads updated in the last 7 days on both workers.
- **Measure first.** Run [transcript.py](scripts/transcript.py) on each Claude transcript and [codex_sessions.py](scripts/codex_sessions.py) on the day's Codex sessions, all in one response. They print steps, single-call share, time per tool, no-value and mergeable calls, slices, rereads, context size and child time.
- **Read in parallel.** Start one research child per thread, GPT-6.1 Sol at medium effort, with a 40-line answer. Each returns the user's corrections and rejected question cards verbatim, decisions reversed later, and reasoning patterns that cost steps, with positions and quotes.
- **Host facts.** Settle how T3 renders or limits something from the installed bundle under `~/.t3/runtime/versions/<version>/client/assets` and the upstream source, never from memory.

## 2. Find causes

- **Rank.** Order findings by wall time lost and by user corrections. A correction outranks a minute.
- **Classify.** Name each as a no-value call, a mergeable call, a wrong direction, or a reply the user could not use.
- **Root cause.** For each, give the evidence (thread, position, numbers or a quote), the instruction line that causes or permits it, and the smallest change. A cause is a rule, tool or setting, never the single incident.
- **Settled.** Check `.claude/AGENTS.md` before proposing: a rejected approach stays rejected.

## 3. Discuss

- **Show.** Render the time lost per cause as bars, and each proposed rule as a before and after.
- **Ask.** One question card with `multiSelect`: one option per fix, a label of a few words and a description under twelve words that states its measured or expected effect. Ask only about fixes the render shows.
- **Steering.** The user adds ideas while you work. Test each as another eval variant rather than arguing about it.

## 4. Eval

Every instruction change gets an eval of old against new before install. Run all variants in parallel, in `/tmp/retro`.

- **Scenarios.** Use real tasks from the analyzed threads: a planning message, a build with several consumers and a guide for the user. Run them on a snapshot of the target repository's default branch.
- **Runs.** Two or three runs per variant and scenario; one run is noise. Two or three rounds of improve and measure, then stop when a round stops helping.
- **Speed.** Compare steps, single-call share, wall time, tokens read, slices, rereads and files changed with [speed.py](scripts/eval/speed.py).
- **Quality.** Give the blinded transcripts to a judge child, GPT-6.1 Sol at medium effort, with the user's criteria and shuffled labels. Check that faster variants still meet every requirement of the task.
- **Harness.** [build-prompt.sh](scripts/eval/build-prompt.sh) assembles a variant's system prompt; [run.sh](scripts/eval/run.sh) runs one session for Claude or Codex.

## 5. Ship

- **Approve.** Show the eval as a render and ask in a question card which changes to install.
- **Install** per environment's [agent configuration](../environment/references/maintenance.md#agent-configuration), then add the pull request entry with its numbers.
- **Record** each rejected approach and its reason in the `.claude/AGENTS.md` decisions table.

## Transcripts

`t3_thread_search` and the database cover only the worker that runs you; run the same queries on the other worker with `ssh mp281x@<worker> '<command>'`. Query `~/.t3/userdata/statev2.sqlite` with `sqlite3 -readonly`, select only the fields you need and never read credentials. To find a thread's native transcripts:

```bash
T3_DB=~/.t3/userdata/statev2.sqlite
sqlite3 -readonly -header -column "$T3_DB" "SELECT provider, status, json_extract(payload_json, '$.nativeThreadRef.nativeId') AS session_id, updated_at FROM orchestration_v2_projection_provider_threads WHERE thread_id = '<thread id>' ORDER BY updated_at DESC;"
find ~/.claude/projects ~/.codex/sessions -type f -name "*<session id>.jsonl"
```

- **Session choice.** Pick the session that covers the run in question; the latest one can miss stopped or replaced runs.
- **Children.** Claude subagents sit in `<session>/subagents/`. A Codex child's first `session_meta` record names its parent in `payload.parent_thread_id`. A delegated child's final answer is the last assistant row of its thread in `orchestration_v2_projection_messages`.
- **Records.** One Claude model step can span several assistant records with the same `message.id`. A `compacted` record marks a compaction, not a task boundary.

## Harness facts

- **Headless runs** have no T3 tools: the scenario ends with a note that asks for question cards and renders as fenced `CARD` and `RENDER` blocks.
- **Settings.** This repository's `.claude/settings.json` applies live to the session that works in it. Test a setting through `claude --settings` in the eval, never by editing that file.
- **Measured so far.** Claude makes a single tool call in about 90% of its steps whatever the prompt says, and slices files with `sed -n` unless a rule overrides the Read tool's advice. Codex as the primary was slower than Claude on two build tasks. Research children with 40-line answers ran about 4 times faster than with full reports.
