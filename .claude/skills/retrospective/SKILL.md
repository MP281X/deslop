---
name: retrospective
description: Analyze past agent threads for wasted time, wrong directions and replies the user could not use, then improve the agent configuration with measured evals. Use in the deslop repository when the user asks why threads were slow, what went wrong, or how to improve the agents.
---

# Retrospective

Improve the prompts and skills from evidence: what the agents did, step by step, and what the user corrected. This skill lives only in the deslop repository, which versions the configuration it changes. Follow workflow for everything this skill does not cover.

## 1. Collect

Analyze the threads the user names. Without names, take the top-level threads updated in the last 7 days on both workers. Durations and final replies are not enough: read every tool call and every available thinking trace of the primary and of each child. Record a missing trace as unavailable.

- **Tool calls.** For each call, record its tool, input, result, error and wall time. Group calls by model step: one Claude step can span several assistant records with the same `message.id`.
- **Thinking.** Read the reasoning between calls. Mark re-planning, deliberation over a settled choice, rereading of instructions, and long thinking before a trivial call.
- **Children.** Read each child's own transcript the same way, with its brief, effort and final answer length. Measure how long the primary blocked on it.
- **User.** Quote every correction, rejected question card and reversed decision verbatim, with its position.
- **Split the reading.** Start one research child per thread or per child transcript, in parallel, with a 40-line answer. Compute counts and times yourself with short inline Python over the transcripts in `/tmp/retro`.
- **Host facts.** Settle how T3 renders or limits something from the installed bundle under `~/.t3/runtime/versions/<version>/client/assets` and the upstream source, never from memory.

| Measure                                                                            | Signal                        |
| ---------------------------------------------------------------------------------- | ----------------------------- |
| Steps with one tool call, and independent reads that ran in sequence               | Calls that can share one step |
| `sed -n`, `head` or `tail` slices, and files read more than once                   | Rereads and wasted tokens     |
| Waits that ended without a result, status checks on running children, failed calls | Calls with no value           |
| Child minutes: model, tools and final answer size                                  | Slow or oversized children    |
| Context tokens per step                                                            | Cost of long threads          |

## 2. Find causes

- **Rank.** Order findings by wall time lost and by user corrections. A correction outranks a minute.
- **Classify.** Name each as a no-value call, a mergeable call, a wrong direction, or a reply the user could not use.
- **Root cause.** For each cause, give its evidence, the instruction line that permits it, and the smallest change. A cause is a rule, tool or setting, never the single incident.
- **Settled.** Check `.claude/AGENTS.md` before proposing: a rejected approach stays rejected.

## 3. Discuss

- **Show.** Render the time lost per cause as bars, and each proposed rule as a before and after.
- **Ask.** One question card that lets the user pick several fixes: one option per fix, a label of a few words and a description under twelve words that states its effect. Ask only about fixes the render shows.
- **Steering.** The user adds ideas while you work. Test each as another eval variant rather than arguing about it.

## 4. Eval

Every instruction change gets an eval of old against new before install. Give each run its own directory under `/tmp/retro/<task>/`, and run all sessions in parallel.

- **Prompt.** Start with `.claude/agents/pair.md` without front matter. Append the workflow, design and engineering bodies, each under `# Loaded skill: <name>`.
- **Scenarios.** Use real tasks from the analyzed threads: a planning message, a build with several consumers, and a guide for the user. Run each on a fresh copy of a git snapshot of the target repository's default branch.
- **Headless runs.** End each scenario with a note that T3 tools are unavailable. It asks for fenced `CARD` and `RENDER` blocks, a stop at each user decision, no services and no installs.

```bash
cd "$copy" && claude -p "$scenario" --system-prompt "$(cat system.md)" --disable-slash-commands --model claude-opus-5-5 --effort high \
  --disallowedTools AskUserQuestion --dangerously-skip-permissions --output-format stream-json --verbose > run.jsonl
codex exec --cd "$copy" --skip-git-repo-check --ephemeral --dangerously-bypass-approvals-and-sandbox \
  -m gpt-6.1-sol -c model_reasoning_effort=medium -c service_tier=priority --json "$procedure $question" > child.jsonl
```

- **Runs.** Two or three runs per variant and scenario; one run is noise. Iterate per workflow's measurable-results rule, and stop when a round stops helping.
- **Speed.** Time each command yourself. Compare wall time, steps, single-call share, slices, rereads, summed context tokens and files changed.
- **Quality.** Give the blinded transcripts to a judge child, GPT-6.1 Sol at medium effort, with the user's criteria and shuffled labels. Check that faster variants still meet every requirement of the task.
- **Settings.** This repository's `.claude/settings.json` applies live to the session that works in it. Test a setting through `claude --settings` in the eval, never by editing that file.

## 5. Consistency pass

After the changes, audit all of `.claude` and `.codex`, with the shared skill sources in `tools/coding-standards/skills`. Split the files across parallel review children, each reading its files whole, and fix every finding:

- the same rule in two places, or a fact owned by two files;
- contradictions between files or sections, and between `pair.md` and `.codex/instructions.md` in their shared sections;
- no-ops: rules no agent can act on, or that restate a default;
- unclear wording, hedges, misleading headings, and stale paths, links, tools or decision rows.

## 6. Ship

- **Approve.** Show the eval and the pass as a render, and ask in a question card which changes to install.
- **Install.** Publish the draft pull request entry with the eval numbers first, then install per environment's [agent configuration](../environment/references/maintenance.md#agent-configuration).
- **Record** each rejected approach and its reason in the `.claude/AGENTS.md` decisions table.

## Transcripts

Find threads and query both workers per workflow's [T3 history](../workflow/references/children.md#t3-history). Then locate a thread's native transcripts:

```bash
sqlite3 -readonly -header -column ~/.t3/userdata/statev2.sqlite "SELECT provider, status, json_extract(payload_json, '$.nativeThreadRef.nativeId') AS session_id, updated_at FROM orchestration_v2_projection_provider_threads WHERE thread_id = '<thread id>' ORDER BY updated_at DESC;"
find ~/.claude/projects ~/.codex/sessions -type f -name "*<session id>.jsonl"
```

| Record                                | Where                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Claude tool calls, thinking and usage | `assistant` records: `message.content` blocks `tool_use`, `thinking`, `text`, and `message.usage`       |
| Claude tool results                   | `user` records: `tool_result` blocks with `tool_use_id` and `is_error`                                  |
| Claude subagents                      | `<session>/subagents/`                                                                                  |
| Codex calls and results               | `response_item` records: `custom_tool_call` or `function_call` and their `_output`, joined by `call_id` |
| Codex reasoning and effort            | `response_item` records of type `reasoning`, and `turn_context.effort`                                  |
| Codex child's parent                  | First `session_meta` record, `payload.parent_thread_id`                                                 |
| Delegated child's final answer        | Last assistant row of its thread in `orchestration_v2_projection_messages`                              |

- **Session choice.** Pick the session that covers the run in question; the latest one can miss stopped or replaced runs.
- **Compaction.** A `compacted` record marks a compaction, not a task boundary.
