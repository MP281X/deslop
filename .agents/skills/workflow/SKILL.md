---
name: workflow
description: 'Durable memory of the agent workflow in tools/workflow: decisions with reasons, harness facts, sources, and history. Use when reading, changing, or measuring the pair texts, roles, skills, harness configuration, or installer.'
---

# Workflow handoff

Every thread that changes the workflow records here, before it finishes, each decision with the user's reason, every source it analyzed by clone path, and one History line. Use this file instead of asking the user again or reanalyzing old threads.

## Current state

- 2026-09-26, branch `t3code/analyze-claude-workflow-tokens`: the pair texts are rewritten for the two modes below, with the main thread doing the execution work. The branch's workflow is installed at delivery, after the repository check and draft PR.
- The branch also drops Codex's `personality = "none"` so its default personality applies (`~/.deslop/repos/codex/codex-rs/models-manager/src/model_info.rs:50`), drops the ScheduleWakeup, ListAgents, and TaskStop denies, puts every Codex role on gpt-6-astra, and raises Codex's multi-agent v2 wait default to its maximum, since a wait returns as soon as an agent finishes.
- Unvalidated: no real PR has used the new texts yet. Next: real-PR tracking with merge-rate.sh against the 31% baseline.

## Source and delivery

Each harness has its own plain text tuned to its model, Opus 5.5 in Claude Code and GPT-6 Astra in Codex: similar developer experience, different prompts, so edit each for its model instead of mirroring wording. Both harnesses register the same roles: `explore`, `prototype`, `browser`, `review`.

| Source in tools/workflow/src/agents | Purpose                                                              |
| ----------------------------------- | -------------------------------------------------------------------- |
| codex/config.toml                   | Codex pair text, features, role registrations, tool limit, shell env |
| codex/AGENTS.md                     | authorizes spawning the roles                                        |
| codex/agents/\*.toml                | Codex role bodies, models, efforts                                   |
| claude/output-styles/pair.md        | Claude pair text as output style `pair`                              |
| claude/settings.json                | Claude settings and deny rules                                       |
| claude/agents/\*.md                 | Claude role bodies, models, efforts, preloaded skills                |
| skills/\*/SKILL.md                  | engineering, design, and environment skills for both homes           |

Install with `node tools/workflow/src/install.ts` after every workflow change, without asking. It replaces every top-level entry of `agents/claude` in `~/.claude` and of `agents/codex` in `~/.codex`, and each skill in both `skills/` folders; `CLAUDE_CONFIG_DIR` and `CODEX_HOME` select scratch homes. A fresh session loads the result.

Harness facts, verified 2026-09-22 to 09-26:

- t3 owns worktrees, branches, diff review, and PR linking, and sets the pair's model per thread; it makes no workflow decisions. Claude denies t3's preview and device tools by setting, and t3 refuses them in Codex, so rendered proof uses agent-browser.
- t3 launches Claude with `--setting-sources=user,project,local` and no system-prompt override. A user-level output style reaches the Claude main thread only, and keeps Claude Code's coding instructions only with `keep-coding-instructions: true` in its frontmatter. Roles leave `omitClaudeMd` unset, so they receive the repository AGENTS.md.
- Claude loads project skills only from `.claude/skills`, which symlinks `.agents/skills`.
- Deny rules block pushes to main or master and `gh`/`glab` merges by prefix; a bare `git push` with upstream main is not caught.
- Claude threads reload the pair text when the composer's model or effort changes (`~/.deslop/repos/t3code/apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:767-791`) or after 30 idle minutes (`~/.deslop/repos/t3code/apps/server/src/provider/Layers/ProviderSessionReaper.ts:17`); Codex needs a new thread. Role files are read at each spawn.
- t3code renders images and videos embedded in a message by absolute path (`~/.deslop/repos/t3code/apps/web/src/components/ChatMarkdown.tsx`) and keeps only each `AskUserQuestion` option's label and description, dropping its preview (`apps/server/src/provider/Layers/ClaudeAdapter.ts:4462-4467`).
- gpt-6-astra runs Codex's multi-agent v2, where a spawned agent forks the whole history unless the spawn passes `fork_turns: "none"` (`~/.deslop/repos/codex/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:269-285`).
- In Codex, a finished spawned agent's result is queued and reaches the pair only on the user's next message or a `wait_agent` call (`codex-rs/core/src/agent/control/completion.rs:103`, `trigger_turn` false); Claude is woken by a completion.
- Codex's `request_user_input` exists only in Plan mode by default (`codex-rs/protocol/src/config_types.rs:700`); the under-development `default_mode_request_user_input` feature adds Default mode (`codex-rs/tools/src/tool_config.rs:17-25`) and stays off by decision, since a question it asked earlier never appeared in t3.
- Codex role developer instructions replace the root's. Role files honor developer_instructions, model, reasoning effort and summary, verbosity, personality, service tier, name, description, and nickname_candidates (`codex-rs/agent-roles/src/loader.rs:160`). In Codex no config stops a spawned role from spawning, so roles say not to; Claude sets `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` in its settings (`~/.deslop/repos/claude-code/CHANGELOG.md:2424`).
- Codex sets PAGER, GIT_PAGER, GH_PAGER, and NO_COLOR itself (`codex-rs/core/src/unified_exec/process_manager.rs:92-103`); Claude's Bash has no TTY, so pager variables are unnecessary there.
- `memories` and `recommended_plugins` are off by default in Codex (`codex-rs/features/src/lib.rs:1151,1443`).
- Codex command rules live in `~/.codex/rules/`, which the installer would replace, so none ship.
- Quota is readable per run: Codex rollouts carry `token_count` events whose `rate_limits.primary`/`secondary` hold `used_percent`, and Claude's `stream-json` output emits `rate_limit_event` with five-hour and seven-day utilization.

## Decisions and reasoning

The user's decisions as of 2026-09-26, each with its reason; reopen one only on contradictory evidence from real PRs.

- Objective: plan with the agent, then work unattended to a PR merged as is with the fewest prompts, measured as the merged-as-is rate plus prompts per PR with merge-rate.sh — "I plan and then the agent do its things until the pr is ready, I don't care how"; what matters is how likely a PR merges "right away rather than needing to do tons of additional iterations".
- Cost is subscription quota per merged PR (Claude Max 20x, Codex 5x); a stronger model that merges in one pass beats a cheaper one that needs follow-ups — "i perfer using astra on high rather than luna low if astra can merge in a single pass"; quota decides how much the user can parallelize.
- Opus 5.5 in Claude Code and GPT-6 Astra in Codex, each with its own text — "The objective is having similar dx witch doesn't mean equal prompts"; the models and harnesses had been treated as equal "even though they aren't".
- Two modes: planning adapts to bursty ideas with parallel agents, questions, and visuals; execution is tuned for the agents, unattended, with the main thread doing the work — planning "is probably the only part where it's important to adapt to how i think"; the rest "need to be optimized for the agents since i'm not involved".
- The user is out of the loop after planning; the agent reaches them only for what is theirs — reading output live made the user "waste time and get frustrated over thing that the agent then self correct"; "staying inside the loop is the most frustrating part".
- Design against the user's habits, not around them — t3 hiding context usage and subagent activity "made me trust the agent capabilities more".
- Replies go through the question tool or are the finished result, with no introductions, recaps, or closing summaries — "now I want to use the question tool as mutch as possible and read few/none of your output"; walls of text made the user "give up and pick the recommended option". Codex enables `default_mode_request_user_input` for the same reason. No progress lines: "This shouldn't be necessary anymore based on how the new workflow is structured".
- Alignment through short questions, 2–4 labeled variants, and screenshots and videos embedded by path — "I just want to read enough to understand if we are aligned"; t3 renders media inline, "one of the thing that we are underutilizing".
- Image and video proof is mandatory and captured with agent-browser; t3's preview and device tools are denied — "the videos and images proofs are mandatory"; t3 runs on a headless box that refuses those tools.
- Ideas and decisions stay in the conversation, never in ticket or spec files — "I don't want to need to write tickets/specs to files like the Matt skills".
- The agent pushes back on weak ideas with evidence — "instead of assecondating me".
- Stay close to harness defaults and model training: minimal, precise instructions, trimmed instead of added to, no over-architecture, no max efforts — trimming the workflow, tools, configs, and skill is what worked, "the important thing is not diverging from how the agents are trained on"; max efforts overthink and overspend.
- Lean texts modeled on Amp and Droid, following each vendor's guide for its model: positive rules, good examples first, parallel requests — "take a more lean and minimal approach and take inspiration from amp and droid", Amp especially.
- Config over prompt: what a setting can disable is disabled instead of described, and only by a plain config change — "why don't you just disable those tools?"; "this is mostly for things that can just be fixed with a simple config change".
- Per-harness plain files with no generator, hooks, or scripts; project skills by symlink — hooks and generators were built and removed three times, and the ask gate denied 5 of 5 questions.
- Only Claude Code and Codex — "I want the models to work in the harness they are designed and trained in"; leaving OpenCode and Pi helped.
- Aggressive exploration, cloning libraries on demand; the pair and explore texts name the clones, the environment skill has no clone section — "probably the most important thing"; the skill step "seems just an additional useless step".
- No heavy delegation in execution; context and compaction are no concern — delegation for context rot and cost "didn't work out as expected".
- Environment gaps are fixed at the root, never prompted around, and the environment skill owns host facts — a VM upgrade ended the memory issues that prompted flags did not, and installing python beat prompting against it.
- `TURBO_CACHE_DIR` is set in both harnesses; pager and color variables only where the harness does not set them — "Why only Claude should get the turbo cache dir?"; the shared cache cut type-checking from 238 s cold to 14 s.
- Code quality is the top priority: the engineering skill is complete so the first pass is right, lint is the fallback with autofixes, then self-validation; the engineering skill is the only home of cross-repository code rules — "im not looking for code that it's just good enough"; guidelines must reach the writer "so the agent can write good code directly without needing to loop for hours".
- Lint rules are validated on real deslop and dual code before they ship, and root causes are fixed in code first — "look in both the dual and deslop codebases to see if the rules would be actually valid"; "prefer finding and solving the root cause".
- The single-use literal constant rule covers every case; `export * as` stays allowed — the user answered "Everything", and dual's CODING_STANDARDS.md requires `export * as`.
- Type inference first: annotations, casts, and type arguments only where inference cannot produce the type — the user corrected inferable annotations repeatedly and asked for them to be banned.
- Matt Pocock's documents (CONTEXT.md, docs/adr/, CODING_STANDARDS.md, docs/agents/\*.md) replace special conventions; project-engineering became CODING_STANDARDS.md, and the global engineering skill keeps the cross-repository rules — colleagues use Matt's skills and the user's workflow must not be imposed on them; "take the best of both worlds".
- dual's lint warnings are intentional incremental adoption — "the rules are weakened on purpose since the repo is big".
- Schema.Class stays banned, a service's `.of` is allowed, and module-level `ManagedRuntime.make` is banned (rule J). Service-shape properties are readonly and readonly is banned elsewhere — "force the readonly in the service keys and ban it everywhere else. In general I want to align myself more on the idiomatic and documented effect usage and patterns". Tests use `assert` from @effect/vitest, with `expect` imports rejected by lint — "Switch to assert".
- Idiomatic, documented Effect usage wins over house conventions when they conflict, read from `~/.deslop/repos/effect`.
- The workflow changes only for a repeated real-PR failure, fixed in the codebase, then lint, then a written rule, and is measured on real PRs; synthetic evals and the AI judge are retired — "based on what you are saying if something is mergiable or not?"; the judge agreed only by matching the merged diff, the evals "where too mutch", and the user chose "Real PRs only".
- A user comment names a kind of problem: fix every instance in scope without widening; a one-repository rule goes to that repository's CODING_STANDARDS.md — per-spot fixes drew repeated corrections, and repository rules leaked into the shared workflow (misplaced-rule threads below).
- The default branch is protected; commit, push, and draft PR are automatic — nothing stands between the agreed plan and a ready PR. The PR stays a draft, and every commit updates its title and body from the whole PR — "each time you commit you need to update both the pr body and title based on the full pr changes". The pipeline is watched and must be green.
- Before every push the default branch is merged in and the checks rerun; a problem the agent cannot solve or does not know how to solve goes to the user instead of a workaround — "if you can't solve the problem or don't know how don't find workaround and ask the user".
- Steering keeps what the user did not reject, a side question returns to the interrupted task, and a comment names a kind of problem fixed everywhere in the change — each was repeated across old threads.
- Memory and goals stay off, and plan mode is denied — goals looped (in Codex, 1.4% of goal sessions used 49% of input tokens); "I hate the harness plan mode".
- Roles are explore, prototype, browser, and review — "do you really think that implementation is the right name for an agent that just do prototyping?"
- Prototypes of one idea that touch the same files go to one prototype agent as switchable variants — parallel agents on the same files overwrite each other.
- Codex keeps its default personality — `personality = "none"` stripped its built-in base instructions, concision included.
- The main Effect repository is `~/.deslop/repos/effect` — "We need to point at the main effect repo and not at effect small".
- dual is read-only for workflow work — it is the team's repository.
- This file is the workflow's durable memory and improves each thread — "each time I work on the workflow I feel like I need to repeat the same thing".
- Background by default: agents for research and exploration, long commands detached, so the thread stays open — "doing things in the background is better since it leave the main thread open for doing other stuffs, parallelizing" (not a return to delegating everything).
- Each phase borrows from the matching proven skill, adapted to run autonomously with no persisted artifacts — "use those as inspiration and improve the existing parts … the planning can take inspiration from wayfinder and grill me, the prototyping from the relative skill, the review from the relative skill": planning charts destination, MVP with a cut list, decided, open, and fog, and asks one decision per question round by round; prototypes stub everything the question does not test and run no checks; review validates each candidate before it counts; debugging reproduces first; nothing is called done without a fresh run.
- The MVP objective and cut list open every plan — "reducing the scope and defining the mvp objective so we don't overbuild … This is extremely important".
- Lint runs once per finished unit of work over all its files, never per edit: each call costs a flat 5–6 s for 1 file or a whole package, with no cache between calls (measured in deslop) — "especially in dual the linting can take a while".
- Standalone `pipe` only ("Keep standalone only") and `return yield* E.make(...)` ("Keep E.make") stay house rules over Effect's docs; readonly is allowed on class members such as `static readonly layer` ("Allow on class members").
- The engineering skill stays one file, trimmed and made consistent with lint through a quick A/B test — "I don't want to split it since I seem to get better results like this".

## Sources

Clones under `~/.deslop/repos` analyzed in the 2026-09-26 thread, with what the user took or rejected:

- `system-prompts`, `ai-amp-cli` — Amp's extracted prompts: the model for the lean texts, taking a short always-loaded prompt, proof first, labeled variants, and parallel search.
- `factory-ai-factory`, `droid-action`, `factory-factory-plugins`, `factory-skills` — Factory's docs, review action, and plugins: goals and constraints only in the base text, 2–4-option questions, and demo proof; its two-pass review was not taken, one fresh review stays.
- `factory-droid-code-review`, `factory-droid-missions-prompt`, `factory-droid-prompt-pliny` — Droid prompts, the last two leaked and possibly stale: density and phrasing for the lean texts; the Missions acceptance-ID contract was not taken.
- `skills` (also `mattpocock-skills`) — Matt Pocock's skills: CONTEXT.md, docs/adr/ in their CONTEXT-FORMAT and ADR-FORMAT, and CODING_STANDARDS.md read at review; ticket and spec files rejected.
- `sandcastle` — Matt's unattended runner: its short CODING_STANDARDS.md template loaded at review; its loop was not taken.
- `superpowers` — obra: positive templates over "don't" rules, which scored worse than no rule, and each decision reported with its cost if wrong.
- `advanced-context-engineering-for-coding-agents`, `12-factor-agents`, `humanlayer` — HumanLayer: a short design over a long plan, questions grounded in found patterns; per-phase manual pauses rejected.
- `compound-engineering-plugin` — Every: prototypes at the fidelity of the question; one question per turn rejected for one batch.
- `agent-rules`, `agent-scripts` — steipete: near-vanilla setup and screenshot-driven prompts; his narrative-prose replies rejected.
- `get-shit-done` — GSD: evidence-backed assumptions for the user to correct instead of an interview; its spec pipeline rejected.
- `cursor-plugins`, `pstack-claude` — poteto's pstack: sketch instead of asking, the PR body as a briefing, and the codebase-to-lint-to-rules correction ladder.
- `how-to-ralph-wiggum` — the Ralph playbook: rejected, since loops drift in existing codebases.
- `agent-stuff` — Armin Ronacher: PR-sized chunks; his finding that hooks gave no gains matches no hooks.
- `awesome-cursorrules` — community rules: surveyed, nothing taken.
- `symphony` — OpenAI's orchestrator: proof of work before review and rework as a fresh restart taken; the orchestrator rejected.
- `claude-code`, `claude-plugins-official` — Anthropic: harness facts such as the spawn-depth setting, and review that reports only in-scope findings.
- `codex` — Codex source: the Codex harness facts above.
- `t3code` — t3's source: media rendering, question previews, reload triggers, and the agents panel.
- `effect` — the main Effect repository: LLMS.md and ai-docs as the idiom reference, whose `Service.of` lifted the ban; `effect-smol` rejected as the reference.
- `effect-tsgo` (also `tsgo`), `tsgolint`, `oxc` — type-aware lint: oxlint JS plugins get no type information (`oxc/apps/oxlint/src-js/plugins/source_code.ts:234`), so the annotation rules are syntactic; forking a Go linter was judged heavy upkeep.
- `pi` — the earlier harness, left for Claude Code and Codex.
- `agent-browser` — screenshot and video proof.
- Not clones: Theo Browne (t3code; judge proof, not lines; "almost zero skills installed"), Dax Raad, poteto's talk (2,000 PRs a month; the correction ladder of codebase, then lint, then rules), Boris Cherny and the Claude Code team (vanilla setup, end-to-end proof), and the OpenAI and Anthropic prompting guides (lean prompts; the prompt's style carries into replies).

## History

- To 09-20 (06f743a–0e3296c): agents moved from OpenCode and Pi to Claude Code and Codex with native agents, since the models work best in their own harnesses.
- 09-21 (8672013): one pair text for both harnesses replaced the orchestrator; a PreToolUse ask gate and a rendering generator came and went for plain per-harness files; the engineering skill became bad/good blocks tuned over seven eval batches.
- 09-22 to 09-25 (5255775, 16057fd, 19a1945): the pair grew into a heavy-delegation coordinator of briefs, slices, fix rounds, and progress watches, with 57 settled rules (D1–D57) and a 3,624-word Claude pair text.
- Its costs: the dual refactor spent about 680M tokens, 388M of it rework; the dual executor thread about 790M, about 200M rework, with 10 of 16 prompts corrective; 62% of prompts were steering; 5 of 16 PRs merged as is, 0 of 3 after the 09-25 install. The misses broke rules that already existed.
- Evals: synthetic prompt evals, judged replays, and refactor, factory, and real-task evals; calibrated on 14 of the user's PRs, the AI judge agreed with as-is merges only by matching the reference and rejected all 5 without it, so it was retired for the real-PR merge rate.
- What the user found: the workflow had become the project ("I shipped more pr and wasted more tokens and time on this workflow than on actual prs"); agents without the workflow felt better ("I actually really enjoyed it"); after planning the user wants out of the loop.
- 09-26 research: Amp, Droid, power users, shippers, graphs and loops, and PR acceptance converged on lean prompts grown from observed failures, proof first, and tooling-enforced quality.
- The first redesign edited the old workflow through its own process and kept its concepts ("too timid"); b5492f7 rebuilt from the defaults as per-harness lean texts modeled on Amp and Droid, the Claude pair falling to about 540 words.
- Config over prompt: plan mode, t3's preview and device tools, and nested spawns are blocked in settings instead of described.
- Matt Pocock alignment: project-engineering became CODING_STANDARDS.md, the texts read CONTEXT.md and docs/adr/, implement became prototype, and the `.of` ban went.
- Lint-first quality: 15 rule candidates mined from threads were validated on deslop and dual (8 kept, 5 dropped, 2 decided by the user), and deslop's root causes were fixed in code.
- This file became the workflow's memory: sources, decisions with reasons, and history.
- 09-26 (after 7938991): mining ~930 old user messages for repeated asks added draft-PR title and body upkeep, align before push, a green pipeline, question-tool-first replies, and no-workaround escalation to both pair texts, plus VPN, sudo, ufw, and install facts to the environment skill.
- 09-27: retired eval folders deleted except merge-rate, `/etc/resolv.conf` pointed at systemd-resolved's stub (glab 8/8), service-shape readonly enforced in no-readonly-type-syntax, and tests moved to `assert`.
- 09-27: every custom rule was checked against oxlint's built-ins, tsgolint, effect-tsgo's 116 diagnostics, tsconfig, and fallow; none can be replaced without missed cases or new false positives, so all 22 stay, and no-fail-in-generator now skips `yield* Effect.fail(new E())`, which effecttsgo/unnecessary-fail-yieldable-error already reports.
- 09-27: `typescript/array-type` replaced by a no-restricted-types `Array` entry, since its `ReadonlyArray` fix produced banned `readonly T[]`; no-constant-function now leaves single-use functions to no-trivial-indirection, so the two never give opposite advice.
- 09-27: planning, prototyping, review, and debugging rewritten from Matt Pocock's wayfinder, grilling, prototype, diagnosing-bugs, and code-review skills plus superpowers and Factory review; new rules no-switch-statement, no-option-value-access, and no-double-nullish-check; lint batched per unit of work after timing it; dual's lint found not runnable because `@deslop/workflow` is not installed there.
- 09-27: a blind A/B of the engineering skill (current vs a one-rule-per-line rewrite vs a grouped-table rewrite, 3 deslop tasks, one run each, all 0 lint diagnostics) scored 24, 21, and 17 of 30, so the skill kept its structure and gained only the new decisions, the Match, Option, Predicate, fn/fnUntraced, Result, Context.Reference, and Order idioms, and the `yield*` typo fix; the grouped rewrite rebuilt Effect's RateLimiter instead of pushing back.

## Evidence index

Use these artifacts instead of reconstructing prior investigations:

- Merge rate: ~/.deslop/measure/merge-rate/merge-rate.sh — read-only over deslop (GitHub) and dual (GitLab, needs the VPN) `t3code/` requests; as is means merged with no commit authored after opening and no change-request review; baseline 5 of 16 decided t3code requests merged as is (31%).
- AI judge calibration (folder deleted 09-27) — 14 of the user's PRs and MRs; with the merged reference withheld the judge rejected all 5 as-is merges, and a prompt edit flipped one follow-up case to a wrong yes.
- Research of 2026-09-26, summarized because its notes were deleted; Sources lists the clones it read:
  - PR acceptance: public agent PRs merge 60–85%, and 55–79% of merged ones need no modification; the controllable drivers, strongest first, are a working environment, a self-contained task, task type, CI green before ready, no duplicate work, small diffs, and arriving finished; tests and description length barely matter.
  - Graphs and loops: out-of-band verification beats same-model self-judgment (self-evaluated cycles claimed improvement every time while 56% had none); goal loops, Ralph, and heavy orchestrators are not recommended; restarting beats patching.
  - Power users: proof end to end before the PR (Boris: verification gives 2–3× quality), one fresh strong-model review, a short design over a long plan, prototypes at the fidelity of the question, and each repeated correction turned into structure; no source publishes a merged-without-iteration rate.
  - Shippers: the most prolific run near-vanilla setups grown only from observed failures, with self-verification and small scoped tasks; zero-oversight factories delivered nothing.
  - Prototyping, Amp, and Factory: evidence-first replies, 2–4 labeled variants answered by label, questions with 2–4 options, and subtraction of lines that change no outcome.
  - poteto's video: promote each correction up the ladder from codebase to lint to rules to skills, so the codebase is the memory; it gives no merge-rate numbers.
- 2026-09-22 thread analysis: ~/.claude/projects/-home-mp281x--t3-worktrees-deslop-t3code-05561f1c/47dde977-6225-46e8-ba87-eb9ca3b79743.jsonl — 17 threads, 240 prompts: 62% steering, 22 overbuilt incidents.
- 2026-09-24 dual refactor thread: ~/.claude/projects/-home-mp281x--t3-worktrees-dual-t3code-40450177/68306ae8-7a2a-4fb7-86ea-e7ba304da294.jsonl — 5.5 h, 52 subagents, about 680M tokens, about 388M of it rework after a too-light first pass.
- Misplaced-rule threads: ~/.claude/projects/-home-mp281x--t3-worktrees-deslop-t3code-4ce12325/8129d5c9-f22d-4c19-879d-33e0986a2449.jsonl:1213 (repository layout in the shared engineering skill), ~/.claude/projects/-home-mp281x--t3-worktrees-deslop-t3code-7976060b/52fee973-bc07-43b2-bac0-a028cd5f93f5.jsonl:235 (an app-specific eval agent in the global workflow).

## Package facts

- effect-tsgo's oxlint runner ignores the effect-fn setting through tsconfig `extends`; it works only in a tsconfig without extends, and the user chose no upstream report.
- Published TypeScript is built because Node 26 refuses type stripping under node_modules.
- Consumers restate the ignorePatterns and rule options they want; Oxlint merges overrides across extends but replaces those fields. A jsPlugins specifier resolves from the linted root. Formatter configuration is duplicated per root because oxfmt has no extends.
- Releases publish @deslop/workflow from main as 0.1.<run number>. The external consumer probe is ~/.deslop/harness-probe/turbo-probe.
