---
name: workflow
description: 'Use when changing the reusable agent workflow: the pair-thread text, the Codex and Claude Code configurations, the ask-gate hook, or the installer.'
---

## Objective

The user converses with one agent, the pair thread, that turns half-formed ideas into decisions and artifacts he can react to. The same text runs on Codex and Claude Code through t3 code. Both harnesses are stripped to what the workflow uses; nothing the base prompts already say is restated.

## Files

| Path                                       | Installed as                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| `tools/workflow/assets/pair.md`            | `~/.codex/config.toml` `developer_instructions`, `~/.claude/CLAUDE.md` |
| `tools/workflow/assets/codex.toml`         | rest of `~/.codex/config.toml`                                         |
| `tools/workflow/assets/claude.json`        | `~/.claude/settings.json`                                              |
| `tools/workflow/assets/ask-gate.mjs`       | `~/.claude/hooks/ask-gate.mjs`, wired as a `PreToolUse` hook           |
| `tools/workflow/assets/skills/engineering` | not installed yet; the code stance for the implementation role         |

`vp run build` in `tools/workflow`, then `node dist/main.js`; `CODEX_HOME` and `CLAUDE_CONFIG_DIR` select the homes. Install replaces the listed files and removes the previous release's `AGENTS.md`, `agents/deslop`, and `skills/engineering` from the Codex home.

## Decisions

Settled on 2026-09-19 and 2026-09-20 from 991 Codex threads, 14 Claude threads, and 13 iterations of the pair text run three times each on seven prompts.

| Decision                                                                      | Evidence                                                                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| No orchestrator role; the pair thread has tools and delegates only research   | The tool-less primary made 2,134 waits and 1,733 relay messages in four days; 63% of implementation tokens sat in eight long-lived agents |
| Nothing the base prompt says is restated; contradictions are removed          | t3 injects its own mode text every turn; the old rules fought it and the base prompt's bias to action                                     |
| Harness stripped by configuration, not by prose                               | Codex root boot 14.1K → 10.3K tokens; Claude 36.4K → 10.0K                                                                                |
| Memory features off everywhere, web search on                                 | 261 web calls in 68 threads, all from explorers on docs and versions; no role-level switch exists                                         |
| One fixed template per phase, state line first                                | 63% of the user's "proceed" replies followed a stop that asked nothing; 19 "I don't understand" replies followed compound questions       |
| Decisions only through the native question tool                               | t3 renders the question text as plain text with numbered buttons; the base prompt prefers the tool                                        |
| Facts the workflow guarantees are never stated                                | "checks pass", "not committed", "read-only" were the last recurring filler in v8                                                          |
| After an edit no diff in the message, only simplification questions           | The client shows the diff; the user asked for scope-reduction questions instead                                                           |
| Explanations are a file tree plus at most four excerpts with one comment each | The user reads code, not prose; longer excerpt lists were cut on request                                                                  |
| Claude gets a `PreToolUse` gate on the question tool                          | Without it Claude skipped the body in 6 of 14 runs; with it 14 of 14 wrote it                                                             |

## Measuring

Every change to `pair.md` is judged by rerunning the same prompts several times on a clean clone with only the harness and the text, and comparing structure across runs: state line present, decision asked through the tool, no implicit facts, no diff after an edit, edits only on change prompts. Chars are not a metric.
