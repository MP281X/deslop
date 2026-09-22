---
name: workflow
description: 'Use when changing the reusable agent workflow: the pair-thread text, roles, Codex and Claude Code configuration, or installer. This is the durable handoff; do not reanalyze old threads for facts recorded here.'
---

# Workflow handoff

## Current state

The workflow is one system: authored instructions, installed assets, host lifecycle, role execution, and evaluation must agree. The user talks to one pair thread that owns the requested outcome through synthesis. It handles small coherent work directly and delegates substantial independent deliverables to bounded roles.

| Layer             | State on 2026-09-22                                                                                                                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source            | Short pair contract is present in both harnesses. It includes bounded demonstrations, selective engineering context, disjoint parallel ownership, batched independent operations, evidence reuse, native completion handling, and natural output.                |
| Roles             | explore returns bounded located facts; implement owns one approved slice and scoped proof; browser observes rendered criteria; git performs only requested git delivery.                                                                                         |
| Latest correction | A prototype stops at the first discriminating observation. Failure produces limitations and the next decision, never a custom scanner or rescue implementation. Factual review distinguishes observed behavior, possible failure, and unverified runtime claims. |
| Installed state   | Installed to both real harness homes on 2026-09-22 after user authorization; all 14 managed files matched source. Evidence: ~/.deslop/measure/workflow-rollout/installed.json. Start a fresh session; this thread retains its previously injected instructions.  |
| Host proof        | CLI completion works. t3 automatic parent resumption and completion visibility remain unverified because t3 source is absent from this worktree.                                                                                                                 |
| Confidence        | The candidate improved several single runs but is not a demonstrated general speedup. Claude's prototype regression motivated the latest stopping rule.                                                                                                          |

### Next thread

Do not start by finding or rereading historical Codex or Claude threads. The established failures, decisions, and evidence locations are below. Start from the installed candidate in a fresh session, use a real small task, and correct only behavior that is observed again.

The next useful evidence is:

1. A t3 task with two independent bounded owners completes and the pair synthesizes without a user status prompt.
2. A wide-change request runs one representative demonstration, stops on the first deciding result, and does not build fallback infrastructure.
3. A factual source review avoids engineering guidance, adjacent scratch homes, speculative guards, and claims that prompt text proves runtime behavior.

## User outcome and working style

- Make the smallest useful thing concrete early so he can react before expensive implementation.
- For consequential work, define included scope, excluded scope, and an observable stopping point. Exclusions matter because speculative cleanup and overengineering create later removal work.
- Resolve discoverable facts before asking. Ask only user-owned choices at the current dependency frontier; batch independent choices and recommend one with its material cost.
- Prefer a representative runnable demonstration for risky, wide, or expensive work. Do not force prototypes onto routine clear changes.
- State each fact once in concise natural language. Use code, a tree, or a table only when it clarifies the result.
- No square markers, empty checkboxes, mandatory phase labels, diff narration, or process assurances.
- Evaluate useful outcomes: correctness, completion, user interventions, redundant acquisition or validation, scope expansion, latency, and exposed usage.

## Execution contract

The pair follows one decision loop:

1. Recover the requested outcome and hard bounds from the conversation.
2. For consequential work, make included scope, excluded scope, and stopping point explicit.
3. Obtain only missing evidence and choose the smallest next action.
4. Keep small coherent work inline. Give substantial independent deliverables disjoint owners and launch independent work together.
5. Batch known independent reads or calls; keep dependent discovery sequential. Reuse paths, agents, results, and valid proof.
6. Before wide or expensive implementation, run one bounded representative demonstration. Stop after the first observation that decides feasibility. A failed mechanism yields limitations and the next user-owned decision, not a custom scanner, rescue implementation, wider suite, or migration.
7. Choose the smallest proof that detects the requested behavior. Reuse it until a relevant input changes.
8. Consume native completion notifications or blocking waits and resume synthesis without another user prompt. Never poll, spawn a waiting agent, or end while owned work remains pending.
9. Separate observed facts from hypotheses, possible failures, and unverified runtime claims. Recommend only corrections connected by evidence to the requested outcome.
10. Report the useful result, decisive evidence, and material limitation naturally.

Use the engineering skill only for implementation or convention review, and only the relevant sections. Factual source tracing reads its sources directly. Implement still applies relevant engineering guidance to product-code edits.

## Ownership

| Owner     | Owns                                                                                                      | Never                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Pair      | outcome, decisions, synthesis, direct small work, integration proof, tree-mutating commands, coordination | silently transfer completion; spawn browser directly                          |
| Explore   | one bounded evidence source; facts with locators; observation separated from inference                    | edit, recommend, measure, overlap another source, expand into adjacent review |
| Implement | one approved slice, scoped proof, and browser when rendering changes                                      | git, scope decisions, another implementation agent                            |
| Browser   | rendered criteria and observed defects or pass                                                            | implementation or broader review                                              |
| Git       | requested commit, push, and draft request using supplied evidence plus mandatory hooks                    | branches, merges, duplicate validation, speculative retry                     |
| t3        | worktrees, branches, diff review, PR linking                                                              | workflow decisions                                                            |

## Source and delivery

The pair and each role are intentionally duplicated once per harness; edit mirrored bodies identically. There is no renderer.

| Source                                                | Installed destination / purpose                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| tools/workflow/src/agents/codex/config.toml           | ~/.codex/config.toml; Codex pair text and role registrations                 |
| tools/workflow/src/agents/codex/AGENTS.md             | ~/.codex/AGENTS.md; authorizes configured roles                              |
| tools/workflow/src/agents/codex/agents/*.toml         | Codex role bodies and models                                                 |
| tools/workflow/src/agents/claude/CLAUDE.md            | ~/.claude/CLAUDE.md; Claude pair text                                        |
| tools/workflow/src/agents/claude/settings.json        | stripped Claude settings and denied built-ins                                |
| tools/workflow/src/agents/claude/agents/*.md          | Claude role bodies, models, and tools                                        |
| tools/workflow/src/agents/skills/engineering/SKILL.md | shared product-code conventions copied to both homes                         |
| tools/workflow/src/install.ts                         | removes and copies managed assets while preserving unrelated personal skills |

Build in tools/workflow with vp run build, then run node dist/install.js. CODEX_HOME and CLAUDE_CONFIG_DIR select scratch destinations. A fresh session is required after live installation. Source parity and CLI behavior do not prove installed delivery or t3 host behavior.

Relevant harness facts:

- Codex root receives config.toml developer instructions; a role's developer instructions replace them. The one-line global AGENTS.md is required for role authorization. Native waits and follow-up were observed in CLI.
- Claude main receives global CLAUDE.md; roles use omitClaudeMd: true. Agent follow-up uses SendMessage, so it must remain available. Completion notifications were observed in CLI.
- t3 injects additional mode/runtime text and selects permissions. This repository cannot verify t3 resumption.
- The installed pair previously said to end after launching agents. Source now requires consuming completion and synthesizing. This thread retained the stale injected prompt, and repeated user status nudges were the observed failure.

## Settled decisions

Do not reopen these without contradictory current evidence:

| Decision                                                       | Why                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| One pair thread, no orchestrator role                          | The tool-less primary produced 2,134 waits and 1,733 relays in four days.       |
| Pair owns completion after delegation                          | Users repeatedly had to ask whether finished agents were noticed.               |
| Delegate by independent evidence or specialist boundary        | Thematic overlap duplicated context and work.                                   |
| Launch independent owners and batch known independent calls    | Serial acquisition was a repeated latency and token cost.                       |
| One validation plan, reused until invalidated                  | Full checks and commit hooks were repeated or overlapped.                       |
| Prototype only risky, wide, or expensive uncertainty           | Blanket prototyping adds ceremony; delayed feedback on large work is costly.    |
| Stop a prototype on its first deciding observation             | Claude expanded a failed cheap mechanism into a scanner and timed out.          |
| Facts, possible failures, and runtime claims are distinct      | Reviews conflated prompt intent, hook behavior, and runtime guarantees.         |
| Engineering loads by purpose                                   | Codex loaded the full skill during factual review and repeated discovery.       |
| Plain natural results                                          | The user rejected square markers and content-free completion templates.         |
| Questions follow dependencies                                  | Discoverable facts are not user decisions; independent choices can be batched.  |
| Prompt rules are decision procedures, not accumulated warnings | More corrective prose did not reliably improve behavior.                        |
| No static hooks for judgement calls                            | Strong leading instructions are preferred; hooks enforce only static facts.     |
| Mirrored source files, no generator                            | Two small copied bodies are simpler than a rendering pipeline.                  |
| Change shaping and diagnosis are foundations                   | Separate always-applicable skills added triggering and installation complexity. |

Rejected or not established:

- More agents, shorter prompts, and lower latency are not quality by themselves.
- The twelve-run comparison is one sample per condition, not robust speed proof.
- CLI completion does not establish t3 parent resumption.
- The historical prototype-scope exploration did not obtain original transcripts; it annotated fixtures and user quotes only.
- A source review's proposed collision guards were rejected because managed-file replacement was intended behavior.
- Mandatory interviews, fixed phases, exhaustive planning artifacts, auto-continuation loops, and full-framework adoption were rejected as added friction.

## Evidence index

Use these artifacts instead of reconstructing prior investigations:

| Evidence                  | Location                                                     | Decisive result                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Short-contract comparison | /home/mp281x/.deslop/measure/short-contract-eval/            | Identical manifests, 12 runs. Codex review deadline to 51.351s, prototype 76.346 to 57.562s, implementation 40.191 to 27.189s. Claude review 79.654 to 55.027s, prototype 76.388 to 91.052s deadline with scanner and no final, implementation 17.074 to 15.352s. All implementation external tests green with one source edit. |
| Source-review runs        | /home/mp281x/.deslop/measure/workflow-cli-review/            | Codex grounded but loaded full engineering and repeated discovery. Claude serialized calls, conflated hooks, and expanded into speculative configuration. Scratch-home adjacency limits installed-state conclusions.                                                                                                            |
| Prototype demonstration   | /home/mp281x/.deslop/measure/prototype-first-demo/           | Initial Codex asked permission; initial Claude built a scanner and timed out. Later Codex ran a bounded probe; later Claude stopped expanding, but overexplained and invented estimates.                                                                                                                                        |
| Prompt procedure eval     | /home/mp281x/.deslop/measure/prompt-procedure-eval/          | Narrow bug fixes succeeded but were slower after; design requests still invented scale and overdesigned. Installer scratch smoke preserved personal skills.                                                                                                                                                                     |
| Coordination eval         | /home/mp281x/.deslop/measure/workflow-quick-eval/            | Codex native waits and follow-up worked. Claude needed SendMessage; one run spawned an unnecessary waiting agent.                                                                                                                                                                                                               |
| Manual regression cases   | [recurring corrections](references/recurring-corrections.md) | Completion, evidence reuse, batching, design bounds, prototype stopping, and factual-review boundaries.                                                                                                                                                                                                                         |

Do not compare elapsed times across changed prompts, harness versions, fixtures, hosts, or isolation. Aggregate input includes cached tokens and is not unique context size.

## Prompt changes and evaluation

Start with an observed failure, identify the missing decision, encode the smallest decision procedure and rationale, define observable completion, then run only affected cases from [recurring corrections](references/recurring-corrections.md). Add a prohibition only when the procedure leaves a demonstrated ambiguity. Do not treat source text as behavioral proof.

Primary prompt references are Matt Pocock's diagnosing and grilling procedures for discriminating evidence and decision dependencies, Cursor's selective-context guidance, Anthropic's baseline/with-skill evaluation pattern, Trail of Bits' behavioral decision criteria, and Mitsuhiko's concise prerequisite-ordered discussion. They are influences, not packages to install wholesale.

## Package and engineering facts retained

- tools/workflow/src/agents/skills/engineering/SKILL.md is one file of executable good and bad product-code conventions. project-engineering holds repository-specific layout and service rules.
- The workflow package owns its agent assets, installer, shared Oxlint config, ten repository rules, and exported TypeScript config.
- Published TypeScript is built because Node 26 refuses type stripping under node_modules.
- Consumers restate the ignorePatterns and rule options they want; Oxlint merges overrides across extends but replaces those fields.
- A jsPlugins specifier resolves from the linted root. Formatter configuration is duplicated per root because oxfmt has no extends.
- Releases publish @deslop/workflow from main as 0.1.<run number>. The external consumer probe is ~/.deslop/harness-probe/turbo-probe.
