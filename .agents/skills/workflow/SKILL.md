---
name: workflow
description: 'Use when changing the reusable agent workflow: the pair-thread text, the roles, the Codex and Claude Code configurations, or the installer. Holds what was measured and what the user wants, so nothing is re-derived.'
---

## Objective

The user converses with one agent, the pair thread, that turns half-formed ideas into decisions and artifacts he reacts to, then hands approved slices to cheaper agents that finish them without him. The same behavior runs on Codex and Claude Code through t3 code. Both harnesses are stripped to what the workflow uses; nothing a base prompt already says is restated, and nothing contradicts it.

## How he works on the workflow

- **Show, never describe.** He reads every message cold, works on several repositories in parallel and does not hold the codebase in his head: a proposal is the text run on a clean clone, pasted verbatim as a tree, a table or a diff, never prose about it.
- **Measure structure across runs, never length.** Count state line, decision through the question tool, no implicit facts, no diff after an edit, edits only on change prompts, delegation happened.
- **A question is asked about an artifact he can see**, never about an analysis, and one decision per question.
- **Pros and cons for every choice**, one line each.
- **Small over clever.** Copied files, no renderer, no generated harness.
- **Words, not hooks.** A judgement call gets strong leading words; static enforcement is rejected.

## Files

`tools/workflow/src/agents/codex/` and `tools/workflow/src/agents/claude/` are copied as they are into `~/.codex` and `~/.claude`; `src/agents/skills/engineering` is copied into both. The pair text and each role body exist twice, once per harness, edited in both places. No rendering.

| Path                                                    | Holds                                                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `tools/workflow/src/agents/codex/config.toml`           | stripped config, pair text as `developer_instructions`, role registrations                   |
| `tools/workflow/src/agents/codex/AGENTS.md`             | the one line that authorizes Codex to spawn the roles                                        |
| `tools/workflow/src/agents/codex/agents/*.toml`         | role bodies with their Codex model                                                           |
| `tools/workflow/src/agents/claude/CLAUDE.md`            | pair text                                                                                    |
| `tools/workflow/src/agents/claude/settings.json`        | stripped settings, denied tools and built-in agents                                          |
| `tools/workflow/src/agents/claude/agents/*.md`          | role bodies with their Claude model and tools                                                |
| `tools/workflow/src/agents/skills/engineering/SKILL.md` | the shared engineering skill, copied into both homes                                         |
| `tools/workflow/src/oxlint.ts`                          | the `.` export: the shared Oxlint rule set as `oxlint`, the repo-specific plugin as default  |
| `tools/workflow/src/rules/`                             | ten repo-specific rules, one per file, `shared.ts` helpers, every fixture in `rules.test.ts` |
| `tools/workflow/src/install.ts`                         | the `deslop-workflow` bin: copies `src/agents/` into the two homes                           |
| `tools/workflow/tsconfig.json`                          | the `./tsconfig.json` export: the shared compiler options                                    |

`vp run build` in `tools/workflow`, then `node dist/install.js`; `CODEX_HOME` and `CLAUDE_CONFIG_DIR` select the homes. Nothing installs on its own; he says when. The installer removes every managed entry before copying, so hand edits to installed files are lost on every install; an asset deleted in a release gets one explicit removal in `install.ts` for that release only, dropped at the next.

A release is any merge to `main`: CI sets `tools/workflow/package.json` to `0.1.<run number>` before the build and publishes it. `vp pack` builds `dist/install.js` for the bin and `dist/oxlint.js` for the `.` export, and `publishConfig.exports` points consumers at them while the workspace keeps reading `src/oxlint.ts`.

## Ownership

| Owner       | Owns                                                                                                                           | Never                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| pair thread | conversation, decisions, one prototype edit per file, Bash limited to `git status`, `git log`, `git diff`, `ls`, one file read | builds, lints, tests, installs, packs, probes, a second edit to a file, spawning `review` or `browser` |
| explorer    | reading, returning counts and quoted lines                                                                                     | writing, recommending, running a measurement                                                           |
| worker      | the slice, validation, measurement, evals, probes, `review`, `browser`, the structure pass                                     | git, scope beyond the brief                                                                            |
| review      | defects in a diff against brief and skill                                                                                      | editing                                                                                                |
| browser     | rendered criteria, defects with evidence                                                                                       | anything else                                                                                          |
| git         | commit, push, draft request on the current branch                                                                              | branches, merges, URLs, remotes                                                                        |
| t3 code     | worktrees, branches, diff review with inline comments, PR linking                                                              |                                                                                                        |

## Harness facts

What reaches whom, measured 2026-09-21:

| File                                   | Claude Code 2.1.278                                                                         | Codex 0.155.1                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `~/.claude/CLAUDE.md` (pair text)      | main thread yes, as type User; subagent no with `omitClaudeMd: true`, yes without           | never                                                                                   |
| project `CLAUDE.md`                    | main thread yes; subagent no with `omitClaudeMd`                                            | never                                                                                   |
| project `AGENTS.md`                    | main thread only when no `CLAUDE.md` is found at any level; subagent no with `omitClaudeMd` | root yes, subagent yes, inherited from the parent thread                                |
| `~/.codex/AGENTS.md`                   | never                                                                                       | root and every subagent                                                                 |
| `config.toml` `developer_instructions` | never                                                                                       | root; a role's own `developer_instructions` replaces it, a role without one inherits it |
| role text                              | `agents/<role>.md` body                                                                     | `agents/<role>.toml` `developer_instructions`                                           |

**Codex.** `codex debug prompt-input` shows every developer item; `codex debug models` shows each model's base prompt and injected messages. Default root boot 14.1K tokens; with `personality = "none"`, the `include_*` switches off, `features.{apps,plugins,recommended_plugins,browser_use,computer_use,image_generation,goals}` off and `skills.bundled` off, 10.3K; web search is 2.5K of that and stays on. `multi_agent_mode` forbids spawning unless the user, `AGENTS.md`, or a skill asks: developer instructions alone got 0 spawns in 2 runs, the one-line `AGENTS.md` 5 in 2. Forks inherit the parent model. A role file accepts `developer_instructions`, `model`, `model_reasoning_effort`, `model_reasoning_summary`, `model_verbosity`, `personality`, `service_tier`, `features` (disable only) and `skills` (disable only), nothing else. A same-name role overrides a built-in (`explorer`, `worker`, `default`). Roots on Astra and Luna get `send_user_message_async`; in `codex exec` it returns no answer. Per-step latency is 3 to 5 s on every model and effort. Hooks exist with the same events as Claude Code.

**Claude Code.** Clean boot 36.4K tokens, 72K chars of tool schemas; `disableBundledSkills`, `disableWorkflows`, `disableClaudeAiConnectors`, `autoMemoryEnabled: false`, `includeGitInstructions: false` and a bare-name `permissions.deny` list bring it to 10.0K. Cache reads cost 2.5% of input against 10% on Codex. `AskUserQuestion` exists only when a host provides the permission callback; `claude -p` never has it, so probes go through the Agent SDK with `canUseTool`. The question panel renders the question as plain text with numbered buttons: code never goes in a question. A `PreToolUse` hook under t3 code does not see a text block written in the same assistant message as the gated call; a text block before a `Bash` call is persisted before the call. Subagent frontmatter: `model`, `effort`, `tools` (omit `Agent` to forbid nesting), `omitClaudeMd: true`, `skills:` to preload; a same-name agent overrides a built-in, `permissions.deny: ["Agent(Explore)"]` removes one. `appendSystemPrompt` and `appendSubagentSystemPrompt` exist in the binary but are not honoured from `settings.json`.

**Permission mode.** t3 code sets it per thread: Full access is `bypassPermissions` and the default, Auto-accept edits is `acceptEdits`, Supervised passes none. A subagent inherits the parent's mode; agent frontmatter `permissionMode` overrides it. Under `bypassPermissions` Claude injects "make file changes with sed, heredocs" and no setting removes it.

**t3 code.** Runs the same `claude` binary as the terminal: `binaryPath` is `claude` on PATH, 2.1.278; the Agent SDK ships no cli. Injects, every turn: Codex a `<collaboration_mode>` block (default mode: "strongly prefer assumptions", "never write a multiple choice question as text"; plan mode: a 3-phase plan prompt he rejects) plus `<runtime_info>` and PR-linking rules; Claude the `claude_code` preset plus the same append, settings from user, project and local scopes, `permissionMode` from the runtime mode. Renders GFM tables, task lists, GitHub alerts, `<details>`, shiki fences including `diff`, file links `[name](/abs/path:line)`. No mermaid, no remote images. Review comments on the diff arrive as `[Review comment …]` context in the next message.

## Probing

- One stable directory per purpose under the probe root: `claude-home`, `codex-home`, `project`, `pair-claude`, `pair-codex`, `pair-project`. Reset before each run, never a numbered copy.
- Claude probes run under `/tmp`, never under `/home/mp281x`: an ancestor `.claude/CLAUDE.md` is loaded as a Project file and suppresses the project's `AGENTS.md`. Every probe before 2026-09-21 ran under the home and carried the real pair text.
- `CODEX_HOME` and `CLAUDE_CONFIG_DIR` select a scratch home with `auth.json` or `.credentials.json` symlinked from the real one; for the Agent SDK, `settingSources: ['project']` with the agents copied into the clone's `.claude/`.
- One clean clone per run, never two agents in one worktree. The clone at `/home/mp281x/deslop` is behind this branch: clone this worktree's branch when the prompts name current paths.
- Prompts in his voice, including `---` topics, "as a side note", `idk`, a why-question, an approved slice with its acceptance command, a bare "cleanup X", an explanation request.
- `claude -p` and `codex exec` have no question tool: the decisions stand as a table in the final message.
- Claude models refuse a "list the MARKER tokens" prompt as injection; read the transcript's `instructions` attachment instead.
- Codex: `codex exec --json --skip-git-repo-check --sandbox danger-full-access < /dev/null`; a `developer_instructions` key placed after a `[table]` in TOML silently belongs to that table.
- Claude: a probe clone's `CLAUDE.md` must be formatted or `vp run check` fails inside the probe.
- Git probes need a bare origin in place of the real remote and the role's remote-name guard.
- Never kill probe processes with a pattern that appears in the same command line; it kills the shell.
- Codex quota is finite: iterate on Claude, confirm on Codex with one or two runs.
- `codex` warns `Refusing to create helper binaries under temporary dir "/tmp"` and runs anyway.

## Decisions

Settled from 991 Codex threads, 14 Claude threads, and 15 pair-text iterations run two to three times on seven prompts.

| Decision                                                                | Fact                                                        |
| ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| Pair text carries: delegation, prototypes, questions, tokens, structure | see CLAUDE.md                                               |
| No orchestrator role; the pair thread has tools and delegates           | Tool-less primary: 2,134 waits, 1,733 relays in four days   |
| Nothing the base prompt says is restated                                | t3 code injects its own mode text every turn                |
| The harness is stripped by configuration, not by prose                  | Codex 14.1K to 10.3K, Claude 36.4K to 10.0K tokens          |
| Memory features off everywhere, web search on                           | 261 web calls in 68 threads, no role-level switch exists    |
| One fixed template per phase, state line first                          | 63% of his proceed replies followed a stop asking nothing   |
| Decisions only through the native question tool                         | The panel renders question text with numbered buttons       |
| Facts the workflow guarantees are never stated                          | Guarantees were the last recurring filler in messages       |
| Explanations are a file tree plus at most four excerpts                 | He reads code, not prose                                    |
| The reason for an artifact lives inside it as a comment                 | Prose beside a table is the same thing read twice           |
| No hook on the question tool                                            | Same-message text is not persisted before the hook          |
| After an edit no diff in the message, only simplification questions     | The client already shows the diff                           |
| Delegation is words, not a hook                                         | Judgement calls need leading words, not static enforcement  |
| `explorer` runs Sonnet 5 at medium; Haiku rejected                      | Sonnet $0.066 per call, 0 wrong claims in 97; Haiku wrong   |
| Codex gets a one-line `AGENTS.md` naming the roles                      | Codex authorizes spawning only from `AGENTS.md` or a skill  |
| One file per harness, copied, no renderer                               | Duplicated prose beats a script deriving one from the other |
| The git role never touches branches, pushes to a named remote           | t3 code creates the worktree and branch per thread          |
| `worker` invokes `review` and `browser`, the pair thread never does     | Routing results through the pair thread is the failed hub   |
| Artifacts take the GFM shape that fits; fences hold code, diffs, trees  | The client renders tables and lists                         |
| On a package or a tool the tree is proposed before the first slice      | All six structure requests came after the slices landed     |
| Published TypeScript is built; only the workspace consumes `.ts`        | Node 26 refuses type stripping under `node_modules`         |
| A consumer restates the `ignorePatterns` and rule options it wants      | oxlint merges `overrides` across `extends`, replaces both   |
| A `jsPlugins` specifier must resolve from the linted root               | oxlint resolves plugin specifiers from the linted root      |
| The formatter configuration is duplicated per root                      | oxfmt loads a TypeScript config but has no `extends`        |
| A consumer's `oxlint.config.ts` is `extends: [config]`                  | oxlint loads `oxlint.config.ts` and merges the import       |
| The lockfile is edited by hand and installed frozen                     | `vp install` re-resolves `latest` to an unpatchable oxlint  |
| `@deslop/workflow` publishes through npm trusted publishing on `main`   | Each push to main publishes `0.1.<run number>`              |
| `~/.deslop/harness-probe/turbo-probe` is the consumer test              | An outside Turborepo consumes the published package         |

## The engineering skill

`tools/workflow/src/agents/skills/engineering/SKILL.md` is one file, no references: 31 `ts` blocks, one per rule, `// bad` from a correction in the thread corpus, a GitHub issue (#44, #57, #64 hold his own bad/good pairs), or a line the repository linter reported in a probe file, `// good` from a repository call site. Its `## Package` section holds a bad and a good tree fixture copied from git. It also covers what Oxlint, Fallow and tsconfig enforce, so the worker writes the final form first and static analysis only catches regressions. Ten rules in `src/rules/`, one file per rule, back its blocks: `no-typeof` reports every `typeof` operator against the `Predicate` module, `no-module-mocking` reports `vi.mock`, `vi.spyOn` and their siblings because a Layer is the seam; `no-duplicate-root-dependency` is removed. `.agents/skills/project-engineering/SKILL.md` is the same shape, one file, eleven sections: layout trees, the `@deslop/<package>/<path>` key, subpath import maps, RPC and Atom, tests beside the public interface, exports, dependencies declared once at the root since `no-duplicate-root-dependency` is gone, generators, components, enforcement owners, Fallow; its five references are deleted. The layout tree lives there because the engineering skill is shared with the dual repository, which lays packages out differently.

Two of the engineering skill's `## Quality` rules the repository itself breaks, kept by his call: `packages/ai/src/internal/*.test.ts` test internal modules; `main.client.tsx:12` carries a reasoned suppression.

### Eval

- Template: `~/.deslop/harness-probe/eval-template`, a fresh Effect 4.0.0-rc.112 project with tsc and vitest only, no linter, `@effect/platform-node-shared` pinned to rc.112 because platform-node resolves a newer one that imports a module rc.112 lacks.
- Briefs: `~/.deslop/harness-probe/eval-brief.md`, a ledger service in his voice exercising every section of the engineering skill (decimal strings, tag normalization, a literal union, fail-fast on a malformed file, five operations, tests), and `eval-brief-2.md`, a changelog parser (`Match`, `DateTime`, `Clock`, an optional scope, counting). Neither carries a rule hint. Pairs below are ledger · changelog.
- Run: copy the template, `CLAUDE_CONFIG_DIR=/tmp/eval-home claude --agent worker -p "<brief>" --dangerously-skip-permissions --output-format json`; the scratch home holds `settings.json`, the three role files, the skill under `skills/engineering`, a symlinked `.credentials.json`, and denies `Agent(worker)`. About $5 and 15 minutes per run.
- Count: a `worker` slice copies the generated `src` into `apps/portfolio/src/probe/`, rewrites `#` subpaths to relative, runs `vp lint apps/portfolio/src/probe`, deletes the probe, invokes `review` pointed at the prototype skill file, and returns both counts. The eval run's own review uses the installed skill, so it never gives the count.

Current state, one row per run:

| Run                                                                                         | Measured                                                                       | Result                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| engineering skill, batch 8                                                                  | diagnostics per run · review defects per run                                   | 2,1 · 1,1 and 8,8 · 3,5                                                                                                                                                                                                                                                               |
| pair text, 2026-09-21, prototype, 3 prompts per harness (explanation, approved rename, idk) | root edits · change owner · state line                                         | 0 and 0 · worker on both · 3 of 3 on both                                                                                                                                                                                                                                             |
| pair text, 2026-09-21, Claude                                                               | pre-final messages                                                             | one progress line, in the explanation run                                                                                                                                                                                                                                             |
| pair text, 2026-09-21, Codex                                                                | pre-final messages · the idk prompt                                            | 1/3/2, one carrying a tree · diagnosis without a decision table                                                                                                                                                                                                                       |
| pair text and return shape, 2026-09-21, Codex 0.155.1, change prompt, 2 runs                | root edits · change owner · state line first · pre-final root messages         | 0 · worker · root, worker and review 2 of 2 each · one line, no fence, 2 of 2                                                                                                                                                                                                         |
| pair text and return shape, 2026-09-21, Claude Code 2.1.278, change prompt, 2 runs          | root edits · change owner · state line first · prose around it · over-delivery | 0 · worker · root 1 of 2 (the other put its decision table in a second message after the question tool was found absent), worker and explorer 2 of 2, review last 1 of 2 · worker validation lines 2 of 2, review a paragraph 2 of 2 · explorer five artifacts and a file dump 1 of 2 |

Open items:

| Missed                                                    | Seen in                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| A one-call-site helper such as `renderCommit`             | every changelog run                                                           |
| Blank lines skipped against the brief                     | half the changelog runs                                                       |
| A redundant `Schema.isLowercased()` after `toLowerCase()` | the ledger runs                                                               |
| Prototype `join` on array literals in tests               | the tests of both briefs                                                      |
| The repo-specific service key, `deterministic-keys`       | once per run; belongs to project-engineering                                  |
| Prose added around the state line                         | Claude worker, review and explorer (Opus 5 / Sonnet 5, medium); no Codex role |

Settled:

| Decision                                                            | Fact                                                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| The eval slice is synthetic and outside the repo                    | A repo slice lets the agent copy code instead of rules                                 |
| The brief carries no rule hints                                     | A brief naming the rules coaches what it measures                                      |
| Rules are discussed before runs                                     | Evals on a skill about to be deleted measure nothing                                   |
| One skill file, references deleted                                  | 155 of 211 Codex threads opened the skill, no reference                                |
| A bad side he never corrected is kept when his sentence backs it    | Eleven rules stand on his sentence alone                                               |
| Autofixable rules stay in the skill                                 | He wants the final form written first                                                  |
| A block's comment sits on the line it names                         | The formatter moved one into a generator body                                          |
| `SchemaGetter` and `SchemaTransformation` are Effect module objects | Their `trim()` and `toLowerCase()` were reported as prototype methods                  |
| A service method takes the schema's Type as is                      | Three runs split between Type, Encoded and branded Type                                |
| A layer without parameters is `static layer`, never readonly        | Both runs wrote `static readonly layer`                                                |
| One domain error per service in `schema.ts`, cause kept             | Runs split between library unions and invented wrappers                                |
| A bad line that reads like a design is dropped                      | Run 13 reproduced three bad lines verbatim                                             |
| The engineering skill carries the service layout tree               | Runs split files four ways until the tree existed                                      |
| Bare `yield*` lines in a block sit inside a generator               | The formatter rewrote them and hid a nonexistent method                                |
| The worker never invokes `worker`                                   | 19 of 19 runs nested one; nested runs carried the outliers                             |
| Every good line obeys every other block                             | An audit found four breaking lines and seven duplicate pairs                           |
| Docs-backed idioms enter as good lines when a run hand-rolled them  | `Duration.parts`, `Array.match`, `Config.redacted`, `Effect.fn` with `Effect.mapError` |
| The layout tree is repo-specific, in project-engineering            | The engineering skill serves the dual repository too                                   |
| The two-decimal summary is returned as a decision                   | Wanted; effect ships no fixed-scale formatter                                          |
