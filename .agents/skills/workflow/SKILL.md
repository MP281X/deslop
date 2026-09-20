---
name: workflow
description: 'Use when changing the reusable agent workflow: the pair-thread text, the roles, the Codex and Claude Code configurations, or the installer. Holds what was measured and what the user wants, so nothing is re-derived.'
---

## Objective

The user converses with one agent, the pair thread, that turns half-formed ideas into decisions and artifacts he reacts to, then hands approved slices to cheaper agents that finish them without him. The same behavior runs on Codex and Claude Code through t3 code. Both harnesses are stripped to what the workflow uses; nothing a base prompt already says is restated, and nothing contradicts it.

## How he works on the workflow

- **Show, never describe.** He judges outputs, not prompts: run the text on a clean clone and paste the verbatim result. A proposal without a run is not ready.
- **Measure structure across runs, never length.** Two to three runs per prompt; count state line, decision asked through the tool, no implicit facts, no diff after an edit, edits only on change prompts, delegation happened. Characters are not a metric; consistency across threads is.
- **Questions only when the data cannot decide**, through the native question tool, artifact in the message, each option with its cost. A question answerable from usage data is a defect ("is web search used?" was answered by 261 calls in 68 threads).
- **Pros and cons for every choice**, one line each. No recap, no restating his message, no "no action" or "checks pass".
- **Small over clever.** Copied files beat a renderer; duplicated prose beats a script that derives one harness from the other. He said so after seeing a 100-line renderer.
- **Words, not hooks.** A judgement call gets strong leading words ("Delegate reading."). The one hook tried, the ask gate, passed 14 of 14 on the SDK and 0 of 5 in t3 code; he rejected the script and wants the words fixed instead.
- **Delegate the analysis** to Sonnet or Haiku subagents; keep only conclusions in the expensive context.
- **He parallelizes and reads on a phone**: tables of at most three columns, `<details>` only for evidence, never the decision.
- **Codex quota is finite**; iterate on Claude, confirm on Codex with one or two runs.

## Files

`tools/workflow/assets/codex/` and `tools/workflow/assets/claude/` are copied as they are into `~/.codex` and `~/.claude`; `assets/skills/engineering` is copied into both. The pair text and each role body exist twice, once per harness, edited in both places. No rendering.

| Path                   | Holds                                                                      |
| ---------------------- | -------------------------------------------------------------------------- |
| `codex/config.toml`    | stripped config, pair text as `developer_instructions`, role registrations |
| `codex/AGENTS.md`      | the one line that authorizes Codex to spawn the roles                      |
| `codex/agents/*.toml`  | role bodies with their Codex model                                         |
| `claude/CLAUDE.md`     | pair text                                                                  |
| `claude/settings.json` | stripped settings, denied tools and built-in agents                        |
| `claude/agents/*.md`   | role bodies with their Claude model and tools                              |

`vp run build` in `tools/workflow`, then `node dist/main.js`; `CODEX_HOME` and `CLAUDE_CONFIG_DIR` select the homes. Nothing installs on its own; he says when. The installer removes every managed entry before copying, so hand edits to installed files are lost on every install; an asset deleted in a release gets one explicit removal in `main.ts` for that release only, dropped at the next.

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

**Claude Code.** Clean boot 36.4K tokens, 72K chars of tool schemas; `disableBundledSkills`, `disableWorkflows`, `disableClaudeAiConnectors`, `autoMemoryEnabled: false`, `includeGitInstructions: false` and a bare-name `permissions.deny` list bring it to 10.0K. `AskUserQuestion` exists only when a host provides the permission callback; `claude -p` never has it, so probes go through the Agent SDK with `canUseTool`. The question panel renders the question as plain text with numbered buttons: code never goes in a question. Under t3 code a `PreToolUse` hook does not see a text block written in the same assistant message as the gated call; a text block before a `Bash` call is persisted before the call. Subagents: `model`, `effort`, `tools` (omit `Agent` to forbid nesting), `omitClaudeMd: true` keeps the pair text out, `skills:` preloads a skill; a same-name agent overrides a built-in, `permissions.deny: ["Agent(Explore)"]` removes one. Claude narrates "Looking at…" lines and, without a gate, put the artifact inside the question in 6 of 14 SDK runs. Cache reads cost 2.5% of input against 10% on Codex.

**t3 code.** Injects, every turn: Codex a `<collaboration_mode>` block (default mode: "strongly prefer assumptions", "never write a multiple choice question as text"; plan mode: a 3-phase plan prompt he rejects) plus `<runtime_info>` and PR-linking rules; Claude the `claude_code` preset plus the same append, settings from user, project and local scopes, `permissionMode` from the runtime mode. Renders GFM tables, task lists, GitHub alerts, `<details>`, shiki fences including `diff`, file links `[name](/abs/path:line)`. No mermaid, no remote images. Review comments on the diff arrive as `[Review comment …]` context in the next message.

## Probing

- One scratch home per variant: `CODEX_HOME=/tmp/x/codex` with `auth.json` symlinked from `~/.codex`, `CLAUDE_CONFIG_DIR` or, for the SDK, `settingSources: ['project']` with the agents copied into the clone's `.claude/`.
- One clean clone per run under `~/.deslop/harness-probe/`, never two agents in one worktree: a shared tree contaminated a whole batch once.
- Prompts in his voice, including `---` topics, "as a side note", `idk`, a why-question, an approved slice with its acceptance command, a bare "cleanup X", an explanation request.
- Git probes need a bare origin in place of the real remote and the role's remote-name guard: one Codex run pushed to a URL inferred from the manifest and opened a real pull request.
- Codex: `codex exec --json --skip-git-repo-check --sandbox danger-full-access`; a `developer_instructions` key placed after a `[table]` in TOML silently belongs to that table.
- Claude: a probe clone's `CLAUDE.md` must be formatted or `vp run check` fails inside the probe.
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
| No hook on the question tool; the pair text alone carries the state-line rule            | SDK: text 1 of 8, gate 14 of 14; t3 code: gate 0 of 5 because same-message text is not persisted before the hook; he rejected the script           |
| `explorer` runs Sonnet 5 at medium                                                       | 0 wrong claims in ~97 at $0.066 per call; Haiku read twenty times more, cost $0.20 per call, and got claims wrong at every effort and prompt tried |
| Delegation is words, not a hook                                                          | He prefers strong leading words over static enforcement for judgement calls; the ask gate confirmed it                                             |
| Codex gets a one-line `AGENTS.md` naming the roles                                       | Codex authorizes spawning only from AGENTS.md or a skill                                                                                           |
| One file per harness, copied, no renderer                                                | He prefers duplicated prose over a script that derives one harness from the other                                                                  |
| The git role never touches branches; it pushes only to a configured remote by name       | t3 code creates the worktree and branch per thread; one Codex run pushed to a URL inferred from the manifest                                       |
| worker invokes review and browser; the pair thread never does                            | Routing results through the pair thread is the message hub that failed                                                                             |
| Artifacts take the GFM shape that fits; fences only for code, diffs, trees               | A message of `text` fences on 2026-09-20 was rejected; the client renders tables and lists                                                         |

## The engineering skill

`tools/workflow/assets/skills/engineering/SKILL.md` is one file, no references: 31 `ts` blocks, one per rule, `// bad` from a correction in the thread corpus, a GitHub issue (#44, #57, #64 hold his own bad/good pairs), or a line the repository linter reported in a probe file, `// good` from a repository call site. It also covers what Oxlint, Fallow and tsconfig enforce, so the worker writes the final form first and static analysis only catches regressions. `.agents/skills/project-engineering/SKILL.md` is the same shape, one file, nine sections: layout trees, the `@deslop/<package>/<path>` key, subpath import maps, RPC and Atom, tests beside the public interface, exports, generators, components, enforcement owners, Fallow; its five references are deleted. The layout tree lives there because the engineering skill is shared with the dual repository, which lays packages out differently.

His stance, each point said more than once over two months of corrections:

| Area      | Rule                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types     | Infer every type; annotations only for recursive functions. Casts only `satisfies` and `as const`. No `any`, `unknown`, `object` outside untrusted input; a service method takes the schema's Type as is                                                                                                                                                                                                                     |
| Schema    | Same-named `type X = typeof X.Type` on the line before every Schema, exported or not; `Schema.Struct`, never `Schema.Class`; definitions at module scope, decode and encode inlined at the call site, never aliased; logic in the schema, `.make` over casts                                                                                                                                                                 |
| Effect    | Effect is the language: `String`, `Array`, `Predicate`, `Match`, `Boolean.match` over prototype methods and globals, standalone `pipe`; `Effect.fn` with arguments, `Effect.gen` without; services with the shape in `service.ts`, the implementation in `internal/`, `static layer = Layer.effect(...)` never readonly, no default implementation; fail fast; `Option` only where it composes; never wrap Effect primitives |
| Shape     | No wrapper, alias, access variable, module-level constant, or one-call-site helper; no forwarding generator, identity `Service.of`, or `readonly` syntax; one way to do each thing; dead code deleted, never ignored; no configuration flag nobody asked for                                                                                                                                                                 |
| Tests, UI | Tests only on service public interfaces through `it.layer`, never on Schema semantics; UI verified in a browser; React logic in Effect Atom, React Compiler memoizes                                                                                                                                                                                                                                                         |
| Lint      | A diagnostic is fixed at the root; a file ignore list or a rule off is rejected; one inline reasoned suppression exists in the repo and stays his decision                                                                                                                                                                                                                                                                   |

Two rows the repository itself breaks, kept as stance by his call: `packages/ai/src/internal/*.test.ts` test internal modules; `main.client.tsx:12` carries a reasoned suppression.

### Eval

- Template: `~/.deslop/harness-probe/eval-template`, a fresh Effect 4.0.0-rc.112 project with tsc and vitest only, no linter, `@effect/platform-node-shared` pinned to rc.112 because platform-node resolves a newer one that imports a module rc.112 lacks; the first batch lost turns to that.
- Brief: `~/.deslop/harness-probe/eval-brief.md`, a ledger service in his voice, no rule hints, exercising every stance row: decimal strings, tag normalization, a literal union, fail-fast on a malformed file, an in-memory service with five operations, tests.
- Run: copy the template, `CLAUDE_CONFIG_DIR=/tmp/eval-home claude --agent worker -p "<brief>" --dangerously-skip-permissions --output-format json`; the scratch home holds `settings.json`, the three role files, the skill under `skills/engineering`, and a symlinked `.credentials.json`. About $5 and 15 minutes per run.
- Count: copy the generated `src` into `apps/portfolio/src/probe/`, rewrite `#` subpaths to relative, `vp lint apps/portfolio/src/probe`, delete the probe; then `review` in this thread pointed at the prototype file. The worker's own review runs on the installed skill, so the count comes from here.

| Batch | Skill                                                    | Diagnostics in src per run | Review defects per run |
| ----- | -------------------------------------------------------- | -------------------------- | ---------------------- |
| 1     | 23 blocks                                                | 25, 15, 12                 | 23, 7, 11              |
| 2     | + nine shared misses as blocks                           | 4, 2                       | 5, 4                   |
| 3     | + method input, layer form                               | 5, 2                       | 5, 5                   |
| 4     | same skill, changelog brief added                        | 5, 1 · 9, 6                | 9, 12 · 9, 9           |
| 5     | + batch-4 misses                                         | 2, 16 · 4, 2               | 21, 27 · 6, 5          |
| 6     | + domain error, layout tree                              | 1, 19 · 1, 1               | 6, 22 · 4, 5           |
| 7     | same skill, no nested worker                             | 2, 1 · 1, 2                | 4, 1 · 4, 4            |
| 8     | + audit fixes, doc idioms, layout moved to project skill | 2, 1 · 1, 1                | 8, 8 · 3, 5            |

From batch 4 the second brief (`eval-brief-2.md`, a changelog parser: `Match`, `DateTime`, `Clock`, an optional scope, counting) runs beside the ledger; pairs above are ledger · changelog. Every run of batches 1 to 6 had the root, started as `worker`, invoke a second `worker` and let it write; the two ledger regressions (16 and 19 diagnostics) were nested runs. Batch 7 denies `Agent(worker)` in the scratch home and both worker texts now say never to invoke `worker`; it is the first batch where all four runs agree on layout, schema pairs, the domain error and `static layer`.

Every run from batch 2 on returned the two-decimal summary as a decision, because `BigDecimal.format` normalizes and effect ships no fixed-scale formatter; that is the wanted worker behavior.

Still missed after seven batches: a one-call-site helper such as `renderCommit` in every changelog run; the two-decimal summary the ledger brief implies, which every run since batch 2 returns as a decision because `BigDecimal.format` normalizes; blank lines skipped in half the changelog runs against the brief; a redundant `Schema.isLowercased()` after `toLowerCase()`; prototype `join` on array literals in tests. The repo-specific service key (`deterministic-keys`) counts once per run and belongs to project-engineering. He expects more iterations.

Settled:

| Decision                                                                         | Evidence                                                                                                                                      |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Eval slice is synthetic and outside the repo                                     | A repo slice lets the agent copy existing code instead of applying the rules                                                                  |
| The brief carries no rule hints                                                  | A brief whose comments named the rules was rejected: it coaches what it measures                                                              |
| Rules are discussed before runs                                                  | Running three evals on a skill about to be deleted measures nothing he wants                                                                  |
| One skill file, references deleted                                               | 155 of 211 Codex threads opened project-engineering/SKILL.md and no reference; 386 of 791 for engineering                                     |
| A bad side he never corrected is acceptable when his sentence backs it           | Eleven rules had only his sentence; he kept them and asked for his own explanations from issues                                               |
| Autofixable rules stay in the skill                                              | He wants the final form written first, even where `vp run fix` would repair it                                                                |
| A block's comment must sit on the line it names                                  | The formatter moved `// no readonly` into a generator body and both runs kept the readonly                                                    |
| `SchemaGetter` and `SchemaTransformation` are Effect module objects for lint     | Their `trim()` and `toLowerCase()` were reported in two runs as prototype methods                                                             |
| A service method takes the schema's Type as is                                   | Three runs took Type, Encoded, and branded Type; he picked the plain Type                                                                     |
| A layer without parameters is `static layer = Layer.effect(...)`, never readonly | Both runs wrote `static readonly layer`; the block's comment had been moved by the formatter                                                  |
| One domain error per service in `schema.ts`, cause kept, as `AiError`            | Runs split between library unions and invented wrappers; he chose the wrapper with cause                                                      |
| A bad line that reads like a design is dropped, the good line stays              | Run 13 reproduced three bad lines verbatim; consistency is what he wants from this skill                                                      |
| The engineering skill carries the service layout tree                            | Runs split files four different ways until the tree; batch 7 agrees on `schema.ts`, `service.ts`, `internal/`                                 |
| Bare `yield*` lines in a skill block sit inside a generator                      | The formatter rewrote them as `yield * x` and hid a nonexistent `Effect.catchAll` for a whole batch                                           |
| The worker never invokes `worker`                                                | 19 of 19 eval runs nested one; the nested runs carried the outliers                                                                           |
| Every good line obeys every other block                                          | An audit found four good lines breaking other blocks and seven pairs showing one thing two ways; agents copy good lines verbatim              |
| Docs-backed idioms enter as good lines when a run hand-rolled them               | `Duration.parts`, `Array.match`, `Config.redacted`, `Effect.fn` with `Effect.mapError` as its pipeline argument, from the effect clone's docs |
| The layout tree is repo-specific and lives in project-engineering                | The engineering skill will serve the dual repository too                                                                                      |
