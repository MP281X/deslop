---
name: workflow
description: 'Use when reading or changing the reusable agent workflow: the pair-thread text, roles, Codex and Claude Code configuration, or installer. This is the durable handoff; do not reanalyze old threads for facts recorded here.'
---

# Workflow handoff

## Current state

| Layer      | State on 2026-09-24                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Installed  | Installed from the head of `t3code/improve-agent-workflow`, draft PR #82.                                                                                                                                                                                                                                                                                                                              |
| Unverified | This pass's t4 fix (a bug fix extends the covering test) and t6 fix (grounding finds existing enforcement) have not been evaluated. Next evidence, from a real task in a fresh session: the pair executes nothing itself and slices run in parallel; substantial work is shaped, then executes without check-ins; the first "done" is ready to merge with no user cleanup, reverts, or status prompts. |

## Contract

| Message                       | Pair behavior                                                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First message                 | Grounding round and discussion before anything is built                                                                                                                                                                                                                   |
| Question or problem           | Assessment with evidence, root cause, recommendation; no changes                                                                                                                                                                                                          |
| Small change request          | Existing-work check; on a first message, a one-line plan approved; slice; delivery pipeline; a few-line follow-up gets narrow proof and delivery only                                                                                                                     |
| Substantial work: shaping     | Six-item grounding and discussion; a core prototype before questions when underspecified; MVP is the smallest extension of the nearest feature with cut list and acceptance checks; technical choices stated as recommendations; only product choices asked, in one batch |
| Substantial work: execution   | Autonomous after approval. Disjoint-file slices in parallel, every agent on its configured model, acceptance verified by the pair, no check-ins                                                                                                                           |
| Delivery                      | Review in parallel with acceptance → one fix round from one table → target merge and full local check → recheck of touched criteria → one git run, plus a preview when rendered → pipeline wait through the native tool                                                   |
| Steer while work is in flight | Answered or queued; in-flight work continues                                                                                                                                                                                                                              |

## Ownership

| Owner     | Model: Claude / Codex                     | Owns                                                                                                                              | Never                                                              |
| --------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Pair      | set per thread in t3code                  | outcome, shaping, ledger, briefs, synthesis, acceptance verification through agents, the pipeline and check-in waits              | any other execution; the default branch                            |
| Explore   | claude-opus-5-5 low / gpt-6-sol low       | one bounded evidence source; located facts                                                                                        | edit, recommend, measure, overlap another source                   |
| Implement | claude-opus-5-5 high / gpt-6-sol high     | one slice with scoped proof; prototypes; the target merge, left uncommitted, and the full local check                             | git delivery, scope decisions, behavior-changing mechanical passes |
| Browser   | claude-opus-5-5 low / gpt-6-luna medium   | rendered criteria, observed defects or pass, prototype variant screenshots, same-session rechecks                                 | implementation                                                     |
| Git       | claude-opus-5-5 low / gpt-6-luna medium   | commits derived from the diff, push, draft request body and screenshot attachments, one rerun of an untouched failed pipeline job | branches, merges, the default branch, rerunning proof              |
| General   | claude-opus-5-5 medium / gpt-6-sol medium | worktree setup, the production preview and stopping it, evals, research, other delegated work                                     | product code, git, rendered checks                                 |
| Review    | claude-opus-5-5 high / gpt-6-sol high     | one adversarial pass over a finished branch diff, one per package above about 500 lines                                           | edits, runs, a second round                                        |
| t3        | —                                         | worktrees, branches, diff review, PR linking                                                                                      | workflow decisions                                                 |

## Source and delivery

The pair and each role are duplicated once per harness; edit mirrored bodies identically, with no renderer. `install.ts` replaces every top-level entry of `agents/claude` in `~/.claude` and of `agents/codex` in `~/.codex`, and each skill in both `skills/` folders.

| Source in tools/workflow/src/agents | Purpose                                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| codex/config.toml                   | Codex pair text, features, role registrations with descriptions, tool output limit, shell env                                                                      |
| codex/AGENTS.md                     | authorizes configured roles                                                                                                                                        |
| codex/agents/\*.toml                | Codex role bodies, names, nicknames, models, efforts                                                                                                               |
| claude/output-styles/pair.md        | Claude pair text as output style `pair`                                                                                                                            |
| claude/settings.json                | `outputStyle`; env (bash timeouts, TURBO_CACHE_DIR, pagers, NO_COLOR); disabled bundled skills, memory, and workflows; denied built-ins; default-branch deny rules |
| claude/agents/\*.md                 | Claude role bodies, models, efforts, background flags, preloaded skills                                                                                            |
| skills/\*/SKILL.md                  | engineering, design, and environment skills for both homes                                                                                                         |

Build in tools/workflow with `vp run build`, then run `node dist/install.js`. Install after every workflow change without asking. `CODEX_HOME` and `CLAUDE_CONFIG_DIR` select scratch destinations. A fresh session loads the result.

Harness facts, verified 2026-09-22 to 09-24:

- t3 launches Claude with `--setting-sources=user,project,local` and no system-prompt override. A user-level output style reaches the Claude main thread only. Roles leave `omitClaudeMd` unset, so they receive the repository AGENTS.md.
- Claude loads project skills only from `.claude/skills`, which symlinks `.agents/skills`.
- Deny rules block pushes to main or master and `gh`/`glab` merges by prefix; a bare `git push` with upstream main is not caught.
- Codex role developer instructions replace the root's. Role files honor developer_instructions, model, reasoning effort and summary, verbosity, personality, service tier, name, description, and nickname_candidates (~/.deslop/repos/codex/codex-rs/agent-roles/src/loader.rs:160). No config stops a spawned role from spawning, so roles say not to and the pair enforces it.
- Claude threads reload the pair text when the composer's model or effort changes (~~/.deslop/repos/t3code/apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:767-791) or after 30 idle minutes (~~/.deslop/repos/t3code/apps/server/src/provider/Layers/ProviderSessionReaper.ts:17); Codex needs a new thread. Role files are read at each spawn.
- ScheduleWakeup fires only after all background work ends; Monitor lines wake the pair while work runs; Codex has no wake (probe ~/.deslop/measure/checkin-probe/).
- Codex command rules live in `~/.codex/rules/`, which the installer would replace, so none ship.

## Settled decisions

Do not reopen these without contradictory current evidence:

- D1 The pair only coordinates; every execution goes to a background role — Inline Bash was 70–82% of Fable main-thread spend
- D2 Mirrored per-harness files; no generator, hooks, or scripts; project skills by symlink; Codex role files add name, description, and nickname_candidates, and config.toml keeps the descriptions; Codex matches Claude with a 15000-token tool output limit and the pager and NO_COLOR env — Hooks and generators were built and removed three times
- D3 Models are configured per role and shown in Ownership; briefs never override them — CursorBench: Opus 5.5 low 43.7% at $1.17 vs Sonnet 5 medium 28.0% at $2.31; explore A/B 23 s vs 31/55 s, all accurate; Codex implement at low gave up; 3 of 4 slices ran on Sonnet under an override
- D4 Memory and goals stay off — User decision; goals caused loops
- D5 Pair tuned to how the user writes — 249 Claude and 857 Codex prompts: bundled asks, hypotheses marked with idk or probably, why for root causes, top-to-bottom reading
- D6 Vendor prompting guidance: positive rules, good examples first, parallel requests, no second self-check — Anthropic guides for Opus 5.5, Sonnet 5, and Fable 5.1; OpenAI GPT-6 Astra guide and Codex model docs
- D7 A first message or any substantial work (new behavior, design choice, open definition, cross-package) is shaped before execution — 62% of 240 prompts were steering; the recursive-schema replay picked a syntactic proxy
- D8 Round one grounds six items with the general setup brief in the same dispatch; questions wait for it; grounding and the existing-work check include anything that already enforces the request (lint rule, type, check) — 3 rounds of code-level questions and 3 pivots; a dual install took 11 minutes inside a slice; e2e-final t6: 0 of 3 runs saw that `typescript/no-restricted-types` covers the case
- D9 Only product choices are asked, in one batch, each with today's behavior and the usual default; a recommendation the user would accept is a decision — GenUI: 5 of 8 questions answerable or moot, every recommendation accepted
- D10 The MVP extends the nearest feature and mirrors its sibling; the engineering skill beats repository standards; repository instructions never widen the request — 3 of 5 commits in a dual MR fixed missed sibling contracts; GenUI built a new format instead of extending Output Pages
- D11 Prototypes: built without asking during shaping, before questions when underspecified, with no checks, tests, or docs, stopped at the first deciding observation, restored before slices — Five checked prototype runs used about 50M tokens; Claude grew a scanner and timed out
- D12 The design skill owns consistency with nearby screens, 3–5 switchable variants, and the visual self-check; visual feedback becomes measured targets from the reference's source — The picker design landed only after measured targets
- D13 Schematic output with context explained; anything the user must approve goes complete in the turn's final message; role reports use one-line labels: review Cut, Defect, Blocker, Clean; explore Fact; general Resolved, Proposal; git Left — "i cannot see the plan"
- D14 Execution is autonomous: disjoint slices in parallel, independent owners launched together, repeated operations piloted once — One slice repeated a 45-minute shadcn add for 22 logos
- D15 Briefs state outcomes, constraints, ledger decisions, and where credentials come from, never code shape or secrets; recommendations never contradict the ledger; merges are checked against it — A brief dictated fields; a browser read the login from Postgres; an align checkout restored deleted files
- D16 One end-to-end acceptance check of the user's scenario on real input, never a new test; existing coverage is checked first — E2E suite merge-ready Claude 4/7, Codex 3/7
- D17 Proof: the narrowest command per slice, each command once; expensive steps once per delivery after aligning with the target; the final gate is the full local check with tests — 14 minutes of code vs over 2 hours of browser, tests, check, and pipeline; a dual replay shipped a broken snapshot
- D18 Checks, lint, reviewers, and the user are fallbacks; implement designs the final shape, trims by the engineering skill's reread list, reports `Trimmed:`, and captures exit codes — Implement deleted nothing while review found 11 cuts of 23
- D19 One review per delivery: cuts first, then breaks, walked per engineering-skill section, no nits — One fresh pass found about 30% removable code in 2.5 minutes; gpt-6-sol missed 2 planted leftovers
- D20 One fix round from one table reports "fixed N of M"; everything outside the request, exposed bugs included, is a proposal in the reply only; no cleanup loop — The picker cleanup spent 2.24M tokens redoing a 3.5M first pass; a GenUI fix round changed a server contract
- D21 Facts, hypotheses, and runtime claims stay distinct; a failed criterion stays failed until a recheck passes; an unrelated failure needs evidence per test — A runner was closed on an unevidenced theory
- D22 Browser: global agent-browser, one login and session per delivery, asserts by snapshot, one screenshot per accepted state, read back only when appearance is at stake, sessions closed — npx 40 s median call vs 0.4 s; a retake used 19.3M of 77M tokens
- D23 Mechanics are automatic: one git run commits, pushes, attaches screenshots (`gh` as `<path>#<criterion>`, `glab` as `<path>` with the criterion in the body), and writes the body; the link comes before the pipeline wait; git reruns an untouched failed job once — "commit/push/update" asked more than 12 times; a 19-minute wait hid a finished request
- D24 Rendered changes end with a production preview on free ports plus the tunnel line — Dev mode over the VPS takes about 90 s and 25 MB per page; users asked for a preview by hand twice
- D25 The default branch is protected by prompt and deny rules; git uses the configured identity, writes no config, and rewrites only unpushed commits; a refusal is a blocker, never rerouted — Two direct pushes to main; an email copied into git config; a refused rewrite rerouted to general
- D26 Progress: one line per event; exactly one 10-minute check-in pending, a one-shot Monitor in Claude or one wait_agent(600000) in Codex; ScheduleWakeup, TaskStop, and ListAgents are denied; stale wakes stay silent — A Codex pair spent 17.5M tokens over 71 waits; a pair was silent for 31 minutes
- D27 Commands end on their own and a hang is a blocker; status reads each agent's latest command from its transcript — An 82-minute shadcn hang; a symlink stat answered "not stuck"
- D28 The environment skill owns host facts: scratch under ~/.deslop/<task>/ with <task> the worktree directory name, stopping only this thread's process groups, and each repository's file-format command; host gaps are fixed at the root; agents never repair the VPN — UFW blocked IPv6 and a proxy hid it; check-types 238 s cold vs 14 s cached; /tmp scratch held 5G; a pair offered to kill another worktree's app
- D29 vp and vpx only, bun only as the preview runtime; the environment skill owns it — User decision, no exceptions
- D30 Library source comes from clones in ~/.deslop/repos, cloned first when missing, never node_modules or vendor; the environment skill owns it — 216 web lookups, several answerable from a clone; agents read node_modules/effect beside the clones
- D31 The engineering skill: Simplicity first, plain Effect-first code, only valuable tests, a bug fix adds its failing case to the existing test of the fixed code, layers depend inward; deslop is the minimum bar — 22 overbuilt incidents; about 700 removable test lines against about 60 of logic; e2e-final t4: both Claude runs skipped the one-line fixture
- D32 Evals judge merge-readiness in deslop and dual, repeated, worst run counts; optimization stops at a target or a round within variance; changed fixtures restart the baseline — A tuning thread counted +1/12 and changed its knowledge base mid-comparison

## Evidence index

Use these artifacts instead of reconstructing prior investigations:

- 2026-09-22 prompt evals: ~/.deslop/measure/{short-contract-eval,workflow-cli-review,prototype-first-demo,prompt-procedure-eval,workflow-quick-eval}/ — Claude expanded a failed prototype into a scanner and timed out; source reviews conflated hooks with runtime guarantees
- 2026-09-22 thread analysis: ~/.claude/projects/-home-mp281x--t3-worktrees-deslop-t3code-05561f1c/47dde977-6225-46e8-ba87-eb9ca3b79743.jsonl — 17 threads, 240 prompts: 62% steering; 22 overbuilt incidents; parallelism, token spend, and harness capabilities measured
- 2026-09-23 deploy thread: ~/.claude/projects/-home-mp281x--t3-worktrees-dual-t3code-826b875c/e6375478-a22d-4f16-a83b-f6ebf2170533.jsonl — Deploy Run button: 77M input tokens, browser 33%; 3 churn commits from missed sibling contracts; pair ran 50+ Bash calls
- 2026-09-24 picker thread: ~/.claude/projects/-home-mp281x--t3-worktrees-dual-t3code-b58f7917/01e1831a-09e7-464b-98df-f7c260cf2f48.jsonl — 3 prompts over 6 h; subagents 176M tokens, browser 103M; shadcn hang 82 min; 19-minute pipeline wait; about 30% of the diff removable
- GenUI thread: ~/.claude/projects/-home-mp281x--t3-worktrees-dual-t3code-bcccbee3/e30bbaa7-ffec-42af-83ef-68ae31f07f6e.jsonl; ~/.deslop/genui{,-fix}/ — 5 of 8 questions answerable or moot; a new dashboard format instead of Output Pages; fix round reported 20 of 23 and changed a server contract
- Tickets thread: ~/.claude/projects/-home-mp281x--t3-worktrees-dual-t3code-99352625/249b219b-17a2-47cd-b20a-02443a4ad556.jsonl — 3 rounds of code-level questions before grounding returned, 3 design pivots; "i'm new to the codebase"
- 2026-09-24 thread analyses: ~/.claude/projects/-home-mp281x--t3-worktrees-dual-t3code-37a9d4cb/e474c368-d5e4-40d3-816e-8b02d6abf29f.jsonl; ~/.codex/sessions/2026/09/24/rollout-2026-09-24T{08-57-31,11-33-07}-\*.jsonl — Codex waits dominated pair tokens; Python used 43 times; a merge commit took three agent runs; a long-lived thread repeated its own self-execution
- Evals on installed versions: ~/.claude/projects/-tmp-eval-{batch,review,hang,done,proto,web,status}/, -tmp-ev2-claude-{done,proto,status,web}/; keys and Codex runs in ~/.deslop/measure/review-pack/ev2/ — Hang reported as a blocker in 160 s; 5 planted leftovers: review once, one fix round, pushed in 172 s; rename follow-up 40 s; 3 prototypes in 80 s; rendered app end to end in 5m59s; Codex finish-branch 514 s with 2 leftovers missed
- Replays: ~/.deslop/measure/review-pack/replay/{results,judge}/; ~/.claude/projects/-tmp-replay-claude-{deslop,dual}/ — Blind judge: deslop lint fix merged 6.5, Claude 4, Codex 2.5; dual cleanup Codex 6, merged 4.5, Claude cut off by a 600 s limit
- E2E suite: ~/.deslop/measure/review-pack/e2e-baseline.md — t1–t7 reference diffs and verdicts, merge-ready Claude 4/7, Codex 3/7
- E2E final: ~/.deslop/measure/review-pack/e2e-final.md — merge-ready on t3–t6: Claude 2/4 in both runs, Codex 2/4 (baseline Claude 2/4, Codex 1/4); t6 existing coverage 0/3; t4 Claude skipped the regression fixture
- Model research and A/B: cursor.com/cursorbench, artificialanalysis.ai, vendor guides; ~/.deslop/measure/{role-ab,codex-effort,codex-effort-hard,routing,simplicity,progress}/ — Opus 5.5 beats Sonnet 5 at every effort in fewer steps; role and Codex effort A/B; routing 9/14 and 10/14 at baseline; simplicity 4 of 5 matching the reference

Do not compare elapsed times across changed prompts, harness versions, fixtures, hosts, or isolation. Aggregate input includes cached tokens and is not unique context size.

## Package facts

- The workflow package owns its agent assets, installer, shared Oxlint config, twelve repository rules, and exported TypeScript config.
- Published TypeScript is built because Node 26 refuses type stripping under node_modules.
- Consumers restate the ignorePatterns and rule options they want; Oxlint merges overrides across extends but replaces those fields. A jsPlugins specifier resolves from the linted root. Formatter configuration is duplicated per root because oxfmt has no extends.
- Releases publish @deslop/workflow from main as 0.1.<run number>. The external consumer probe is ~/.deslop/harness-probe/turbo-probe.
