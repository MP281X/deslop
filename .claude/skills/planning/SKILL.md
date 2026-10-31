---
name: planning
description: Load at task start, when the user changes direction, and before design choices, research into unfamiliar APIs or architecture, or delegation.
---

# Planning

## Outcome

- **Contract.** The user's goal, accepted choices, rejected directions and order. A steer updates it; an approval accepts the proposal actually shown. Side-note constraints apply at once; extra work follows the main task.
- **Reversals.** Discuss a deliberate configuration reversal before making it.
- **Uncertainty.** Settle what is consequential early; give open-ended work a checkable finish. The strategy is yours, the agreed scope and quality are not.
- **Continuity.** Carry valid evidence, pending work and IDs across batches and compaction; recover a missing decision from the thread, never guess.
- **Evidence.** Ground consequential claims in the deciding source, trace or probe; name what stays unverified.

## Delivery

Build → prove the actual journey → Verify → one review → draft push, per pull-requests. Fix related findings in one batch and revalidate. Process lives in prose, not hooks, stamps or coordination machinery.

- **Review.** One independent review of the unmerged PR set before the first push; one reviewer unless distinct risks need different expertise.
- **Triage.** Fix kept P1, P2 and trivial P3 findings; keep pre-existing defects separate. Follow-ups cover changed contracts only; repeated substantial findings mean rethinking the approach.

## Delegation

Bounded, independent work that saves time or adds judgment. Give the question, the user's constraints, the evidence and a stopping condition, without your verdict; a reviewer also gets immutable revisions and "Load the review skill." Keep parent and child investigations disjoint.

**Models.** The parent's provider by default, the other family for a second opinion. A user's model, provider or quota steer holds until changed.

| Work                                                 | Codex         | Claude Code        | Effort   |
| ---------------------------------------------------- | ------------- | ------------------ | -------- |
| Exploration, lookup, inventory, evidence collection  | `gpt-6-luna`  | `claude-haiku-5-5` | `medium` |
| Reasoning, architecture, difficult debugging, review | `gpt-6.1-sol` | `claude-opus-5-5`  | `high`   |

**Council.** Only for a hard-to-reverse decision with split evidence: `gpt-6-luna`, `claude-haiku-5-5`, `gpt-6.1-sol` and `claude-opus-5-5` at their table efforts, each given the same question, options, raw evidence and criteria, never your preferred answer or another member's conclusion. Weigh their tradeoffs and choose. Otherwise decide, or ask one reviewer.

**`~/deslop`.** Move to a task worktree with `t3_worktree_handoff` before any edit: that checkout supplies every thread's installed configuration.

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

- **Screens.** Start from the screen's job and its fewest concepts. Search Mobbin's screens or flows for that job beside the repository's screens; borrow an interaction only when it removes a concept, an action or an ambiguity. An open design gets distinct usable variants as `html_render` mocks, the fewest-concepts one among them, on realistic data; color, radius, type, spacing and shadow from the theme `components.json` names. An agreed direction needs no new choice; validate the built journey against the pick at the same viewport.
- **Visual taste.** No gradients or glows, colored side stripes, a bordered card per section, equal prominence everywhere, a color per tile, generic copy, content waiting on an entrance animation, or the hero/feature-grid/logo-row skeleton. The user's picked reference wins.
