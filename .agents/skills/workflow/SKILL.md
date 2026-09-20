---
name: workflow
description: 'Use when changing the reusable agent workflow: the pair-thread text, the roles, the Codex and Claude Code configurations, the ask-gate hook, or the installer. Holds what was measured and what the user wants, so nothing is re-derived.'
---

## Objective

The user converses with one agent, the pair thread, that turns half-formed ideas into decisions and artifacts he reacts to, then hands approved slices to cheaper agents that finish them without him. The same behavior runs on Codex and Claude Code through t3 code. Both harnesses are stripped to what the workflow uses; nothing a base prompt already says is restated, and nothing contradicts it.

## How he works on the workflow

- **Show, never describe.** He judges outputs, not prompts: run the text on a clean clone and paste the verbatim result. A proposal without a run is not ready.
- **Measure structure across runs, never length.** Two to three runs per prompt; count state line, decision asked through the tool, no implicit facts, no diff after an edit, edits only on change prompts, delegation happened. Characters are not a metric; consistency across threads is.
- **Questions only when the data cannot decide**, through the native question tool, artifact in the message, each option with its cost. A question answerable from usage data is a defect ("is web search used?" was answered by 261 calls in 68 threads).
- **Pros and cons for every choice**, one line each. No recap, no restating his message, no "no action" or "checks pass".
- **Small over clever.** Copied files beat a renderer; duplicated prose beats a script that derives one harness from the other. He said so after seeing a 100-line renderer.
- **Words before hooks.** A judgement call gets strong leading words ("Delegate reading."). A hook only where words failed measurably (the ask gate: text 1 of 8, hook 14 of 14).
- **Delegate the analysis** to Sonnet or Haiku subagents; keep only conclusions in the expensive context.
- **He parallelizes and reads on a phone**: tables of at most three columns, `<details>` only for evidence, never the decision.
- **Codex quota is finite**; iterate on Claude, confirm on Codex with one or two runs.

## Files

`tools/workflow/assets/codex/` and `tools/workflow/assets/claude/` are copied as they are into `~/.codex` and `~/.claude`; `assets/skills/engineering` is copied into both. The pair text and each role body exist twice, once per harness, edited in both places. No rendering.

| Path                          | Holds                                                                      |
| ----------------------------- | -------------------------------------------------------------------------- |
| `codex/config.toml`           | stripped config, pair text as `developer_instructions`, role registrations |
| `codex/AGENTS.md`             | the one line that authorizes Codex to spawn the roles                      |
| `codex/agents/*.toml`         | role bodies with their Codex model                                         |
| `claude/CLAUDE.md`            | pair text                                                                  |
| `claude/settings.json`        | stripped settings, ask-gate hook, denied tools and built-in agents         |
| `claude/agents/*.md`          | role bodies with their Claude model and tools                              |
| `claude/scripts/ask-gate.mjs` | PreToolUse hook on the question tool                                       |

`vp run build` in `tools/workflow`, then `node dist/main.js`; `CODEX_HOME` and `CLAUDE_CONFIG_DIR` select the homes. Nothing installs on its own; he says when.

## Ownership

| Owner       | Owns                                                              | Never                           |
| ----------- | ----------------------------------------------------------------- | ------------------------------- |
| pair thread | conversation, decisions, throwaway prototypes in the worktree     | validation, git, searching      |
| explorer    | reading beyond two files, installed source, clones                | writing, recommending           |
| worker      | the slice, its checks, invoking review and browser                | git, scope beyond the brief     |
| review      | defects in a diff against brief and skill                         | editing                         |
| browser     | rendered criteria, defects with evidence                          | anything else                   |
| git         | commit, push, draft request on the current branch                 | branches, merges, URLs, remotes |
| t3 code     | worktrees, branches, diff review with inline comments, PR linking |                                 |

## Harness facts

Measured 2026-09-19 and 2026-09-20 on Codex 0.154, Claude Code 2.1.278, t3 code of 2026-09-18.

**Codex.** `codex debug prompt-input` shows every developer item; `codex debug models` shows each model's base prompt and injected messages. Default root boot 14.1K tokens; with `personality = "none"`, the `include_*` switches off, `features.{apps,plugins,recommended_plugins,browser_use,computer_use,image_generation,goals}` off and `skills.bundled` off, 10.3K; web search is 2.5K of that and stays on. `multi_agent_mode` forbids spawning unless the user, `AGENTS.md`, or a skill asks: developer instructions alone got 0 spawns in 2 runs, the one-line `AGENTS.md` got 5 in 2. Forks inherit the parent model; a role file may set `model`, `model_reasoning_effort`, `developer_instructions`, `personality`, `service_tier`, disable a few features and skills, nothing else. A same-name role overrides a built-in (`explorer`, `worker`, `default`). Roots on Astra and Luna get `send_user_message_async` (ask without ending the turn); in `codex exec` it returns no answer. Per-step latency is 3 to 5 s on every model and effort; low effort saves no time. Hooks exist with the same events as Claude Code.

**Claude Code.** Clean boot 36.4K tokens, 72K chars of tool schemas; `disableBundledSkills`, `disableWorkflows`, `disableClaudeAiConnectors`, `autoMemoryEnabled: false`, `includeGitInstructions: false` and a bare-name `permissions.deny` list bring it to 10.0K. `AskUserQuestion` exists only when a host provides the permission callback; `claude -p` never has it, so probes go through the Agent SDK with `canUseTool`. The question panel renders the question as plain text with numbered buttons: code never goes in a question. A `PreToolUse` hook sees the transcript including the current message's text. Subagents: `model`, `effort`, `tools` (omit `Agent` to forbid nesting), `omitClaudeMd: true` keeps the pair text out, `skills:` preloads a skill; a same-name agent overrides a built-in, `permissions.deny: ["Agent(Explore)"]` removes one. Claude narrates "Looking at…" lines and, without the gate, puts the artifact inside the question in 6 of 14 runs. Cache reads cost 2.5% of input against 10% on Codex.

**t3 code.** Injects, every turn: Codex a `<collaboration_mode>` block (default mode: "strongly prefer assumptions", "never write a multiple choice question as text"; plan mode: a 3-phase plan prompt he rejects) plus `<runtime_info>` and PR-linking rules; Claude the `claude_code` preset plus the same append, settings from user, project and local scopes, `permissionMode` from the runtime mode. Renders GFM tables, task lists, GitHub alerts, `<details>`, shiki fences including `diff`, file links `[name](/abs/path:line)`. No mermaid, no remote images. Review comments on the diff arrive as `[Review comment …]` context in the next message.

## Probing

- One scratch home per variant: `CODEX_HOME=/tmp/x/codex` with `auth.json` symlinked from `~/.codex`, `CLAUDE_CONFIG_DIR` or, for the SDK, `settingSources: ['project']` with the agents copied into the clone's `.claude/`.
- One clean clone per run under `~/.deslop/harness-probe/`, never two agents in one worktree: a shared tree contaminated a whole batch once.
- Prompts in his voice, including `---` topics, "as a side note", `idk`, a why-question, an approved slice with its acceptance command, a bare "cleanup X", an explanation request.
- Git probes need a bare origin in place of the real remote and the role's remote-name guard: one Codex run pushed to a URL inferred from the manifest and opened a real pull request.
- Codex: `codex exec --json --skip-git-repo-check --sandbox danger-full-access`; a `developer_instructions` key placed after a `[table]` in TOML silently belongs to that table.
- Claude: the SDK runner denies the question with a neutral "the user will answer later" message; any other wording leaks into the output. A probe clone's `CLAUDE.md` must be formatted or `vp run check` fails inside the probe.
- Never kill probe processes with a pattern that appears in the same command line; it kills the shell.

## Decisions

Settled from 991 Codex threads, 14 Claude threads, and 15 iterations of the pair text run two to three times each on seven prompts.

| Decision                                                                                 | Evidence                                                                                                                                           |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| No orchestrator role; the pair thread has tools and delegates research, changes, and git | The tool-less primary made 2,134 waits and 1,733 relay messages in four days; 63% of implementation tokens sat in eight long-lived agents          |
| Nothing the base prompt says is restated; contradictions are removed                     | t3 injects its own mode text every turn; the old rules fought it and the base prompt's bias to action                                              |
| Harness stripped by configuration, not by prose                                          | Codex root boot 14.1K to 10.3K tokens; Claude 36.4K to 10.0K                                                                                       |
| Memory features off everywhere, web search on                                            | 261 web calls in 68 threads, all from explorers on docs and versions; no role-level switch exists                                                  |
| One fixed template per phase, state line first                                           | 63% of his "proceed" replies followed a stop that asked nothing; 19 "I don't understand" replies followed compound questions                       |
| Decisions only through the native question tool                                          | t3 renders the question text as plain text with numbered buttons; the base prompt prefers the tool                                                 |
| Facts the workflow guarantees are never stated                                           | "checks pass", "not committed", "read-only" were the last recurring filler                                                                         |
| After an edit no diff in the message, only simplification questions                      | The client shows the diff; he asked for scope-reduction questions instead                                                                          |
| Explanations are a file tree plus at most four excerpts with one comment each            | He reads code, not prose; longer excerpt lists were cut on request                                                                                 |
| The reason for an artifact lives inside it as a short comment                            | He reads a thing once; prose next to a table was "reading the same thing twice"                                                                    |
| Claude gets a `PreToolUse` gate on the question tool                                     | Text alone: 8 of 14, then 1 of 8 with the strongest wording; gate: 14 of 14                                                                        |
| `explorer` runs Sonnet 5 at medium                                                       | 0 wrong claims in ~97 at $0.066 per call; Haiku read twenty times more, cost $0.20 per call, and got claims wrong at every effort and prompt tried |
| Delegation is words, not a hook                                                          | He prefers strong leading words over static enforcement for judgement calls                                                                        |
| Codex gets a one-line `AGENTS.md` naming the roles                                       | Codex authorizes spawning only from AGENTS.md or a skill                                                                                           |
| One file per harness, copied, no renderer                                                | He prefers duplicated prose over a script that derives one harness from the other                                                                  |
| The git role never touches branches; it pushes only to a configured remote by name       | t3 code creates the worktree and branch per thread; one Codex run pushed to a URL inferred from the manifest                                       |
| worker invokes review and browser; the pair thread never does                            | Routing results through the pair thread is the message hub that failed                                                                             |
