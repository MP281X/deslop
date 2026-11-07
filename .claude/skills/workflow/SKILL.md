---
name: workflow
description: Load at task start, when the user changes direction, before a plan card, a design or architecture choice, research into unfamiliar APIs, and before splitting or delegating work.
---

# Workflow

## Plan card

A data model, a screen, or work spanning more than one PR starts with one HTML page the user approves before the real build; prototypes are built to make the card:

- **The thing itself.** Entities with one worked example; a screen as a working prototype on real primitives and fixture data, phone and desktop, with 2–3 variants when the direction is open: behind `?variant=` in a web app's preview, as Device-panel screens for a native app. A static mock only before the app exists.
- **Choices.** Chosen, and rejected with the reason.
- **Units.** The PRs or stack layers, and what each proves.
- **Done.** The journeys the proof will show.

Approval freezes the card. A message that changes an entity, a screen or a unit updates the card and gets it approved again before the build follows. A durable app decision goes in the app's `AGENTS.md`.

The user starts from symptoms and finds what they want by reacting to concrete things. Map causes before options. A screen with no agreed direction gets a mix board in the app's preview route, or Device-panel screens for a native app: 2–4 axes (navigation, density, empty and error model, action placement), 2–3 variants each with stable ids like `nav-A`, a state scrubber from empty to error to long, and a copyable `mix` JSON; implement the chosen mix and remove the losers.

## Decide

A middle decision has a better answer that more evidence reveals; taste and product stay with the user. Gather the deciding source, probe or a time-boxed spike in `/tmp/<task>/`. If it is still close, give one model from another family the question, the evidence and the criteria without your verdict, and adopt its answer unless it shows a flaw you can check. No rounds, votes or scores.

## Split and delegate

- **Units.** Each owns a set of files and has a command that proves it done: a test, a check or a capture. Units that touch the same file are one unit; dependent units form a stack.
- **Who.** DeepSeek V4.1 Flash (`opencode-zen`) for clear units: building to an approved card, sweeps, codemods, tests, inventories, research. GPT-6.1 Sol (`codex`) or Opus 5.5 (`claudeAgent`) for units that need judgment and as the other family for review. The main thread writes a unit itself only when briefing it costs more than doing it.
- **Where.** `isolation:'worktree'` for a unit that writes; `target.environmentId` of `dev` to run it on the other worker. Read-only units share the checkout.
- **Brief.** Self-contained, since the worker has no history: objective, the card or its path, owned files, fixed decisions and what not to touch, the done command, the report format. Write the spec yourself; never "based on your findings".
- **Worker rules**, copied into every writing brief: edit only the owned files; run checks scoped to them (`vp lint <paths>`, `vp test <files>`), never `vp run fix` or another repo-wide fix; commit on the branch; clone only under `/tmp/repos/`; reply `PASS`, `ISSUES` or `BLOCKED` in at most 15 lines with evidence: command and exit code, capture paths, commit SHA.
- **Persistent.** A follow-up for the same unit goes to its thread with `t3_thread_send`; the worker keeps its context and its completion wakes you. A new unit gets a new delegate.
- **Overlap.** While workers run, build the next independent piece; wait only when the next step needs a result.

## Integrate

Read each worker's diff once against the card, not its summary; a missing proof is a gap, not a pass. Send a gap back once with the failing evidence, then take the unit over. Merge units in stack order, run full Verify once, then prove the integrated head with the verification skill.

## References

The repository's canonical examples lead; these fill a gap. Clones are read-only under `/tmp/repos/<name>`; check remote and revision before reuse. API questions resolve in the installed dependency's source: versions differ, especially Effect 3 and 4.

| Shape                                       | Repository                                     | Open                                                                                                        |
| ------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Any Effect API, idiomatic usage             | https://github.com/Effect-TS/effect            | `ai-docs/src/`, `packages/effect/src/<Module>.ts`, `packages/effect/*.md`, `migration/`                     |
| Services, layers, errors, schema            | https://github.com/kitlangton/effect-solutions | `packages/website/docs/`                                                                                    |
| Services in a large server, tests           | https://github.com/pingdotgg/t3code            | `docs/internals/effect-services.md`, `apps/server/src/`                                                     |
| Contracts shared by server and clients, RPC | https://github.com/pingdotgg/t3code            | `packages/contracts/src/`, `packages/client-runtime/src/rpc/`                                               |
| Architecture and package boundaries         | https://github.com/anomalyco/opencode          | `AGENTS.md`, `packages/core/src/`, `packages/protocol/src/`, `packages/server/src/handlers/`                |
| Plugin SDK, MCP host, local and cloud hosts | https://github.com/UsefulSoftwareCo/executor   | `packages/core/`, `packages/hosts/`, `apps/local/src/`, `apps/cloud/src/`                                   |
| MCP server                                  | https://github.com/pingdotgg/t3code            | `apps/server/src/mcp/`                                                                                      |
| CLI, child processes, cluster               | https://github.com/tim-smart/lalph             | `src/commands/`, `src/`                                                                                     |
| Atoms, AtomRpc, React hooks                 | https://github.com/Effect-TS/effect            | `packages/effect/src/reactivity/`, `packages/atom/react/`                                                   |
| Atoms in an app                             | https://github.com/tim-smart/bunnings-lite     | `src/atoms/`, `src/RpcClient.ts`                                                                            |
| State machines, statecharts                 | https://github.com/typeonce-dev/effect-machine | `packages/effect-machine/docs/`, `packages/effect-machine-react/README.md`, `packages/effect-machine/test/` |
| Expo                                        | https://github.com/pingdotgg/t3code            | `apps/mobile/src/state/`, `docs/internals/mobile-development.md`                                            |
| Web input, loading, cache and navigation    | https://github.com/pingdotgg/t3code            | `docs/internals/web-ui.md`, `docs/internals/performance-regressions.md`, `apps/web/src/components/ui/`      |
| Components as shipped                       | https://github.com/shadcn-ui/ui                | `apps/v4/registry/`, `skills/`                                                                              |
| Design system document                      | https://github.com/google-labs-code/design.md  | `docs/spec.md`; worked: executor `design.md`, Effect-TS/website `apps/web/DESIGN.md`                        |
| Official Effect apps                        | https://github.com/Effect-TS/website           | `apps/web/`; also Effect-TS/discord-bot and Effect-TS/cafe                                                  |
| Agent loop, tools, skills, permissions      | https://github.com/anomalyco/opencode          | `packages/core/src/session/`, `packages/core/src/tool/`, `packages/core/src/skill/`, `packages/ai/src/`     |
| Skills, prompts, `AGENTS.md`                | https://github.com/mattpocock/skills           | `skills/productivity/writing-for-agents/`, `skills/engineering/`                                            |
| Skills that augment a strong model          | https://github.com/cursor/plugins              | `pstack/skills/`                                                                                            |
| Skill packaging and evaluation              | https://github.com/anthropics/skills           | `skills/skill-creator/`                                                                                     |
| Effect knowledge for agents                 | https://github.com/Effect-TS/skills            | `skills/effect-ts/`                                                                                         |
