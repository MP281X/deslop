---
name: workflow
description: 'Use when reading or changing the reusable agent workflow: the pair-thread text, roles, Codex and Claude Code configuration, or installer. This is the durable handoff; do not reanalyze old threads for facts recorded here.'
---

# Workflow handoff

## Current state

- 2026-09-26, branch `t3code/analyze-claude-workflow-tokens`: the pair texts are rewritten for the two modes below, with the main thread doing the execution work. The branch's workflow is installed at delivery, after the repository check and draft PR.
- The branch also drops Codex's `personality = "none"` so its default personality applies (`~/.deslop/repos/codex/codex-rs/models-manager/src/model_info.rs:50`), drops the ScheduleWakeup, ListAgents, and TaskStop denies, puts every Codex role on gpt-6-astra, and raises Codex's multi-agent v2 wait default to its maximum, since a wait returns as soon as an agent finishes.
- Unvalidated: no eval has run the new texts. Next: the real eval's workflow arms (commands in ~/.deslop/measure/real-eval/README.md), then real-PR tracking with merge-rate.sh against the 31% baseline.

## Source and delivery

Each harness has its own plain text tuned to its model, Opus 5.5 in Claude Code and GPT-6 Astra in Codex: similar developer experience, different prompts, so edit each for its model instead of mirroring wording. Both harnesses register the same roles: `explore`, `implement`, `browser`, `review`.

| Source in tools/workflow/src/agents | Purpose                                                              |
| ----------------------------------- | -------------------------------------------------------------------- |
| codex/config.toml                   | Codex pair text, features, role registrations, tool limit, shell env |
| codex/AGENTS.md                     | authorizes spawning the roles                                        |
| codex/agents/\*.toml                | Codex role bodies, models, efforts                                   |
| claude/output-styles/pair.md        | Claude pair text as output style `pair`                              |
| claude/settings.json                | Claude settings and deny rules                                       |
| claude/agents/\*.md                 | Claude role bodies, models, efforts, preloaded skills                |
| skills/\*/SKILL.md                  | engineering, design, and environment skills for both homes           |

Build in tools/workflow with `vp run build`, then run `node dist/install.js`; install after every workflow change without asking. It replaces every top-level entry of `agents/claude` in `~/.claude` and of `agents/codex` in `~/.codex`, and each skill in both `skills/` folders; `CLAUDE_CONFIG_DIR` and `CODEX_HOME` select scratch homes. A fresh session loads the result.

Harness facts, verified 2026-09-22 to 09-26:

- t3 owns worktrees, branches, diff review, and PR linking, and sets the pair's model per thread; it makes no workflow decisions.
- t3 launches Claude with `--setting-sources=user,project,local` and no system-prompt override. A user-level output style reaches the Claude main thread only, and keeps Claude Code's coding instructions only with `keep-coding-instructions: true` in its frontmatter. Roles leave `omitClaudeMd` unset, so they receive the repository AGENTS.md.
- Claude loads project skills only from `.claude/skills`, which symlinks `.agents/skills`.
- Deny rules block pushes to main or master and `gh`/`glab` merges by prefix; a bare `git push` with upstream main is not caught.
- Claude threads reload the pair text when the composer's model or effort changes (`~/.deslop/repos/t3code/apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:767-791`) or after 30 idle minutes (`~/.deslop/repos/t3code/apps/server/src/provider/Layers/ProviderSessionReaper.ts:17`); Codex needs a new thread. Role files are read at each spawn.
- t3code renders images and videos embedded in a message by absolute path (`~/.deslop/repos/t3code/apps/web/src/components/ChatMarkdown.tsx`) and keeps only each `AskUserQuestion` option's label and description, dropping its preview (`apps/server/src/provider/Layers/ClaudeAdapter.ts:4462-4467`).
- gpt-6-astra runs Codex's multi-agent v2, where a spawned agent forks the whole history unless the spawn passes `fork_turns: "none"` (`~/.deslop/repos/codex/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:269-285`).
- In Codex, a finished spawned agent's result is queued and reaches the pair only on the user's next message or a `wait_agent` call (`codex-rs/core/src/agent/control/completion.rs:103`, `trigger_turn` false); Claude is woken by a completion.
- Codex's `request_user_input` exists only in Plan mode by default (`codex-rs/protocol/src/config_types.rs:700`); the under-development `default_mode_request_user_input` feature adds Default mode (`codex-rs/tools/src/tool_config.rs:17-25`) and stays off by decision, since a question it asked earlier never appeared in t3.
- Codex role developer instructions replace the root's. Role files honor developer_instructions, model, reasoning effort and summary, verbosity, personality, service tier, name, description, and nickname_candidates (`codex-rs/agent-roles/src/loader.rs:160`). No config stops a spawned role from spawning, so roles say not to.
- Codex command rules live in `~/.codex/rules/`, which the installer would replace, so none ship.
- Quota is readable per run: Codex rollouts carry `token_count` events whose `rate_limits.primary`/`secondary` hold `used_percent`, and Claude's `stream-json` output emits `rate_limit_event` with five-hour and seven-day utilization (reader: `~/.deslop/measure/real-eval/eval.mjs:112-122`).

## Settled decisions

The user's decisions as of 2026-09-26; reopen one only on contradictory evidence from real PRs:

- Objective: the user plans with the agent, then work runs unattended to a PR merged as is with the fewest prompts. The metric is the merged-as-is rate plus prompts per PR, tracked with `~/.deslop/measure/merge-rate/merge-rate.sh`. Cost is subscription quota per merged PR (Claude Max 20x, Codex 5x), and a stronger model that merges in one pass beats a cheaper one that needs follow-ups.
- Two modes: planning adapts to the user's bursty ideas with heavy parallel delegation, questions, and visuals; execution is tuned for the agents, unattended, with the main thread doing the work.
- Alignment happens through short questions and visuals; the agent calls on the user only when needed and pushes back on weak ideas with evidence.
- Stay close to Claude Code and Codex defaults and to model training: minimal, precise instructions, trimmed instead of added to, no over-architecture, no max reasoning efforts, and only these two harnesses. Prompts follow each vendor's guide for its model: positive rules, good examples first, parallel requests.
- Aggressive exploration, cloning codebases on demand, is the most proven practice.
- Heavy delegation during execution did not reduce context rot or cost, and context and compaction are no longer a concern.
- Environment gaps are fixed at the root, never prompted around; the environment skill owns host facts.
- Code quality is the top priority, automated through lint, the engineering skill while writing, and self-validation; the mergeable-PR bar lives in the pair texts. The engineering skill is the only home of code rules, and it, the design skill, and the shared lint preset never restate or contradict one another: a skill shows the form to write, and lint rejects the mechanical cases with a message naming it.
- Standards that reach the user's colleagues must work with Matt Pocock's skills, which read CODING_STANDARDS.md at review time; the user's workflow is not imposed on them, and dual's lint warnings are intentional incremental adoption.
- Schema.Class stays banned; `.of`, module-level ManagedRuntime, readonly, and expect-vs-assert are open for discussion and stay as the engineering skill has them.
- The workflow changes only when real PRs show a repeated failure, fixed in the codebase first, then in lint, then as a written rule; each change is validated by a small eval on a real replayed task, where the worst run counts and a changed fixture restarts the baseline, plus real-PR tracking.
- A user comment names a kind of problem: fix every instance within the change's scope without widening it; a rule about one repository goes to that repository's project skill, never the shared workflow.
- The default branch is protected; commit, push, and draft PR are automatic.
- Per-harness plain files with no generator, hooks, or scripts, and project skills by symlink; hooks and generators were built and removed three times.
- Memory and goals stay off; goals caused loops.
- Prototypes of one idea that touch the same files go to one implement agent as switchable variants.

## Evidence index

Use these artifacts instead of reconstructing prior investigations:

- Merge rate: ~/.deslop/measure/merge-rate/merge-rate.sh — read-only over deslop (GitHub) and dual (GitLab, needs the VPN) `t3code/` requests; as is means merged with no commit authored after opening and no change-request review; baseline 5 of 16 decided t3code requests merged as is (31%).
- Real eval: ~/.deslop/measure/real-eval/ — deslop#81 replayed from its verbatim prompt against its merged reference and the user's verdicts, graded by check, test, one fresh review, a blind merge judge, and quota; zero-config Claude (`runs/zero-1`) was merge-ready at 3.90M input, 756 s, and +2 five-hour points.
- Quota method: `quotaReadings` in real-eval/eval.mjs takes each run's first and last utilization reading; the delta also counts other sessions on the same subscription in that window.
- Factory eval: ~/.deslop/measure/factory-eval/ — partial synthetic run of tasks t3–t6 (`runs/factory-t3-t6`), the installed #84 workflow against zero-config homes: Claude merge-now 2/3 vs 0/4, Codex 1/2 vs 0/3, the workflow at about 4× the tokens.
- Research of 2026-09-26, summarized because its scratch folder is removed at cleanup:
  - PR acceptance: public agent PRs merge 60–85%, and 55–79% of merged ones need no modification; the controllable drivers, strongest first, are a working environment, a self-contained task, task type, CI green before ready, no duplicate work, small diffs, and arriving finished; tests and description length barely matter.
  - Graphs and loops: out-of-band verification beats same-model self-judgment (self-evaluated cycles claimed improvement every time while 56% had none); goal loops, Ralph, and heavy orchestrators are not recommended; restarting beats patching.
  - Power users: proof end to end before the PR (Boris: verification gives 2–3× quality), one fresh strong-model review, a short design over a long plan, prototypes at the fidelity of the question, and each repeated correction turned into structure; no source publishes a merged-without-iteration rate.
  - Shippers: the most prolific run near-vanilla setups grown only from observed failures, with self-verification and small scoped tasks; zero-oversight factories delivered nothing.
  - Prototyping, Amp, and Factory: evidence-first replies, 2–4 labeled variants answered by label, questions with 2–4 options, a mini-eval gate on prompt edits, and subtraction of lines that change no outcome.
  - poteto's video: promote each correction up the ladder from codebase to lint to rules to skills, so the codebase is the memory; it gives no merge-rate numbers.
- 2026-09-22 thread analysis: ~/.claude/projects/-home-mp281x--t3-worktrees-deslop-t3code-05561f1c/47dde977-6225-46e8-ba87-eb9ca3b79743.jsonl — 17 threads, 240 prompts: 62% steering, 22 overbuilt incidents.
- 2026-09-24 dual refactor thread: ~/.claude/projects/-home-mp281x--t3-worktrees-dual-t3code-40450177/68306ae8-7a2a-4fb7-86ea-e7ba304da294.jsonl — 5.5 h, 52 subagents, about 680M tokens, about 388M of it rework after a too-light first pass; its replay is ~/.deslop/measure/refactor-eval/ (worst-run comparison in after2.md).
- Misplaced-rule threads: ~/.claude/projects/-home-mp281x--t3-worktrees-deslop-t3code-4ce12325/8129d5c9-f22d-4c19-879d-33e0986a2449.jsonl:1213 (repository layout in the shared engineering skill), ~/.claude/projects/-home-mp281x--t3-worktrees-deslop-t3code-7976060b/52fee973-bc07-43b2-bac0-a028cd5f93f5.jsonl:235 (an app-specific eval agent in the global workflow).
- E2E suite: ~/.deslop/measure/review-pack/e2e-baseline.md — t1–t7 reference diffs and verdicts, merge-ready Claude 4/7, Codex 3/7.
- Model and effort A/B: ~/.deslop/measure/{role-ab,codex-effort,codex-effort-hard,simplicity}/ — Opus 5.5 beats Sonnet 5 at every effort in fewer steps; Codex implement at low gave up.

Do not compare elapsed times across changed prompts, harness versions, fixtures, hosts, or isolation. Aggregate input includes cached tokens and is not unique context size.

## Package facts

- effect-tsgo's oxlint runner ignores the effect-fn setting through tsconfig `extends`; it works only in a tsconfig without extends, and the user chose no upstream report.
- Published TypeScript is built because Node 26 refuses type stripping under node_modules.
- Consumers restate the ignorePatterns and rule options they want; Oxlint merges overrides across extends but replaces those fields. A jsPlugins specifier resolves from the linted root. Formatter configuration is duplicated per root because oxfmt has no extends.
- Releases publish @deslop/workflow from main as 0.1.<run number>. The external consumer probe is ~/.deslop/harness-probe/turbo-probe.
