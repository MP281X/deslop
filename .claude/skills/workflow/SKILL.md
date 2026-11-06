---
name: workflow
description: Load at task start, when the user changes direction, and before design choices, research into unfamiliar APIs or architecture, or delegation.
---

# Workflow

## Outcome

- **Agreement.** The user's goal, accepted choices, rejected directions and order. A steer updates it; an approval accepts the proposal actually shown. Side-note constraints apply at once; extra work follows the main task.
- **Reversals.** Discuss a deliberate reversal of an agreed approach before making it.
- **Uncertainty.** Settle what is consequential early; give open-ended work a checkable finish. The strategy is yours, the agreed scope and quality are not.
- **Continuity.** Carry valid evidence, pending work and IDs across batches and compaction; recover a missing decision from the thread, never guess.
- **Evidence.** Ground consequential claims in the deciding source, trace or probe; name what stays unverified.

## Delivery

Build → prove the actual journey with the verification skill → draft push, per pull-requests. Fix related findings in one batch and revalidate. Before replacement work, name superseded owners and paths and their replacement; verification closes each entry with deletion or a keep reason.

## Delegation

Bounded, independent work that saves time or adds judgment. Give the question, the user's constraints, raw evidence and an open question, without your verdict or summary. Choose a different family or lens, with no main transcript or other reports. A reviewer also gets immutable revisions and the verification skill. Keep parent and child investigations disjoint.

**Models.** DeepSeek for bulk read-only work; Codex gpt-6.1-sol for UI review, contracts and CI; Opus for design, architecture and final verification; Sonnet, Haiku and Luna for bounded read-only work.

**Council.** Only for a hard-to-reverse decision with split evidence: two strong models with different lenses, each given the same question, evidence and criteria. Blind proposals first; hostile review of the draft second; no third round. Synthesize a decision-axis table with a dissent record — `axis | options | who proposed | evidence | adopted or rejected, with reason` — and choose; never a majority vote. Otherwise decide, or ask one reviewer.

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

## Design

The user starts from symptoms and rough ideas and finds what they want by reacting to concrete things.

- **Map first.** Symptoms become a map of causes and options sized by impact, before any pick.
- **Decisions.** Agreed, rejected and open choices, kept current as the user reacts; a durable app decision goes in the app's `AGENTS.md`.
- **Exploration.** Build one mix board, not N mocks; the user mixes parts and comments per part. A screen change with no agreed direction does not start until the mix is agreed or the user waives it.
  - **Axes.** 2–4 axes — navigation, density, empty/error model, action placement; 2–3 variants each with stable ids like `nav-A`, `empty-2`.
  - **Material.** Real primitives from `components-web` or `components-mobile`; 2–3 real screens; one fixture data set; a state scrubber from empty through loading and error to long, on phone and desktop, light and dark.
  - **Interaction.** Side-by-side or matrix; tabs, toggles or drag where behaviour matters; URL-hash state and a copyable `mix` JSON.
  - **Where.** A route in the worktree preview for a web app, Device-panel screens for a native app; a standalone HTML board is only for pre-app exploration.
  - **Record.** The chosen mix is stated in the thread; implement it. Live finalists run as `?variant=` in a web app's preview or as Device-panel screens for a native app on real data; losers go before the PR; validate the built journey against the pick at the same viewport.
- **Alternatives.** For a user-owned, hard-to-reverse architecture choice, compare 3 genuinely different designs; decide reversible technical details yourself.
- **Spikes.** The riskiest unknown gets a time-boxed throwaway in `/tmp/<task>/`; its result backs the recommendation, not a reading of docs.
